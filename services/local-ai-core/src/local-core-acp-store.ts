import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import type { ThreadDetail, ThreadSummary } from '../../../packages/contracts/src/index.js';
import { LOCALCORE_ACP_AGENT_TYPE } from '../../../shared/desktop.js';
import type { LocalMessageRow, LocalRunRow, LocalThreadRow } from './workspace-router-types.js';
import { normalizeMessageContent } from './workspace-thread-mappers.js';
import { encodeThreadId } from './workspace-thread-id.js';

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
        acp_supports_load INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_threads_workspace_updated ON threads (workspace_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
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
    `);
  }

  close() {
    this.db.close();
  }

  listThreadSummaries(workspaceId: string): ThreadSummary[] {
    const rows = this.db.prepare(`
      SELECT id, workspace_id, session_id, bridge_session_key, title, agent_type, created_at, updated_at, history_count, excerpt
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

  createThread(workspaceId: string, title: string, agentType = LOCALCORE_ACP_AGENT_TYPE): ThreadDetail {
    const sessionId = randomUUID();
    const threadId = encodeThreadId(workspaceId, sessionId);
    const now = new Date().toISOString();
    const bridgeSessionKey = `${LOCALCORE_ACP_AGENT_TYPE}:${workspaceId}:${sessionId}`;
    this.db.prepare(`
      INSERT INTO threads (id, workspace_id, session_id, bridge_session_key, title, agent_type, created_at, updated_at, history_count, excerpt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, '')
    `).run(threadId, workspaceId, sessionId, bridgeSessionKey, title, agentType, now, now);
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
    };
  }

  getThread(threadId: string, selectedKnowledgeBaseIds: string[]): ThreadDetail {
    const row = this.getThreadRow(threadId);
    if (!row) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    const messages = this.db.prepare(`
      SELECT id, thread_id, role, content, timestamp, kind, seq
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
        timestamp: message.timestamp,
        kind: message.kind,
      })),
      selectedKnowledgeBaseIds,
    };
  }

  renameThread(threadId: string, title: string) {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE threads SET title = ?, updated_at = ? WHERE id = ?').run(title, now, threadId);
  }

  deleteThread(threadId: string) {
    this.db.prepare('DELETE FROM threads WHERE id = ?').run(threadId);
  }

  appendMessage(threadId: string, role: LocalMessageRow['role'], content: string, kind: LocalMessageRow['kind']) {
    const timestamp = new Date().toISOString();
    const nextSequenceRow = this.db.prepare('SELECT COALESCE(MAX(seq), -1) + 1 AS next_seq FROM messages WHERE thread_id = ?').get(threadId) as { next_seq: number };
    const nextSeq = Number(nextSequenceRow?.next_seq || 0);
    const id = `${timestamp}-${role}-${nextSeq}`;
    const excerpt = normalizeMessageContent(content);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        INSERT INTO messages (id, thread_id, role, content, timestamp, kind, seq)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, threadId, role, content, timestamp, kind, nextSeq);
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

  updateRun(runId: string, threadId: string, status: LocalRunRow['status']) {
    const now = new Date().toISOString();
    const existing = this.db.prepare('SELECT id FROM runs WHERE id = ?').get(runId) as { id: string } | undefined;
    if (existing) {
      this.db.prepare('UPDATE runs SET status = ?, updated_at = ? WHERE id = ?').run(status, now, runId);
      return;
    }
    this.db.prepare(`
      INSERT INTO runs (id, thread_id, status, started_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(runId, threadId, status, now, now);
  }

  getThreadRow(threadId: string) {
    return this.db.prepare(`
      SELECT id, workspace_id, session_id, bridge_session_key, title, agent_type, created_at, updated_at, history_count, excerpt, acp_session_id, acp_supports_load
      FROM threads
      WHERE id = ?
    `).get(threadId) as LocalThreadRow | undefined;
  }

  updateThreadSession(threadId: string, sessionId: string, supportsLoad: boolean) {
    this.db.prepare(`
      UPDATE threads
      SET acp_session_id = ?, acp_supports_load = ?, updated_at = COALESCE(updated_at, ?)
      WHERE id = ?
    `).run(sessionId, supportsLoad ? 1 : 0, new Date().toISOString(), threadId);
  }
}
