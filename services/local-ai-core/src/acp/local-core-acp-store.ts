import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import type {
  LocalCoreAuthorizedUser,
  LocalCorePairingRequest,
  ScheduledJob,
  ScheduledJobCreateInput,
  ScheduledJobRun,
  ScheduledJobUpdateInput,
  ThreadDetail,
  ThreadSummary,
  AgentTask,
  AgentTaskCreateInput,
  AgentTaskListQuery,
  AgentTaskListResponse,
  AgentTaskStatus,
  AgentTaskUpdateInput,
  ApprovalRequest,
  ApprovalRequestCreateInput,
  ApprovalRequestListQuery,
  ApprovalRequestListResponse,
  ApprovalRequestResolveInput,
  AuditEvent,
  AuditEventListQuery,
  AuditEventListResponse,
  AuditEventType,
  SecurityPermissionLevel,
  SecurityPermissionScope,
  WorkspaceSecuritySettings,
  WorkspaceSecuritySettingsUpdateInput,
  WorkspaceGitSummary,
  WorkspaceHealthSummary,
  WorkspaceRegistryCreateInput,
  WorkspaceRegistryEntry,
  WorkspaceRegistryUpdateInput,
} from '../../../../packages/contracts/src/index.js';
import {
  normalizeAgentTaskStatus,
  normalizeApprovalRequestStatus,
  normalizeChannelPlatform,
  normalizeRunStatus,
  normalizeScheduledJobExecutionMode,
  normalizeScheduledJobRunStatus,
  normalizeScheduledJobTriggerType,
} from '../../../../packages/contracts/src/index.js';
import { createScheduledJobId } from '../scheduler/job-id.js';
import { LOCALCORE_ACP_AGENT_TYPE } from '../../../../shared/desktop.js';
import type { DesktopBridgeEvent, DesktopBridgeEventKind, DesktopBridgeToolCall } from '../../../../shared/desktop.js';
import type {
  LocalMessageRow,
  LocalPlatformPairingRow,
  LocalPlatformThreadBindingRow,
  LocalPlatformUserRow,
  LocalScheduledJobRow,
  LocalScheduledJobRunRow,
  LocalRunRow,
  LocalThreadRow,
  LocalAgentTaskRow,
  LocalApprovalRequestRow,
  LocalAuditEventRow,
  LocalWorkspaceSecuritySettingsRow,
  LocalWorkspaceRegistryRow,
} from '../router/workspace-router-types.js';
import { normalizeMessageContent } from '../thread/workspace-thread-mappers.js';
import { encodeThreadId } from '../thread/workspace-thread-id.js';

export class LocalCoreAcpStore {
  private readonly db: DatabaseSync;

