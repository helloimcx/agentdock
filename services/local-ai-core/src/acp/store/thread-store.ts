import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  ThreadDetail,
  ThreadSummary,
} from '@cc/superai-contracts';
import { normalizeRunStatus } from '@cc/superai-contracts';
import { LOCALCORE_ACP_AGENT_TYPE } from '@cc/superai-contracts';
import type { DesktopBridgeToolCall } from '@cc/superai-contracts';
import type {
  LocalMessageRow,
  LocalRunRow,
  LocalThreadRow,
  MessageContentArgs,
} from './acp-store-types.js';
import { normalizeMessageContent } from '../../thread/workspace-thread-mappers.js';
import { encodeThreadId } from '../../thread/workspace-thread-id.js';
import { normalizeBridgeKind, normalizeBridgeStatus, parseJson } from './utils.js';

export class LocalThreadStore {
  constructor(private readonly db: DatabaseSync) {}

  listSummaries(workspaceId: string): ThreadSummary[] {
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
      agentMode: row.agent_mode,
    }));
  }

  countByWorkspace(workspaceIds: ReadonlyArray<string>): Map<string, number> {
    const result = new Map<string, number>();
    if (workspaceIds.length === 0) return result;
    const placeholders = workspaceIds.map(() => '?').join(', ');
    const rows = this.db.prepare(`
      SELECT workspace_id, COUNT(*) AS total
      FROM threads
      WHERE workspace_id IN (${placeholders})
      GROUP BY workspace_id
    `).all(...workspaceIds) as Array<{ workspace_id: string; total: number }>;
    for (const id of workspaceIds) {
      result.set(id, 0);
    }
    for (const row of rows) {
      result.set(row.workspace_id, Number(row.total || 0));
    }
    return result;
  }

  create(workspaceId: string, title: string, agentType = LOCALCORE_ACP_AGENT_TYPE, agentMode = 'default'): ThreadDetail {
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
      agentMode: agentMode || 'default',
      messages: [],
      selectedKnowledgeBaseIds: [],
      pendingPermissionRequest: null,
    };
  }

  get(threadId: string, selectedKnowledgeBaseIds: string[]): ThreadDetail {
    const row = this.getRow(threadId);
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
      agentMode: row.agent_mode,
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

  rename(threadId: string, title: string) {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE threads SET title = ?, updated_at = ? WHERE id = ?').run(title, now, threadId);
  }

  delete(threadId: string) {
    this.db.prepare('DELETE FROM threads WHERE id = ?').run(threadId);
  }

  appendMessage(threadId: string, ...[role, content, kind, toolCall, bridgeKind, bridgeStatus]: MessageContentArgs) {
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

  upsertMessage(threadId: string, id: string, ...[role, content, kind, toolCall, bridgeKind, bridgeStatus]: MessageContentArgs) {
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

  getRow(threadId: string) {
    return this.db.prepare(`
      SELECT id, workspace_id, session_id, bridge_session_key, title, agent_type, created_at, updated_at, history_count, excerpt, acp_session_id, acp_supports_load, agent_mode
      FROM threads
      WHERE id = ?
    `).get(threadId) as LocalThreadRow | undefined;
  }

  updateAgentMode(threadId: string, mode: string) {
    this.db.prepare(`
      UPDATE threads
      SET agent_mode = ?, updated_at = ?
      WHERE id = ?
    `).run(mode, new Date().toISOString(), threadId);
  }

  updateAgentType(threadId: string, agentType: string) {
    this.db.prepare(`
      UPDATE threads
      SET agent_type = ?, acp_session_id = NULL, acp_supports_load = 0, updated_at = ?
      WHERE id = ?
    `).run(agentType, new Date().toISOString(), threadId);
  }

  updateSession(threadId: string, sessionId: string, supportsLoad: boolean) {
    this.db.prepare(`
      UPDATE threads
      SET acp_session_id = ?, acp_supports_load = ?, updated_at = COALESCE(updated_at, ?)
      WHERE id = ?
    `).run(sessionId, supportsLoad ? 1 : 0, new Date().toISOString(), threadId);
  }
}
