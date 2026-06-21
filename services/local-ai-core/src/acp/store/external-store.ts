import type { DatabaseSync } from 'node:sqlite';
import type {
  ExternalProject,
  ExternalThread,
} from '@cc/superai-contracts';
import { parseJson } from './utils.js';

type ExternalProjectRow = {
  user_id: string;
  external_project_id: string;
  workspace_id: string;
  workspace_path: string;
  display_name: string;
  agent_type: string;
  provider_id: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type ExternalThreadRow = {
  user_id: string;
  external_project_id: string;
  external_thread_id: string;
  workspace_id: string;
  thread_id: string;
  workspace_path: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

export class LocalExternalStore {
  constructor(private readonly db: DatabaseSync) {}

  getProject(userId: string, externalProjectId: string): ExternalProject | undefined {
    const row = this.db.prepare(`
      SELECT user_id, external_project_id, workspace_id, workspace_path, display_name, agent_type, provider_id, metadata_json, created_at, updated_at
      FROM external_projects
      WHERE user_id = ? AND external_project_id = ?
    `).get(userId, externalProjectId) as ExternalProjectRow | undefined;
    return row ? this.toProject(row) : undefined;
  }

  upsertProject(input: ExternalProject): ExternalProject {
    const now = new Date().toISOString();
    const existing = this.getProject(input.userId, input.externalProjectId);
    this.db.prepare(`
      INSERT INTO external_projects (
        user_id, external_project_id, workspace_id, workspace_path, display_name, agent_type, provider_id,
        metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, external_project_id) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        workspace_path = excluded.workspace_path,
        display_name = excluded.display_name,
        agent_type = excluded.agent_type,
        provider_id = excluded.provider_id,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(
      input.userId,
      input.externalProjectId,
      input.workspaceId,
      input.workspacePath,
      input.displayName,
      input.agentType,
      input.providerId,
      JSON.stringify(input.metadata || existing?.metadata || {}),
      existing?.createdAt || input.createdAt || now,
      now,
    );
    return this.getProject(input.userId, input.externalProjectId)!;
  }

  getThread(userId: string, externalProjectId: string, externalThreadId: string): ExternalThread | undefined {
    const row = this.db.prepare(`
      SELECT user_id, external_project_id, external_thread_id, workspace_id, thread_id, workspace_path, metadata_json, created_at, updated_at
      FROM external_threads
      WHERE user_id = ? AND external_project_id = ? AND external_thread_id = ?
    `).get(userId, externalProjectId, externalThreadId) as ExternalThreadRow | undefined;
    return row ? this.toThread(row) : undefined;
  }

  getThreadByThreadId(threadId: string): ExternalThread | undefined {
    const row = this.db.prepare(`
      SELECT user_id, external_project_id, external_thread_id, workspace_id, thread_id, workspace_path, metadata_json, created_at, updated_at
      FROM external_threads
      WHERE thread_id = ?
    `).get(threadId) as ExternalThreadRow | undefined;
    return row ? this.toThread(row) : undefined;
  }

  upsertThread(input: ExternalThread): ExternalThread {
    const now = new Date().toISOString();
    const existing = this.getThread(input.userId, input.externalProjectId, input.externalThreadId);
    this.db.prepare(`
      INSERT INTO external_threads (
        user_id, external_project_id, external_thread_id, workspace_id, thread_id, workspace_path,
        metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, external_project_id, external_thread_id) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        thread_id = excluded.thread_id,
        workspace_path = excluded.workspace_path,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(
      input.userId,
      input.externalProjectId,
      input.externalThreadId,
      input.workspaceId,
      input.threadId,
      input.workspacePath,
      JSON.stringify(input.metadata || existing?.metadata || {}),
      existing?.createdAt || input.createdAt || now,
      now,
    );
    return this.getThread(input.userId, input.externalProjectId, input.externalThreadId)!;
  }

  private toProject(row: ExternalProjectRow): ExternalProject {
    return {
      userId: row.user_id,
      externalProjectId: row.external_project_id,
      workspaceId: row.workspace_id,
      workspacePath: row.workspace_path,
      displayName: row.display_name,
      agentType: row.agent_type,
      providerId: row.provider_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: parseJson(row.metadata_json, {}),
    };
  }

  private toThread(row: ExternalThreadRow): ExternalThread {
    return {
      userId: row.user_id,
      externalProjectId: row.external_project_id,
      externalThreadId: row.external_thread_id,
      workspaceId: row.workspace_id,
      threadId: row.thread_id,
      workspacePath: row.workspace_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: parseJson(row.metadata_json, {}),
    };
  }
}