  constructor(userDataPath: string) {
    const dbPath = join(userDataPath, 'runtime', 'local-core.db');
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        bridge_session_key TEXT NOT NULL,
        title TEXT NOT NULL,
        agent_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        history_count INTEGER NOT NULL DEFAULT 0,
        excerpt TEXT NOT NULL DEFAULT '',
        acp_session_id TEXT,
        acp_supports_load INTEGER NOT NULL DEFAULT 0,
        agent_mode TEXT NOT NULL DEFAULT 'default'
      );
      CREATE INDEX IF NOT EXISTS idx_threads_workspace_updated ON threads (workspace_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_call_json TEXT,
        bridge_kind TEXT,
        bridge_status TEXT,
        timestamp TEXT NOT NULL,
        kind TEXT NOT NULL,
        seq INTEGER NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_messages_thread_seq ON messages (thread_id, seq ASC);
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_runs_thread_updated ON runs (thread_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS platform_pairings (
        code TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        platform_user_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_platform_pairings_workspace_status ON platform_pairings (workspace_id, status, expires_at DESC);
      CREATE TABLE IF NOT EXISTS platform_users (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        platform_user_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        thread_id TEXT,
        authorized_at TEXT NOT NULL,
        UNIQUE(workspace_id, platform, platform_user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_platform_users_workspace_platform ON platform_users (workspace_id, platform);
      CREATE TABLE IF NOT EXISTS platform_thread_bindings (
        workspace_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        platform_user_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        last_platform_message_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, platform, chat_id, platform_user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_platform_thread_bindings_thread ON platform_thread_bindings (thread_id);
      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        route_type TEXT NOT NULL,
        route_config TEXT NOT NULL,
        execution_mode TEXT NOT NULL DEFAULT 'same-thread',
        trigger_type TEXT NOT NULL,
        cron_expr TEXT,
        run_at TEXT,
        prompt_template TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        concurrency_policy TEXT NOT NULL DEFAULT 'skip_if_running',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_run_at TEXT,
        last_status TEXT,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_workspace_updated ON scheduled_jobs (workspace_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_enabled ON scheduled_jobs (enabled, trigger_type, run_at);
      CREATE TABLE IF NOT EXISTS scheduled_job_runs (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        status TEXT NOT NULL,
        triggered_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        error TEXT,
        thread_id TEXT,
        run_id TEXT,
        platform_message_id TEXT,
        platform_message_ids_json TEXT,
        delivery_mode TEXT,
        delivery_status TEXT,
        delivery_error TEXT,
        last_bridge_event_at TEXT,
        FOREIGN KEY (job_id) REFERENCES scheduled_jobs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_job_runs_job_triggered ON scheduled_job_runs (job_id, triggered_at DESC);
      CREATE TABLE IF NOT EXISTS workspace_registry (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        path TEXT NOT NULL,
        device_id TEXT NOT NULL,
        default_runtime_id TEXT,
        git_json TEXT NOT NULL DEFAULT '{}',
        health_json TEXT NOT NULL DEFAULT '{}',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_opened_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_workspace_registry_updated ON workspace_registry (updated_at DESC);
      CREATE TABLE IF NOT EXISTS agent_tasks (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        runtime_id TEXT NOT NULL,
        thread_id TEXT,
        run_id TEXT,
        title TEXT NOT NULL,
        prompt TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        queued_at TEXT,
        started_at TEXT,
        completed_at TEXT,
        summary TEXT,
        error TEXT,
        timeline_json TEXT NOT NULL DEFAULT '[]',
        logs_json TEXT NOT NULL DEFAULT '[]',
        artifacts_json TEXT NOT NULL DEFAULT '[]',
        approval_ids_json TEXT NOT NULL DEFAULT '[]',
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_agent_tasks_workspace_updated ON agent_tasks (workspace_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_tasks_status_updated ON agent_tasks (status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_tasks_run ON agent_tasks (run_id);
      CREATE TABLE IF NOT EXISTS workspace_security_settings (
        workspace_id TEXT PRIMARY KEY,
        permissions_json TEXT NOT NULL,
        allow_paths_json TEXT NOT NULL DEFAULT '[]',
        deny_paths_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL,
        updated_by TEXT
      );
      CREATE TABLE IF NOT EXISTS approval_requests (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        task_id TEXT,
        thread_id TEXT,
        run_id TEXT,
        device_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        requested_action TEXT NOT NULL,
        command TEXT,
        scopes_json TEXT NOT NULL DEFAULT '[]',
        options_json TEXT NOT NULL DEFAULT '[]',
        requested_by TEXT,
        resolved_by TEXT,
        resolution TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resolved_at TEXT,
        expires_at TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_approval_requests_workspace_updated ON approval_requests (workspace_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_approval_requests_status_updated ON approval_requests (status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_approval_requests_task ON approval_requests (task_id);
      CREATE INDEX IF NOT EXISTS idx_approval_requests_run ON approval_requests (run_id);
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        workspace_id TEXT,
        task_id TEXT,
        approval_id TEXT,
        actor TEXT,
        summary TEXT NOT NULL,
        risk_level TEXT,
        created_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_audit_events_workspace_created ON audit_events (workspace_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_events_task_created ON audit_events (task_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_events_type_created ON audit_events (type, created_at DESC);
    `);
    this.ensureColumn('messages', 'tool_call_json', 'TEXT');
    this.ensureColumn('messages', 'bridge_kind', 'TEXT');
    this.ensureColumn('messages', 'bridge_status', 'TEXT');
    this.ensureColumn('scheduled_jobs', 'execution_mode', "TEXT NOT NULL DEFAULT 'same-thread'");
    this.ensureColumn('scheduled_job_runs', 'platform_message_ids_json', 'TEXT');
    this.ensureColumn('scheduled_job_runs', 'delivery_mode', 'TEXT');
    this.ensureColumn('scheduled_job_runs', 'delivery_status', 'TEXT');
    this.ensureColumn('scheduled_job_runs', 'delivery_error', 'TEXT');
    this.ensureColumn('scheduled_job_runs', 'last_bridge_event_at', 'TEXT');
    this.ensureColumn('threads', 'agent_mode', "TEXT NOT NULL DEFAULT 'default'");
  }

  close() {
    this.db.close();
  }

  listThreadSummaries(workspaceId: string): ThreadSummary[] {
    const rows = this.db.prepare(`
      SELECT id, workspace_id, session_id, bridge_session_key, title, agent_type, created_at, updated_at, history_count, excerpt, acp_session_id, acp_supports_load, agent_mode
      FROM threads
      WHERE workspace_id = ?
      ORDER BY updated_at DESC
    `).all(workspaceId) as LocalThreadRow[];
    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      title: row.title,
      live: false,
      updatedAt: row.updated_at,
      createdAt: row.created_at,
      historyCount: row.history_count,
      excerpt: row.excerpt,
      runId: undefined,
      bridgeSessionKey: row.bridge_session_key,
      agentType: row.agent_type,
    }));
  }

  countThreads(workspaceId: string) {
    const row = this.db.prepare('SELECT COUNT(*) AS total FROM threads WHERE workspace_id = ?').get(workspaceId) as { total: number } | undefined;
    return Number(row?.total || 0);
  }

  createThread(workspaceId: string, title: string, agentType = LOCALCORE_ACP_AGENT_TYPE, agentMode = 'default'): ThreadDetail {
    const sessionId = randomUUID();
    const threadId = encodeThreadId(workspaceId, sessionId);
    const now = new Date().toISOString();
    const bridgeSessionKey = `${LOCALCORE_ACP_AGENT_TYPE}:${workspaceId}:${sessionId}`;
    this.db.prepare(`
      INSERT INTO threads (id, workspace_id, session_id, bridge_session_key, title, agent_type, created_at, updated_at, history_count, excerpt, agent_mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?)
    `).run(threadId, workspaceId, sessionId, bridgeSessionKey, title, agentType, now, now, agentMode || 'default');
    return {
      id: threadId,
      workspaceId,
      title,
      live: false,
      updatedAt: now,
      createdAt: now,
      historyCount: 0,
      excerpt: '',
      bridgeSessionKey,
      agentType,
      messages: [],
      selectedKnowledgeBaseIds: [],
      pendingPermissionRequest: null,
    };
  }

  getThread(threadId: string, selectedKnowledgeBaseIds: string[]): ThreadDetail {
    const row = this.getThreadRow(threadId);
    if (!row) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    const messages = this.db.prepare(`
      SELECT id, thread_id, role, content, tool_call_json, bridge_kind, bridge_status, timestamp, kind, seq
      FROM messages
      WHERE thread_id = ?
      ORDER BY seq ASC
    `).all(threadId) as LocalMessageRow[];
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      title: row.title,
      live: false,
      updatedAt: row.updated_at,
      createdAt: row.created_at,
      historyCount: row.history_count,
      excerpt: row.excerpt,
      bridgeSessionKey: row.bridge_session_key,
      agentType: row.agent_type,
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        toolCall: parseJson<DesktopBridgeToolCall | null>(message.tool_call_json || 'null', null) || undefined,
        bridgeKind: normalizeBridgeKind(message.bridge_kind),
        bridgeStatus: normalizeBridgeStatus(message.bridge_status),
        timestamp: message.timestamp,
        kind: message.kind,
      })),
      selectedKnowledgeBaseIds,
      pendingPermissionRequest: null,
    };
  }

  renameThread(threadId: string, title: string) {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE threads SET title = ?, updated_at = ? WHERE id = ?').run(title, now, threadId);
  }

  deleteThread(threadId: string) {
    this.db.prepare('DELETE FROM threads WHERE id = ?').run(threadId);
  }

  appendMessage(
    threadId: string,
    role: LocalMessageRow['role'],
    content: string,
    kind: LocalMessageRow['kind'],
    toolCall?: DesktopBridgeToolCall,
    bridgeKind?: DesktopBridgeEventKind,
    bridgeStatus?: DesktopBridgeEvent['bridgeStatus'],
  ) {
    const timestamp = new Date().toISOString();
    const nextSequenceRow = this.db.prepare('SELECT COALESCE(MAX(seq), -1) + 1 AS next_seq FROM messages WHERE thread_id = ?').get(threadId) as { next_seq: number };
    const nextSeq = Number(nextSequenceRow?.next_seq || 0);
    const id = `${timestamp}-${role}-${nextSeq}`;
    const excerpt = normalizeMessageContent(content);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        INSERT INTO messages (id, thread_id, role, content, tool_call_json, bridge_kind, bridge_status, timestamp, kind, seq)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        threadId,
        role,
        content,
        toolCall ? JSON.stringify(toolCall) : null,
        bridgeKind || null,
        bridgeStatus || null,
        timestamp,
        kind,
        nextSeq,
      );
      this.db.prepare(`
        UPDATE threads
        SET updated_at = ?, history_count = history_count + 1, excerpt = ?
        WHERE id = ?
      `).run(timestamp, excerpt, threadId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { id, timestamp };
  }

  upsertMessage(
    threadId: string,
    id: string,
    role: LocalMessageRow['role'],
    content: string,
    kind: LocalMessageRow['kind'],
    toolCall?: DesktopBridgeToolCall,
    bridgeKind?: DesktopBridgeEventKind,
    bridgeStatus?: DesktopBridgeEvent['bridgeStatus'],
  ) {
    const timestamp = new Date().toISOString();
    const excerpt = normalizeMessageContent(content);
    const existing = this.db.prepare('SELECT id FROM messages WHERE id = ? AND thread_id = ?').get(id, threadId) as { id: string } | undefined;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (existing) {
        this.db.prepare(`
          UPDATE messages
          SET content = ?, tool_call_json = ?, bridge_kind = ?, bridge_status = ?, timestamp = ?, kind = ?
          WHERE id = ? AND thread_id = ?
        `).run(content, toolCall ? JSON.stringify(toolCall) : null, bridgeKind || null, bridgeStatus || null, timestamp, kind, id, threadId);
      } else {
        const nextSequenceRow = this.db.prepare('SELECT COALESCE(MAX(seq), -1) + 1 AS next_seq FROM messages WHERE thread_id = ?').get(threadId) as { next_seq: number };
        const nextSeq = Number(nextSequenceRow?.next_seq || 0);
        this.db.prepare(`
          INSERT INTO messages (id, thread_id, role, content, tool_call_json, bridge_kind, bridge_status, timestamp, kind, seq)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, threadId, role, content, toolCall ? JSON.stringify(toolCall) : null, bridgeKind || null, bridgeStatus || null, timestamp, kind, nextSeq);
        this.db.prepare(`
          UPDATE threads
          SET history_count = history_count + 1
          WHERE id = ?
        `).run(threadId);
      }
      this.db.prepare(`
        UPDATE threads
        SET updated_at = ?, excerpt = ?
        WHERE id = ?
      `).run(timestamp, excerpt, threadId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { id, timestamp };
  }

  updateRun(runId: string, threadId: string, status: LocalRunRow['status']) {
    const now = new Date().toISOString();
    const normalizedStatus = normalizeRunStatus(status);
    const existing = this.db.prepare('SELECT id FROM runs WHERE id = ?').get(runId) as { id: string } | undefined;
    if (existing) {
      this.db.prepare('UPDATE runs SET status = ?, updated_at = ? WHERE id = ?').run(normalizedStatus, now, runId);
      return;
    }
    this.db.prepare(`
      INSERT INTO runs (id, thread_id, status, started_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(runId, threadId, normalizedStatus, now, now);
  }

  getLatestRunForThread(threadId: string) {
    const row = this.db.prepare(`
      SELECT id, thread_id, status, started_at, updated_at
      FROM runs
      WHERE thread_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(threadId) as LocalRunRow | undefined;
    return row ? { ...row, status: normalizeRunStatus(row.status) } : undefined;
  }

  getRun(runId: string) {
    const row = this.db.prepare(`
      SELECT id, thread_id, status, started_at, updated_at
      FROM runs
      WHERE id = ?
    `).get(runId) as LocalRunRow | undefined;
    return row ? { ...row, status: normalizeRunStatus(row.status) } : undefined;
  }

  listWorkspaceRegistry(): WorkspaceRegistryEntry[] {
    const rows = this.db.prepare(`
      SELECT id, display_name, path, device_id, default_runtime_id, git_json, health_json, metadata_json, created_at, updated_at, last_opened_at
      FROM workspace_registry
      ORDER BY display_name ASC
    `).all() as LocalWorkspaceRegistryRow[];
    return rows.map((row) => this.toWorkspaceRegistryEntry(row));
  }

  getWorkspaceRegistryEntry(workspaceId: string): WorkspaceRegistryEntry | undefined {
    const row = this.db.prepare(`
      SELECT id, display_name, path, device_id, default_runtime_id, git_json, health_json, metadata_json, created_at, updated_at, last_opened_at
      FROM workspace_registry
      WHERE id = ?
    `).get(workspaceId) as LocalWorkspaceRegistryRow | undefined;
    return row ? this.toWorkspaceRegistryEntry(row) : undefined;
  }

  upsertWorkspaceRegistryEntry(input: WorkspaceRegistryCreateInput & {
    workspaceId?: string;
    deviceId: string;
    git?: WorkspaceGitSummary;
    health?: WorkspaceHealthSummary;
  }): WorkspaceRegistryEntry {
    const id = input.workspaceId || input.displayName;
    const now = new Date().toISOString();
    const existing = this.getWorkspaceRegistryEntry(id);
    const health = input.health || existing?.health || {
      status: 'unknown' as const,
      summary: 'Workspace health has not been checked.',
      issues: [],
    };
    this.db.prepare(`
      INSERT INTO workspace_registry (
        id, display_name, path, device_id, default_runtime_id, git_json, health_json, metadata_json, created_at, updated_at, last_opened_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        path = excluded.path,
        device_id = excluded.device_id,
        default_runtime_id = excluded.default_runtime_id,
        git_json = excluded.git_json,
        health_json = excluded.health_json,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(
      id,
      input.displayName,
      input.path,
      input.deviceId,
      input.defaultRuntimeId || null,
      JSON.stringify(input.git || existing?.git || {}),
      JSON.stringify(health),
      JSON.stringify(input.metadata || existing?.metadata || {}),
      existing?.createdAt || now,
      now,
      existing?.lastOpenedAt || null,
    );
    return this.getWorkspaceRegistryEntry(id)!;
  }

  updateWorkspaceRegistryEntry(workspaceId: string, input: WorkspaceRegistryUpdateInput): WorkspaceRegistryEntry {
    const existing = this.getWorkspaceRegistryEntry(workspaceId);
    if (!existing) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    return this.upsertWorkspaceRegistryEntry({
      workspaceId,
      displayName: input.displayName || existing.displayName,
      path: input.path || existing.path,
      deviceId: existing.deviceId,
      defaultRuntimeId: input.defaultRuntimeId === null ? undefined : input.defaultRuntimeId || existing.defaultRuntimeId,
      git: existing.git,
      health: existing.health,
      metadata: input.metadata || existing.metadata,
    });
  }

  deleteWorkspaceRegistryEntry(workspaceId: string) {
    this.db.prepare('DELETE FROM workspace_registry WHERE id = ?').run(workspaceId);
    return { deleted: true };
  }

  touchWorkspaceRegistryEntry(workspaceId: string) {
    this.db.prepare('UPDATE workspace_registry SET last_opened_at = ?, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), new Date().toISOString(), workspaceId);
  }

  getWorkspaceSecuritySettings(workspaceId: string): WorkspaceSecuritySettings {
    const row = this.db.prepare(`
      SELECT workspace_id, permissions_json, allow_paths_json, deny_paths_json, updated_at, updated_by
      FROM workspace_security_settings
      WHERE workspace_id = ?
    `).get(workspaceId) as LocalWorkspaceSecuritySettingsRow | undefined;
    if (row) {
      return this.toWorkspaceSecuritySettings(row);
    }
    const now = new Date().toISOString();
    return {
      workspaceId,
      permissions: defaultPermissions(),
      allowPaths: [],
      denyPaths: [],
      updatedAt: now,
    };
  }

  updateWorkspaceSecuritySettings(workspaceId: string, input: WorkspaceSecuritySettingsUpdateInput): WorkspaceSecuritySettings {
    const existing = this.getWorkspaceSecuritySettings(workspaceId);
    const now = new Date().toISOString();
    const next: WorkspaceSecuritySettings = {
      workspaceId,
      permissions: {
        ...existing.permissions,
        ...(input.permissions || {}),
      },
      allowPaths: Array.isArray(input.allowPaths) ? input.allowPaths : existing.allowPaths,
      denyPaths: Array.isArray(input.denyPaths) ? input.denyPaths : existing.denyPaths,
      updatedAt: now,
      updatedBy: input.updatedBy || existing.updatedBy,
    };
    this.db.prepare(`
      INSERT INTO workspace_security_settings (workspace_id, permissions_json, allow_paths_json, deny_paths_json, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        permissions_json = excluded.permissions_json,
        allow_paths_json = excluded.allow_paths_json,
        deny_paths_json = excluded.deny_paths_json,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
    `).run(
      workspaceId,
      JSON.stringify(next.permissions),
      JSON.stringify(next.allowPaths),
      JSON.stringify(next.denyPaths),
      now,
      next.updatedBy || null,
    );
    this.createAuditEvent({
      type: 'permission.changed',
      workspaceId,
      actor: next.updatedBy || 'local',
      summary: 'Workspace security settings changed.',
      metadata: {
        permissions: next.permissions,
        allowPaths: next.allowPaths,
        denyPaths: next.denyPaths,
      },
    });
    return this.getWorkspaceSecuritySettings(workspaceId);
  }

  createApprovalRequest(input: ApprovalRequestCreateInput): ApprovalRequest {
    const id = `approval:${randomUUID()}`;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO approval_requests (
        id, workspace_id, task_id, thread_id, run_id, device_id, kind, status, risk_level, title, description,
        requested_action, command, scopes_json, options_json, requested_by, created_at, updated_at, expires_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.workspaceId,
      input.taskId || null,
      input.threadId || null,
      input.runId || null,
      input.deviceId || 'local',
      input.kind,
      input.riskLevel,
      input.title,
      redactSecrets(input.description),
      redactSecrets(input.requestedAction),
      input.command ? redactSecrets(input.command) : null,
      JSON.stringify(input.scopes || []),
      JSON.stringify(input.options || []),
      input.requestedBy || null,
      now,
      now,
      input.expiresAt || null,
      JSON.stringify(input.metadata || {}),
    );
    const approval = this.getApprovalRequest(id)!;
    this.createAuditEvent({
      type: 'approval.requested',
      workspaceId: approval.workspaceId,
      taskId: approval.taskId,
      approvalId: approval.approvalId,
      actor: approval.requestedBy || 'agent',
      summary: approval.title,
      riskLevel: approval.riskLevel,
      metadata: {
        kind: approval.kind,
        requestedAction: approval.requestedAction,
        scopes: approval.scopes,
      },
    });
    if (approval.taskId) {
      this.updateAgentTask(approval.taskId, {
        approvalId: approval.approvalId,
        timelineItem: {
          type: 'approval_requested',
          title: approval.title,
          description: approval.description,
          metadata: { approvalId: approval.approvalId, riskLevel: approval.riskLevel },
        },
      });
    }
    return approval;
  }

  listApprovalRequests(query: ApprovalRequestListQuery = {}): ApprovalRequestListResponse {
    const predicates: string[] = [];
    const params: Array<string | number> = [];
    if (query.workspaceId) {
      predicates.push('workspace_id = ?');
      params.push(query.workspaceId);
    }
    if (query.taskId) {
      predicates.push('task_id = ?');
      params.push(query.taskId);
    }
    if (query.status) {
      const statuses = (Array.isArray(query.status) ? query.status : [query.status]).map((status) => normalizeApprovalRequestStatus(status));
      predicates.push(`status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    }
    const limit = Math.max(1, Math.min(Number(query.limit || 50), 100));
    const where = predicates.length ? `WHERE ${predicates.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT *
      FROM approval_requests
      ${where}
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(...params, limit) as LocalApprovalRequestRow[];
    return { approvals: rows.map((row) => this.toApprovalRequest(row)) };
  }

  getApprovalRequest(approvalId: string): ApprovalRequest | undefined {
    const row = this.db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(approvalId) as LocalApprovalRequestRow | undefined;
    return row ? this.toApprovalRequest(row) : undefined;
  }

  resolveApprovalRequest(approvalId: string, input: ApprovalRequestResolveInput): ApprovalRequest {
    const existing = this.getApprovalRequest(approvalId);
    if (!existing) {
      throw new Error(`Approval not found: ${approvalId}`);
    }
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE approval_requests
      SET status = ?, resolved_by = ?, resolution = ?, resolved_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.status,
      input.resolvedBy || existing.resolvedBy || 'local',
      input.resolution || existing.resolution || null,
      now,
      now,
      approvalId,
    );
    const approval = this.getApprovalRequest(approvalId)!;
    this.createAuditEvent({
      type: input.status === 'rejected' ? 'approval.rejected' : 'approval.resolved',
      workspaceId: approval.workspaceId,
      taskId: approval.taskId,
      approvalId: approval.approvalId,
      actor: approval.resolvedBy || 'local',
      summary: `Approval ${input.status}: ${approval.title}`,
      riskLevel: approval.riskLevel,
      metadata: { resolution: approval.resolution },
    });
    if (approval.taskId) {
      this.updateAgentTask(approval.taskId, {
        timelineItem: {
          type: 'approval_resolved',
          title: `Approval ${input.status}`,
          description: approval.resolution || approval.title,
          metadata: { approvalId: approval.approvalId, status: input.status },
        },
      });
    }
    return approval;
  }

  createAuditEvent(input: {
    type: AuditEventType;
    workspaceId?: string;
    taskId?: string;
    approvalId?: string;
    actor?: string;
    summary: string;
    riskLevel?: AuditEvent['riskLevel'];
    metadata?: Record<string, unknown>;
  }): AuditEvent {
    const id = `audit:${randomUUID()}`;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO audit_events (id, type, workspace_id, task_id, approval_id, actor, summary, risk_level, created_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.type,
      input.workspaceId || null,
      input.taskId || null,
      input.approvalId || null,
      input.actor || null,
      redactSecrets(input.summary),
      input.riskLevel || null,
      now,
      JSON.stringify(input.metadata || {}),
    );
    return this.toAuditEvent(this.db.prepare('SELECT * FROM audit_events WHERE id = ?').get(id) as LocalAuditEventRow);
  }

  listAuditEvents(query: AuditEventListQuery = {}): AuditEventListResponse {
    const predicates: string[] = [];
    const params: Array<string | number> = [];
    if (query.workspaceId) {
      predicates.push('workspace_id = ?');
      params.push(query.workspaceId);
    }
    if (query.taskId) {
      predicates.push('task_id = ?');
      params.push(query.taskId);
    }
    if (query.approvalId) {
      predicates.push('approval_id = ?');
      params.push(query.approvalId);
    }
    if (query.type) {
      const types = Array.isArray(query.type) ? query.type : [query.type];
      predicates.push(`type IN (${types.map(() => '?').join(', ')})`);
      params.push(...types);
    }
    const limit = Math.max(1, Math.min(Number(query.limit || 50), 100));
    const where = predicates.length ? `WHERE ${predicates.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT *
      FROM audit_events
      ${where}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(...params, limit) as LocalAuditEventRow[];
    return { events: rows.map((row) => this.toAuditEvent(row)) };
  }

  createAgentTask(input: AgentTaskCreateInput & { deviceId: string; runId?: string; status?: AgentTaskStatus }): AgentTask {
    const id = `task:${randomUUID()}`;
    const now = new Date().toISOString();
    const status = normalizeAgentTaskStatus(input.status);
    const timeline = [{
      id: `timeline:${randomUUID()}`,
      type: 'status_change' as const,
      title: `Task ${status}`,
      status,
      timestamp: now,
    }];
    this.db.prepare(`
      INSERT INTO agent_tasks (
        id, workspace_id, device_id, runtime_id, thread_id, run_id, title, prompt, status, created_at, updated_at, queued_at,
        started_at, completed_at, summary, error, timeline_json, logs_json, artifacts_json, approval_ids_json, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, '[]', '[]', '[]', ?)
    `).run(
      id,
      input.workspaceId,
      input.deviceId,
      input.runtimeId,
      input.threadId || null,
      input.runId || null,
      input.title,
      input.prompt ? redactSecrets(input.prompt) : null,
      status,
      now,
      now,
      status === 'queued' ? now : null,
      status === 'running' ? now : null,
      JSON.stringify(timeline),
      JSON.stringify(input.metadata || {}),
    );
    const task = this.getAgentTask(id)!;
    this.createAuditEvent({
      type: 'task.created',
      workspaceId: task.workspaceId,
      taskId: task.taskId,
      actor: 'local',
      summary: `Task created: ${task.title}`,
      metadata: { runtimeId: task.runtimeId, threadId: task.threadId, runId: task.runId },
    });
    return task;
  }

  listAgentTasks(query: AgentTaskListQuery = {}): AgentTaskListResponse {
    const predicates: string[] = [];
    const params: Array<string | number> = [];
    if (query.workspaceId) {
      predicates.push('workspace_id = ?');
      params.push(query.workspaceId);
    }
    if (query.runtimeId) {
      predicates.push('runtime_id = ?');
      params.push(query.runtimeId);
    }
    if (query.status) {
      const statuses = (Array.isArray(query.status) ? query.status : [query.status]).map((status) => normalizeAgentTaskStatus(status));
      predicates.push(`status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    }
    const limit = Math.max(1, Math.min(Number(query.limit || 50), 100));
    const where = predicates.length ? `WHERE ${predicates.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT *
      FROM agent_tasks
      ${where}
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(...params, limit) as LocalAgentTaskRow[];
    return { tasks: rows.map((row) => this.toAgentTask(row)) };
  }

  getAgentTask(taskId: string): AgentTask | undefined {
    const row = this.db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(taskId) as LocalAgentTaskRow | undefined;
    return row ? this.toAgentTask(row) : undefined;
  }

  getAgentTaskByRunId(runId: string): AgentTask | undefined {
    const row = this.db.prepare('SELECT * FROM agent_tasks WHERE run_id = ? ORDER BY updated_at DESC LIMIT 1').get(runId) as LocalAgentTaskRow | undefined;
    return row ? this.toAgentTask(row) : undefined;
  }

  updateAgentTask(taskId: string, input: AgentTaskUpdateInput): AgentTask {
    const existing = this.getAgentTask(taskId);
    if (!existing) {
      throw new Error(`Task not found: ${taskId}`);
    }
    const now = new Date().toISOString();
    const nextStatus = input.status ? normalizeAgentTaskStatus(input.status) : existing.status;
    const timeline = [...existing.timeline];
    const logs = [...existing.logs];
    const artifacts = [...existing.artifacts];
    const approvalIds = [...existing.approvalIds];
    if (input.status && nextStatus !== existing.status) {
      timeline.push({
        id: `timeline:${randomUUID()}`,
        type: 'status_change',
        title: `Task ${nextStatus}`,
        status: nextStatus,
        timestamp: now,
      });
    }
    if (input.timelineItem) {
      timeline.push({
        id: input.timelineItem.id || `timeline:${randomUUID()}`,
        timestamp: input.timelineItem.timestamp || now,
        ...input.timelineItem,
      });
    }
    if (input.log) {
      logs.push({
        id: input.log.id || `log:${randomUUID()}`,
        timestamp: input.log.timestamp || now,
        ...input.log,
        message: redactSecrets(input.log.message),
      });
    }
    if (input.artifact) {
      artifacts.push({
        id: input.artifact.id || `artifact:${randomUUID()}`,
        ...input.artifact,
      });
    }
    if (input.approvalId && !approvalIds.includes(input.approvalId)) {
      approvalIds.push(input.approvalId);
    }
    this.db.prepare(`
      UPDATE agent_tasks
      SET status = ?, thread_id = ?, run_id = ?, title = ?, updated_at = ?, queued_at = ?, started_at = ?, completed_at = ?,
          summary = ?, error = ?, timeline_json = ?, logs_json = ?, artifacts_json = ?, approval_ids_json = ?, metadata_json = ?
      WHERE id = ?
    `).run(
      nextStatus,
      input.threadId || existing.threadId || null,
      input.runId || existing.runId || null,
      input.title || existing.title,
      now,
      existing.queuedAt || (nextStatus === 'queued' ? now : null),
      existing.startedAt || (nextStatus === 'running' ? now : null),
      existing.completedAt || (['completed', 'failed', 'cancelled'].includes(nextStatus) ? now : null),
      input.summary ?? existing.summary ?? null,
      input.error === null ? null : input.error ?? existing.error ?? null,
      JSON.stringify(timeline),
      JSON.stringify(logs),
      JSON.stringify(artifacts),
      JSON.stringify(approvalIds),
      JSON.stringify(input.metadata || existing.metadata || {}),
      taskId,
    );
    const task = this.getAgentTask(taskId)!;
    if (input.status && nextStatus !== existing.status) {
      this.createAuditEvent({
        type: 'task.updated',
        workspaceId: task.workspaceId,
        taskId: task.taskId,
        actor: 'local',
        summary: `Task status changed to ${nextStatus}.`,
        metadata: { previousStatus: existing.status, status: nextStatus, runId: task.runId },
      });
    }
    return task;
  }

  listScheduledJobs(workspaceId?: string): ScheduledJob[] {
    const query = workspaceId
      ? `
        SELECT id, workspace_id, platform, route_type, route_config, trigger_type, cron_expr, run_at, prompt_template, description,
               enabled, concurrency_policy, created_at, updated_at, last_run_at, last_status, last_error, execution_mode
        FROM scheduled_jobs
        WHERE workspace_id = ?
        ORDER BY updated_at DESC
      `
      : `
        SELECT id, workspace_id, platform, route_type, route_config, trigger_type, cron_expr, run_at, prompt_template, description,
               enabled, concurrency_policy, created_at, updated_at, last_run_at, last_status, last_error, execution_mode
        FROM scheduled_jobs
        ORDER BY updated_at DESC
      `;
    const rows = this.db.prepare(query).all(...(workspaceId ? [workspaceId] : [])) as LocalScheduledJobRow[];
    return rows.map((row) => this.toScheduledJob(row));
  }

  getScheduledJob(jobId: string): ScheduledJob | undefined {
    const row = this.db.prepare(`
      SELECT id, workspace_id, platform, route_type, route_config, trigger_type, cron_expr, run_at, prompt_template, description,
             enabled, concurrency_policy, created_at, updated_at, last_run_at, last_status, last_error, execution_mode
      FROM scheduled_jobs
      WHERE id = ?
    `).get(jobId) as LocalScheduledJobRow | undefined;
    return row ? this.toScheduledJob(row) : undefined;
  }

  createScheduledJob(input: ScheduledJobCreateInput): ScheduledJob {
    if (!input.platform || !input.route) {
      throw new Error('Scheduled job creation requires a resolved platform and route.');
    }
    let id = createScheduledJobId();
    for (let attempt = 0; attempt < 5 && this.getScheduledJob(id); attempt += 1) {
      id = createScheduledJobId();
    }
    if (this.getScheduledJob(id)) {
      throw new Error('Unable to allocate a unique scheduled job id.');
    }
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO scheduled_jobs (
        id, workspace_id, platform, route_type, route_config, execution_mode, trigger_type, cron_expr, run_at,
        prompt_template, description, enabled, concurrency_policy, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'skip_if_running', ?, ?)
    `).run(
      id,
      input.workspaceId,
      normalizeChannelPlatform(input.platform),
      input.route.type,
      JSON.stringify(input.route),
      normalizeScheduledJobExecutionMode(input.executionMode),
      normalizeScheduledJobTriggerType(input.triggerType),
      input.cronExpr || null,
      input.runAt || null,
      input.promptTemplate,
      input.description || '',
      input.enabled === false ? 0 : 1,
      now,
      now,
    );
    return this.getScheduledJob(id)!;
  }

  updateScheduledJob(jobId: string, input: ScheduledJobUpdateInput): ScheduledJob {
    const existing = this.getScheduledJob(jobId);
    if (!existing) {
      throw new Error(`Scheduled job not found: ${jobId}`);
    }
    const next = {
      ...existing,
      ...(input.route ? { route: input.route } : {}),
      ...(input.executionMode ? { executionMode: normalizeScheduledJobExecutionMode(input.executionMode) } : {}),
      ...(input.triggerType ? { triggerType: normalizeScheduledJobTriggerType(input.triggerType) } : {}),
      ...(Object.prototype.hasOwnProperty.call(input, 'cronExpr') ? { cronExpr: input.cronExpr || undefined } : {}),
      ...(Object.prototype.hasOwnProperty.call(input, 'runAt') ? { runAt: input.runAt || undefined } : {}),
      ...(typeof input.promptTemplate === 'string' ? { promptTemplate: input.promptTemplate } : {}),
      ...(typeof input.description === 'string' ? { description: input.description } : {}),
      ...(typeof input.enabled === 'boolean' ? { enabled: input.enabled } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.db.prepare(`
      UPDATE scheduled_jobs
      SET route_type = ?, route_config = ?, execution_mode = ?, trigger_type = ?, cron_expr = ?, run_at = ?, prompt_template = ?,
          description = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `).run(
      next.route.type,
      JSON.stringify(next.route),
      next.executionMode,
      next.triggerType,
      next.cronExpr || null,
      next.runAt || null,
      next.promptTemplate,
      next.description,
      next.enabled ? 1 : 0,
      next.updatedAt,
      jobId,
    );
    return this.getScheduledJob(jobId)!;
  }

  deleteScheduledJob(jobId: string) {
    const result = this.db.prepare('DELETE FROM scheduled_jobs WHERE id = ?').run(jobId);
    if (result.changes === 0) {
      throw new Error(`Scheduled job not found: ${jobId}`);
    }
    return { deleted: true };
  }

  listScheduledJobRuns(jobId: string): ScheduledJobRun[] {
    const rows = this.db.prepare(`
      SELECT id, job_id, status, triggered_at, started_at, finished_at, error, thread_id, run_id, platform_message_id, platform_message_ids_json, delivery_mode, delivery_status, delivery_error, last_bridge_event_at
      FROM scheduled_job_runs
      WHERE job_id = ?
      ORDER BY triggered_at DESC
    `).all(jobId) as LocalScheduledJobRunRow[];
    return rows.map((row) => this.toScheduledJobRun(row));
  }

  createScheduledJobRun(jobId: string, status: ScheduledJobRun['status'], input: Partial<ScheduledJobRun> = {}): ScheduledJobRun {
    const id = `jobrun:${randomUUID()}`;
    const triggeredAt = input.triggeredAt || new Date().toISOString();
    const normalizedStatus = normalizeScheduledJobRunStatus(status);
    this.db.prepare(`
      INSERT INTO scheduled_job_runs (id, job_id, status, triggered_at, started_at, finished_at, error, thread_id, run_id, platform_message_id, platform_message_ids_json, delivery_mode, delivery_status, delivery_error, last_bridge_event_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      jobId,
      normalizedStatus,
      triggeredAt,
      input.startedAt || null,
      input.finishedAt || null,
      input.error || null,
      input.threadId || null,
      input.runId || null,
      input.platformMessageId || null,
      JSON.stringify(input.platformMessageIds || []),
      input.deliveryMode || null,
      input.deliveryStatus || null,
      input.deliveryError || null,
      input.lastBridgeEventAt || null,
    );
    this.updateScheduledJobStatus(jobId, {
      lastRunAt: triggeredAt,
      lastStatus: normalizedStatus,
      lastError: input.error || '',
    });
    return this.getScheduledJobRun(id)!;
  }

  getScheduledJobRun(runId: string): ScheduledJobRun | undefined {
    const row = this.db.prepare(`
      SELECT id, job_id, status, triggered_at, started_at, finished_at, error, thread_id, run_id, platform_message_id, platform_message_ids_json, delivery_mode, delivery_status, delivery_error, last_bridge_event_at
      FROM scheduled_job_runs
      WHERE id = ?
    `).get(runId) as LocalScheduledJobRunRow | undefined;
    return row ? this.toScheduledJobRun(row) : undefined;
  }

  updateScheduledJobRun(runId: string, input: Partial<ScheduledJobRun>) {
    const existing = this.getScheduledJobRun(runId);
    if (!existing) {
      throw new Error(`Scheduled job run not found: ${runId}`);
    }
    const next = {
      ...existing,
      ...input,
      ...(input.status ? { status: normalizeScheduledJobRunStatus(input.status) } : {}),
    };
    this.db.prepare(`
      UPDATE scheduled_job_runs
      SET status = ?, triggered_at = ?, started_at = ?, finished_at = ?, error = ?, thread_id = ?, run_id = ?, platform_message_id = ?, platform_message_ids_json = ?, delivery_mode = ?, delivery_status = ?, delivery_error = ?, last_bridge_event_at = ?
      WHERE id = ?
    `).run(
      next.status,
      next.triggeredAt,
      next.startedAt || null,
      next.finishedAt || null,
      next.error || null,
      next.threadId || null,
      next.runId || null,
      next.platformMessageId || null,
      JSON.stringify(next.platformMessageIds || []),
      next.deliveryMode || null,
      next.deliveryStatus || null,
      next.deliveryError || null,
      next.lastBridgeEventAt || null,
      runId,
    );
    if (input.status || Object.prototype.hasOwnProperty.call(input, 'error') || input.finishedAt || input.triggeredAt) {
      this.updateScheduledJobStatus(existing.jobId, {
        lastRunAt: next.triggeredAt,
        lastStatus: next.status,
        lastError: next.error || '',
      });
    }
    return this.getScheduledJobRun(runId)!;
  }

  updateScheduledJobStatus(jobId: string, input: {
    lastRunAt?: string;
    lastStatus?: ScheduledJobRun['status'];
    lastError?: string;
    enabled?: boolean;
  }) {
    this.db.prepare(`
      UPDATE scheduled_jobs
      SET last_run_at = COALESCE(?, last_run_at),
          last_status = COALESCE(?, last_status),
          last_error = CASE WHEN ? IS NULL THEN last_error ELSE ? END,
          enabled = CASE WHEN ? IS NULL THEN enabled ELSE ? END,
          updated_at = ?
      WHERE id = ?
    `).run(
      input.lastRunAt || null,
      input.lastStatus || null,
      input.lastError == null ? null : input.lastError,
      input.lastError == null ? null : input.lastError,
      typeof input.enabled === 'boolean' ? (input.enabled ? 1 : 0) : null,
      typeof input.enabled === 'boolean' ? (input.enabled ? 1 : 0) : null,
      new Date().toISOString(),
      jobId,
    );
  }

  getThreadRow(threadId: string) {
    return this.db.prepare(`
      SELECT id, workspace_id, session_id, bridge_session_key, title, agent_type, created_at, updated_at, history_count, excerpt, acp_session_id, acp_supports_load, agent_mode
      FROM threads
      WHERE id = ?
    `).get(threadId) as LocalThreadRow | undefined;
  }

  updateThreadAgentMode(threadId: string, mode: string) {
    this.db.prepare(`
      UPDATE threads
      SET agent_mode = ?, updated_at = ?
      WHERE id = ?
    `).run(mode, new Date().toISOString(), threadId);
  }

  updateThreadSession(threadId: string, sessionId: string, supportsLoad: boolean) {
    this.db.prepare(`
      UPDATE threads
      SET acp_session_id = ?, acp_supports_load = ?, updated_at = COALESCE(updated_at, ?)
      WHERE id = ?
    `).run(sessionId, supportsLoad ? 1 : 0, new Date().toISOString(), threadId);
  }

  createPairingRequest(input: Omit<LocalPlatformPairingRow, 'platform'> & { platform?: string }) {
    this.db.prepare(`
      INSERT INTO platform_pairings (code, workspace_id, platform, platform_user_id, chat_id, display_name, requested_at, expires_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.code,
      input.workspace_id,
      input.platform || 'lark',
      input.platform_user_id,
      input.chat_id,
      input.display_name,
      input.requested_at,
      input.expires_at,
      input.status,
    );
  }

  listPendingPairings(workspaceId?: string) {
    const query = workspaceId
      ? `
        SELECT code, workspace_id, platform, platform_user_id, chat_id, display_name, requested_at, expires_at, status
        FROM platform_pairings
        WHERE workspace_id = ? AND status = 'pending'
        ORDER BY requested_at DESC
      `
      : `
        SELECT code, workspace_id, platform, platform_user_id, chat_id, display_name, requested_at, expires_at, status
        FROM platform_pairings
        WHERE status = 'pending'
        ORDER BY requested_at DESC
      `;
    return this.db.prepare(query).all(...(workspaceId ? [workspaceId] : [])) as LocalPlatformPairingRow[];
  }

  getPairingRequest(code: string) {
    return this.db.prepare(`
      SELECT code, workspace_id, platform, platform_user_id, chat_id, display_name, requested_at, expires_at, status
      FROM platform_pairings
      WHERE code = ?
    `).get(code) as LocalPlatformPairingRow | undefined;
  }

  updatePairingStatus(code: string, status: LocalPlatformPairingRow['status']) {
    this.db.prepare('UPDATE platform_pairings SET status = ? WHERE code = ?').run(status, code);
  }

  expirePendingPairings(nowIso = new Date().toISOString()) {
    this.db.prepare(`
      UPDATE platform_pairings
      SET status = 'expired'
      WHERE status = 'pending' AND expires_at < ?
    `).run(nowIso);
  }

  getAuthorizedUser(workspaceId: string, platformUserId: string, platform = 'lark') {
    return this.db.prepare(`
      SELECT id, workspace_id, platform, platform_user_id, chat_id, display_name, thread_id, authorized_at
      FROM platform_users
      WHERE workspace_id = ? AND platform = ? AND platform_user_id = ?
    `).get(workspaceId, platform, platformUserId) as LocalPlatformUserRow | undefined;
  }

  listAuthorizedUsers(workspaceId?: string, platform?: string): LocalCoreAuthorizedUser[] {
    const params: string[] = [];
    const predicates: string[] = [];
    if (workspaceId) {
      predicates.push('workspace_id = ?');
      params.push(workspaceId);
    }
    if (platform) {
      predicates.push('platform = ?');
      params.push(platform);
    }
    const where = predicates.length > 0 ? `WHERE ${predicates.join(' AND ')}` : '';
    const query = `
        SELECT id, workspace_id, platform, platform_user_id, chat_id, display_name, thread_id, authorized_at
        FROM platform_users
        ${where}
        ORDER BY authorized_at DESC
      `;
    const rows = this.db.prepare(query).all(...params) as LocalPlatformUserRow[];
    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      platform: row.platform,
      participantId: row.platform_user_id,
      channelId: row.chat_id,
      platformUserId: row.platform_user_id,
      chatId: row.chat_id,
      displayName: row.display_name,
      threadId: row.thread_id || undefined,
      authorizedAt: row.authorized_at,
    }));
  }

  createAuthorizedUser(input: Omit<LocalPlatformUserRow, 'platform'> & { platform?: string }) {
    this.db.prepare(`
      INSERT INTO platform_users (id, workspace_id, platform, platform_user_id, chat_id, display_name, thread_id, authorized_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, platform, platform_user_id) DO UPDATE SET
        chat_id = excluded.chat_id,
        display_name = excluded.display_name,
        thread_id = COALESCE(excluded.thread_id, platform_users.thread_id),
        authorized_at = excluded.authorized_at
    `).run(
      input.id,
      input.workspace_id,
      input.platform || 'lark',
      input.platform_user_id,
      input.chat_id,
      input.display_name,
      input.thread_id,
      input.authorized_at,
    );
  }

  updateAuthorizedUserThread(workspaceId: string, platformUserId: string, threadId: string, platform = 'lark') {
    this.db.prepare(`
      UPDATE platform_users
      SET thread_id = ?
      WHERE workspace_id = ? AND platform = ? AND platform_user_id = ?
    `).run(threadId, workspaceId, platform, platformUserId);
  }

  getPlatformThreadBinding(workspaceId: string, chatId: string, platformUserId: string, platform = 'lark') {
    return this.db.prepare(`
      SELECT workspace_id, platform, chat_id, platform_user_id, thread_id, last_platform_message_id, created_at, updated_at
      FROM platform_thread_bindings
      WHERE workspace_id = ? AND platform = ? AND chat_id = ? AND platform_user_id = ?
    `).get(workspaceId, platform, chatId, platformUserId) as LocalPlatformThreadBindingRow | undefined;
  }

  getPlatformThreadBindingByThreadId(threadId: string) {
    return this.db.prepare(`
      SELECT workspace_id, platform, chat_id, platform_user_id, thread_id, last_platform_message_id, created_at, updated_at
      FROM platform_thread_bindings
      WHERE thread_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(threadId) as LocalPlatformThreadBindingRow | undefined;
  }

  upsertPlatformThreadBinding(input: Omit<LocalPlatformThreadBindingRow, 'platform'> & { platform?: string }) {
    this.db.prepare(`
      INSERT INTO platform_thread_bindings
      (workspace_id, platform, chat_id, platform_user_id, thread_id, last_platform_message_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, platform, chat_id, platform_user_id) DO UPDATE SET
        thread_id = excluded.thread_id,
        last_platform_message_id = COALESCE(excluded.last_platform_message_id, platform_thread_bindings.last_platform_message_id),
        updated_at = excluded.updated_at
    `).run(
      input.workspace_id,
      input.platform || 'lark',
      input.chat_id,
      input.platform_user_id,
      input.thread_id,
      input.last_platform_message_id,
      input.created_at,
      input.updated_at,
    );
  }

  updatePlatformThreadMessageId(workspaceId: string, chatId: string, platformUserId: string, messageId: string, platform = 'lark') {
    this.db.prepare(`
      UPDATE platform_thread_bindings
      SET last_platform_message_id = ?, updated_at = ?
      WHERE workspace_id = ? AND platform = ? AND chat_id = ? AND platform_user_id = ?
    `).run(messageId, new Date().toISOString(), workspaceId, platform, chatId, platformUserId);
  }

  clearPlatformThreadMessageId(workspaceId: string, chatId: string, platformUserId: string, platform = 'lark') {
    this.db.prepare(`
      UPDATE platform_thread_bindings
      SET last_platform_message_id = NULL, updated_at = ?
      WHERE workspace_id = ? AND platform = ? AND chat_id = ? AND platform_user_id = ?
    `).run(new Date().toISOString(), workspaceId, platform, chatId, platformUserId);
  }

  listPairingRequests(workspaceId?: string, platform?: string): LocalCorePairingRequest[] {
    const params: string[] = [];
    const predicates: string[] = [];
    if (workspaceId) {
      predicates.push('workspace_id = ?');
      params.push(workspaceId);
    }
    if (platform) {
      predicates.push('platform = ?');
      params.push(platform);
    }
    const where = predicates.length > 0 ? `WHERE ${predicates.join(' AND ')}` : '';
    const query = `
        SELECT code, workspace_id, platform, platform_user_id, chat_id, display_name, requested_at, expires_at, status
        FROM platform_pairings
        ${where}
        ORDER BY requested_at DESC
      `;
    const rows = this.db.prepare(query).all(...params) as LocalPlatformPairingRow[];
    return rows.map((row) => ({
      code: row.code,
      workspaceId: row.workspace_id,
      platform: row.platform,
      participantId: row.platform_user_id,
      channelId: row.chat_id,
      platformUserId: row.platform_user_id,
      chatId: row.chat_id,
      displayName: row.display_name,
      requestedAt: row.requested_at,
      expiresAt: row.expires_at,
      status: row.status,
    }));
  }

  private toScheduledJob(row: LocalScheduledJobRow): ScheduledJob {
    const route = JSON.parse(row.route_config) as ScheduledJob['route'];
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      platform: normalizeChannelPlatform(row.platform),
      route,
      executionMode: normalizeScheduledJobExecutionMode(row.execution_mode),
      triggerType: normalizeScheduledJobTriggerType(row.trigger_type),
      cronExpr: row.cron_expr || undefined,
      runAt: row.run_at || undefined,
      promptTemplate: row.prompt_template,
      description: row.description,
      enabled: Boolean(row.enabled),
      concurrencyPolicy: row.concurrency_policy,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastRunAt: row.last_run_at || undefined,
      lastStatus: row.last_status ? normalizeScheduledJobRunStatus(row.last_status) : undefined,
      lastError: row.last_error || undefined,
    };
  }

  private toScheduledJobRun(row: LocalScheduledJobRunRow): ScheduledJobRun {
    return {
      id: row.id,
      jobId: row.job_id,
      status: normalizeScheduledJobRunStatus(row.status),
      triggeredAt: row.triggered_at,
      startedAt: row.started_at || undefined,
      finishedAt: row.finished_at || undefined,
      error: row.error || undefined,
      threadId: row.thread_id || undefined,
      runId: row.run_id || undefined,
      platformMessageId: row.platform_message_id || undefined,
      platformMessageIds: parseJson(row.platform_message_ids_json || '[]', []),
      deliveryMode: row.delivery_mode || undefined,
      deliveryStatus: row.delivery_status || undefined,
      deliveryError: row.delivery_error || undefined,
      lastBridgeEventAt: row.last_bridge_event_at || undefined,
    };
  }

  private toWorkspaceRegistryEntry(row: LocalWorkspaceRegistryRow): WorkspaceRegistryEntry {
    const activeTaskCount = Number((this.db.prepare(`
      SELECT COUNT(*) AS total
      FROM agent_tasks
      WHERE workspace_id = ? AND status IN ('created', 'queued', 'running', 'waiting_for_user')
    `).get(row.id) as { total: number } | undefined)?.total || 0);
    const recentTaskRows = this.db.prepare(`
      SELECT id
      FROM agent_tasks
      WHERE workspace_id = ?
      ORDER BY updated_at DESC
      LIMIT 8
    `).all(row.id) as Array<{ id: string }>;
    return {
      workspaceId: row.id,
      displayName: row.display_name,
      path: row.path,
      deviceId: row.device_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastOpenedAt: row.last_opened_at || undefined,
      defaultRuntimeId: row.default_runtime_id || undefined,
      git: parseJson(row.git_json, { isRepo: false }),
      health: parseJson(row.health_json, {
        status: 'unknown',
        summary: 'Workspace health has not been checked.',
        issues: [],
      }),
      activeTaskCount,
      recentTaskIds: recentTaskRows.map((item) => item.id),
      metadata: parseJson(row.metadata_json, {}),
    };
  }

  private toAgentTask(row: LocalAgentTaskRow): AgentTask {
    return {
      taskId: row.id,
      workspaceId: row.workspace_id,
      deviceId: row.device_id,
      runtimeId: row.runtime_id,
      threadId: row.thread_id || undefined,
      runId: row.run_id || undefined,
      title: row.title,
      prompt: row.prompt || undefined,
      status: normalizeAgentTaskStatus(row.status),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      queuedAt: row.queued_at || undefined,
      startedAt: row.started_at || undefined,
      completedAt: row.completed_at || undefined,
      summary: row.summary || undefined,
      error: row.error || undefined,
      timeline: parseJson(row.timeline_json, []),
      logs: parseJson(row.logs_json, []),
      artifacts: parseJson(row.artifacts_json, []),
      approvalIds: parseJson(row.approval_ids_json, []),
      metadata: parseJson(row.metadata_json, {}),
    };
  }

  private toWorkspaceSecuritySettings(row: LocalWorkspaceSecuritySettingsRow): WorkspaceSecuritySettings {
    return {
      workspaceId: row.workspace_id,
      permissions: {
        ...defaultPermissions(),
        ...parseJson(row.permissions_json, {}),
      },
      allowPaths: parseJson(row.allow_paths_json, []),
      denyPaths: parseJson(row.deny_paths_json, []),
      updatedAt: row.updated_at,
      updatedBy: row.updated_by || undefined,
    };
  }

  private toApprovalRequest(row: LocalApprovalRequestRow): ApprovalRequest {
    return {
      approvalId: row.id,
      workspaceId: row.workspace_id,
      taskId: row.task_id || undefined,
      threadId: row.thread_id || undefined,
      runId: row.run_id || undefined,
      deviceId: row.device_id,
      kind: row.kind as ApprovalRequest['kind'],
      status: normalizeApprovalRequestStatus(row.status),
      riskLevel: row.risk_level as ApprovalRequest['riskLevel'],
      title: row.title,
      description: row.description,
      requestedAction: row.requested_action,
      command: row.command || undefined,
      scopes: parseJson(row.scopes_json, []),
      options: parseJson(row.options_json, []),
      requestedBy: row.requested_by || undefined,
      resolvedBy: row.resolved_by || undefined,
      resolution: row.resolution || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      resolvedAt: row.resolved_at || undefined,
      expiresAt: row.expires_at || undefined,
      metadata: parseJson(row.metadata_json, {}),
    };
  }

  private toAuditEvent(row: LocalAuditEventRow): AuditEvent {
    return {
      auditId: row.id,
      type: row.type as AuditEventType,
      workspaceId: row.workspace_id || undefined,
      taskId: row.task_id || undefined,
      approvalId: row.approval_id || undefined,
      actor: row.actor || undefined,
      summary: row.summary,
      riskLevel: row.risk_level as AuditEvent['riskLevel'] || undefined,
      createdAt: row.created_at,
      metadata: parseJson(row.metadata_json, {}),
    };
  }

  private ensureColumn(table: string, column: string, definition: string) {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (rows.some((row) => row.name === column)) {
      return;
    }
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeBridgeKind(value: string | null | undefined): DesktopBridgeEventKind | undefined {
  switch (value) {
    case 'assistant':
    case 'thought':
    case 'plan':
    case 'tool':
    case 'status':
    case 'permission':
      return value;
    default:
      return undefined;
  }
}

function normalizeBridgeStatus(value: string | null | undefined): DesktopBridgeEvent['bridgeStatus'] | undefined {
  return value === 'awaiting_input' ? value : undefined;
}

function defaultPermissions(): Record<SecurityPermissionScope, SecurityPermissionLevel> {
  return {
    'workspace.read': 'allow',
    'workspace.write': 'ask',
    'command.execute': 'ask',
    'network.access': 'ask',
    'secrets.access': 'deny',
    'git.modify': 'ask',
  };
}

export function redactSecrets(value: string): string {
  return value
    .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, '[REDACTED_SECRET]')
    .replace(/\b([A-Za-z0-9_]*TOKEN[A-Za-z0-9_]*|[A-Za-z0-9_]*SECRET[A-Za-z0-9_]*|[A-Za-z0-9_]*KEY[A-Za-z0-9_]*)=([^\s]+)/gi, '$1=[REDACTED_SECRET]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED_SECRET]');
}
