import type { DatabaseSync } from 'node:sqlite';
import type {
  WorkspaceGitSummary,
  WorkspaceHealthSummary,
  WorkspaceRegistryCreateInput,
  WorkspaceRegistryEntry,
  WorkspaceRegistryUpdateInput,
} from '@cc/superai-contracts';
import type { LocalWorkspaceRegistryRow } from '../../router/workspace-router-types.js';
import { parseJson } from './utils.js';

export class LocalWorkspaceRegistryStore {
  constructor(private readonly db: DatabaseSync) {}

  list(): WorkspaceRegistryEntry[] {
    const rows = this.db.prepare(`
      SELECT id, display_name, path, device_id, default_runtime_id, git_json, health_json, metadata_json, created_at, updated_at, last_opened_at
      FROM workspace_registry
      ORDER BY display_name ASC
    `).all() as LocalWorkspaceRegistryRow[];
    return rows.map((row) => this.toEntry(row));
  }

  get(workspaceId: string): WorkspaceRegistryEntry | undefined {
    const row = this.db.prepare(`
      SELECT id, display_name, path, device_id, default_runtime_id, git_json, health_json, metadata_json, created_at, updated_at, last_opened_at
      FROM workspace_registry
      WHERE id = ?
    `).get(workspaceId) as LocalWorkspaceRegistryRow | undefined;
    return row ? this.toEntry(row) : undefined;
  }

  upsert(input: WorkspaceRegistryCreateInput & {
    workspaceId?: string;
    deviceId: string;
    git?: WorkspaceGitSummary;
    health?: WorkspaceHealthSummary;
  }): WorkspaceRegistryEntry {
    const id = input.workspaceId || input.displayName;
    const now = new Date().toISOString();
    const existing = this.get(id);
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
    return this.get(id)!;
  }

  update(workspaceId: string, input: WorkspaceRegistryUpdateInput): WorkspaceRegistryEntry {
    const existing = this.get(workspaceId);
    if (!existing) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    return this.upsert({
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

  delete(workspaceId: string) {
    this.db.prepare('DELETE FROM workspace_registry WHERE id = ?').run(workspaceId);
    return { deleted: true };
  }

  touch(workspaceId: string) {
    this.db.prepare('UPDATE workspace_registry SET last_opened_at = ?, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), new Date().toISOString(), workspaceId);
  }

  private toEntry(row: LocalWorkspaceRegistryRow): WorkspaceRegistryEntry {
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
}
