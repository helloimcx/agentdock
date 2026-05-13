import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AgentDockCloudEventEnvelope, CloudTaskRecord, CloudTaskStatus } from '../../../../packages/cloud-core/src/index.js';
import { buildWorkspacePath } from '../../../../packages/cloud-core/src/index.js';
import type { RunSummary, ThreadDetail, ThreadMessage, ThreadSummary, WorkspaceRegistryCreateInput, WorkspaceRegistryEntry } from '../../../../packages/contracts/src/index.js';

type Row = Record<string, unknown>;

function now() {
  return new Date().toISOString();
}

function asString(value: unknown) {
  return String(value || '');
}

function parseJsonObject(value: unknown) {
  try {
    const parsed = JSON.parse(asString(value) || '{}') as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export class CloudRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly dataRoot: string,
    private readonly tenantId: string,
    private readonly userId: string,
  ) {}

  listWorkspaces(): WorkspaceRegistryEntry[] {
    return this.db.prepare('SELECT * FROM workspace_registry ORDER BY updated_at DESC').all().map((row) => this.toWorkspace(row as Row));
  }

  getMetrics() {
    const taskCount = this.scalarCount('tasks');
    const runningTasks = this.db.prepare(`
      SELECT COUNT(*) AS count FROM tasks WHERE status IN ('accepted', 'input_syncing', 'input_synced', 'sandbox_creating', 'sandbox_created', 'running', 'output_syncing', 'output_synced', 'cancelling')
    `).get() as Row | undefined;
    return {
      workspaces: this.scalarCount('workspace_registry'),
      threads: this.scalarCount('threads'),
      tasks: taskCount,
      runningTasks: Number(runningTasks?.count || 0),
      events: this.scalarCount('cloud_events'),
    };
  }

  createWorkspace(input: WorkspaceRegistryCreateInput): WorkspaceRegistryEntry {
    const timestamp = now();
    const workspaceId = randomUUID();
    const workdirPath = input.path || buildWorkspacePath(this.dataRoot, this.tenantId, this.userId, workspaceId);
    this.db.prepare(`
      INSERT INTO workspace_registry (workspace_id, display_name, workdir_path, created_at, updated_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(workspaceId, input.displayName || 'Untitled Workspace', workdirPath, timestamp, timestamp, JSON.stringify(input.metadata || {}));
    return this.getWorkspace(workspaceId);
  }

  getWorkspace(workspaceId: string): WorkspaceRegistryEntry {
    const row = this.db.prepare('SELECT * FROM workspace_registry WHERE workspace_id = ?').get(workspaceId) as Row | undefined;
    if (!row) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    return this.toWorkspace(row);
  }

  getWorkspacePath(workspaceId: string) {
    const workspace = this.getWorkspace(workspaceId);
    return workspace.path;
  }

  listThreads(workspaceId: string): ThreadSummary[] {
    return this.db.prepare('SELECT * FROM threads WHERE workspace_id = ? ORDER BY updated_at DESC').all(workspaceId).map((row) => this.toThreadSummary(row as Row));
  }

  createThread(workspaceId: string, title?: string): ThreadDetail {
    this.getWorkspace(workspaceId);
    const timestamp = now();
    const threadId = randomUUID();
    const sessionId = randomUUID();
    this.db.prepare(`
      INSERT INTO threads (thread_id, workspace_id, title, session_id, live, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?)
    `).run(threadId, workspaceId, title || 'New Thread', sessionId, timestamp, timestamp);
    return this.getThread(threadId);
  }

  getThread(threadId: string): ThreadDetail {
    const row = this.db.prepare('SELECT * FROM threads WHERE thread_id = ?').get(threadId) as Row | undefined;
    if (!row) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    return { ...this.toThreadSummary(row), messages: this.listMessages(threadId), selectedKnowledgeBaseIds: [] };
  }

  renameThread(threadId: string, title: string): ThreadDetail {
    this.db.prepare('UPDATE threads SET title = ?, updated_at = ? WHERE thread_id = ?').run(title || 'Untitled Thread', now(), threadId);
    return this.getThread(threadId);
  }

  deleteThread(threadId: string) {
    this.db.prepare('DELETE FROM threads WHERE thread_id = ?').run(threadId);
    return { deleted: true };
  }

  appendMessage(threadId: string, role: ThreadMessage['role'], content: string, kind?: ThreadMessage['kind']) {
    const timestamp = now();
    const messageId = randomUUID();
    this.db.prepare(`
      INSERT INTO messages (message_id, thread_id, role, kind, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(messageId, threadId, role, kind || null, content, timestamp, timestamp);
    this.db.prepare('UPDATE threads SET updated_at = ? WHERE thread_id = ?').run(timestamp, threadId);
    return this.getMessage(messageId);
  }

  upsertAssistantProgress(threadId: string, content: string) {
    const row = this.db.prepare(`
      SELECT * FROM messages WHERE thread_id = ? AND role = 'assistant' AND kind = 'progress' ORDER BY created_at DESC LIMIT 1
    `).get(threadId) as Row | undefined;
    const timestamp = now();
    if (!row) {
      return this.appendMessage(threadId, 'assistant', content, 'progress');
    }
    this.db.prepare('UPDATE messages SET content = ?, updated_at = ? WHERE message_id = ?').run(content, timestamp, asString(row.message_id));
    this.db.prepare('UPDATE threads SET updated_at = ? WHERE thread_id = ?').run(timestamp, threadId);
    return this.getMessage(asString(row.message_id));
  }

  createRunAndTask(threadId: string, prompt: string, agentId: string): CloudTaskRecord {
    const thread = this.getThread(threadId);
    const timestamp = now();
    const runId = randomUUID();
    const taskId = randomUUID();
    const task: CloudTaskRecord = {
      taskId,
      runId,
      threadId,
      workspaceId: thread.workspaceId,
      sessionId: this.getThreadSessionId(threadId),
      agentId,
      status: 'created',
      prompt,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.appendMessage(threadId, 'user', prompt, 'final');
    this.db.prepare(`
      INSERT INTO runs (run_id, thread_id, task_id, status, started_at, updated_at)
      VALUES (?, ?, ?, 'queued', ?, ?)
    `).run(runId, threadId, taskId, timestamp, timestamp);
    this.db.prepare(`
      INSERT INTO tasks (task_id, run_id, thread_id, workspace_id, session_id, agent_id, status, prompt, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(taskId, runId, threadId, thread.workspaceId, task.sessionId, agentId, 'created', prompt, timestamp, timestamp);
    this.db.prepare('UPDATE threads SET live = 1, run_id = ?, updated_at = ? WHERE thread_id = ?').run(runId, timestamp, threadId);
    return task;
  }

  getTask(taskId: string): CloudTaskRecord {
    const row = this.db.prepare('SELECT * FROM tasks WHERE task_id = ?').get(taskId) as Row | undefined;
    if (!row) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return this.toTask(row);
  }

  getTaskByRunId(runId: string): CloudTaskRecord | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE run_id = ?').get(runId) as Row | undefined;
    return row ? this.toTask(row) : null;
  }

  updateTaskStatus(taskId: string, status: CloudTaskStatus, error?: string, errorCode?: string) {
    const timestamp = now();
    const terminal = status === 'succeeded' || status === 'failed' || status === 'cancelled' || status === 'timeout';
    this.db.prepare(`
      UPDATE tasks SET status = ?, updated_at = ?, started_at = COALESCE(started_at, ?), completed_at = CASE WHEN ? THEN ? ELSE completed_at END, error_code = COALESCE(?, error_code), error = COALESCE(?, error)
      WHERE task_id = ?
    `).run(status, timestamp, timestamp, terminal ? 1 : 0, timestamp, errorCode || null, error || null, taskId);
    const task = this.getTask(taskId);
    this.db.prepare('UPDATE runs SET status = ?, updated_at = ? WHERE run_id = ?').run(toRunStatus(status), timestamp, task.runId);
    this.db.prepare('UPDATE threads SET live = ?, updated_at = ? WHERE thread_id = ?').run(terminal ? 0 : 1, timestamp, task.threadId);
    return task;
  }

  updateTaskSandbox(taskId: string, sandboxId: string) {
    this.db.prepare('UPDATE tasks SET sandbox_id = ?, updated_at = ? WHERE task_id = ?').run(sandboxId, now(), taskId);
    return this.getTask(taskId);
  }

  replaceOutputFiles(task: CloudTaskRecord, files: Array<{ path: string; size: number; updatedAt: string }>) {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM workspace_files WHERE task_id = ?').run(task.taskId);
      const insert = this.db.prepare(`
        INSERT INTO workspace_files (file_id, task_id, workspace_id, session_id, relative_path, uri, size_bytes, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const file of files) {
        insert.run(
          randomUUID(),
          task.taskId,
          task.workspaceId,
          task.sessionId,
          file.path,
          `local-volume://${task.sessionId}/${file.path}`,
          file.size,
          file.updatedAt,
        );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  listOutputFiles(taskId: string) {
    return this.db.prepare(`
      SELECT relative_path, uri, size_bytes, updated_at FROM workspace_files WHERE task_id = ? ORDER BY relative_path ASC
    `).all(taskId).map((row) => {
      const entry = row as Row;
      return {
        path: asString(entry.relative_path),
        uri: asString(entry.uri),
        size: Number(entry.size_bytes || 0),
        updatedAt: asString(entry.updated_at),
      };
    });
  }

  recordCloudEvent(envelope: AgentDockCloudEventEnvelope) {
    this.db.prepare(`
      INSERT INTO cloud_events (task_id, run_id, seq, type, event_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(envelope.taskId || null, envelope.runId || null, envelope.seq, envelope.type, JSON.stringify(envelope), envelope.createdAt);
  }

  toRun(taskId: string): RunSummary {
    const task = this.getTask(taskId);
    return {
      id: task.runId,
      threadId: task.threadId,
      status: toRunStatus(task.status),
      startedAt: task.startedAt || task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  private getThreadSessionId(threadId: string) {
    const row = this.db.prepare('SELECT session_id FROM threads WHERE thread_id = ?').get(threadId) as Row | undefined;
    return asString(row?.session_id);
  }

  private listMessages(threadId: string): ThreadMessage[] {
    return this.db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC').all(threadId).map((row) => this.toMessage(row as Row));
  }

  private getMessage(messageId: string): ThreadMessage {
    const row = this.db.prepare('SELECT * FROM messages WHERE message_id = ?').get(messageId) as Row | undefined;
    if (!row) {
      throw new Error(`Message not found: ${messageId}`);
    }
    return this.toMessage(row);
  }

  private toWorkspace(row: Row): WorkspaceRegistryEntry {
    return {
      workspaceId: asString(row.workspace_id),
      displayName: asString(row.display_name),
      path: asString(row.workdir_path),
      deviceId: 'agentdock-cloud',
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
      lastOpenedAt: row.last_opened_at ? asString(row.last_opened_at) : undefined,
      health: { status: 'healthy', summary: 'Cloud workspace is available.', issues: [] },
      activeTaskCount: 0,
      recentTaskIds: [],
      metadata: parseJsonObject(row.metadata_json),
    };
  }

  private toThreadSummary(row: Row): ThreadSummary {
    const threadId = asString(row.thread_id);
    const last = this.db.prepare('SELECT content FROM messages WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1').get(threadId) as Row | undefined;
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM messages WHERE thread_id = ?').get(threadId) as Row | undefined;
    return {
      id: threadId,
      workspaceId: asString(row.workspace_id),
      title: asString(row.title),
      live: Boolean(row.live),
      updatedAt: asString(row.updated_at),
      createdAt: asString(row.created_at),
      historyCount: Number(count?.count || 0),
      excerpt: asString(last?.content).slice(0, 160),
      runId: row.run_id ? asString(row.run_id) : undefined,
      agentType: 'pi',
    };
  }

  private toMessage(row: Row): ThreadMessage {
    return {
      id: asString(row.message_id),
      role: asString(row.role) as ThreadMessage['role'],
      kind: row.kind ? asString(row.kind) as ThreadMessage['kind'] : undefined,
      content: asString(row.content),
      timestamp: asString(row.created_at),
    };
  }

  private toTask(row: Row): CloudTaskRecord {
    return {
      taskId: asString(row.task_id),
      runId: asString(row.run_id),
      threadId: asString(row.thread_id),
      workspaceId: asString(row.workspace_id),
      sessionId: asString(row.session_id),
      agentId: asString(row.agent_id),
      status: asString(row.status) as CloudTaskStatus,
      sandboxId: row.sandbox_id ? asString(row.sandbox_id) : undefined,
      prompt: asString(row.prompt),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
      startedAt: row.started_at ? asString(row.started_at) : undefined,
      completedAt: row.completed_at ? asString(row.completed_at) : undefined,
      errorCode: row.error_code ? asString(row.error_code) : undefined,
      error: row.error ? asString(row.error) : undefined,
    };
  }

  private scalarCount(table: string) {
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as Row | undefined;
    return Number(row?.count || 0);
  }
}

function toRunStatus(status: CloudTaskStatus): RunSummary['status'] {
  if (status === 'created' || status === 'accepted') return 'queued';
  if (
    status === 'input_syncing' ||
    status === 'input_synced' ||
    status === 'sandbox_creating' ||
    status === 'sandbox_created' ||
    status === 'running' ||
    status === 'output_syncing' ||
    status === 'output_synced' ||
    status === 'cancelling'
  ) return 'running';
  if (status === 'succeeded') return 'completed';
  if (status === 'cancelled') return 'interrupted';
  return 'failed';
}
