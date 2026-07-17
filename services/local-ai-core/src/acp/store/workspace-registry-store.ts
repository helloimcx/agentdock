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
    if (rows.length === 0) return [];
    const activeTaskCountByWorkspace = this.fetchActiveTaskCounts();
    const recentTaskIdsByWorkspace = this.fetchRecentTaskIds();
    return rows.map((row) => this.shapeEntry(
      row,
      activeTaskCountByWorkspace.get(row.id) ?? 0,
      recentTaskIdsByWorkspace.get(row.id) ?? [],
    ));
  }

  get(workspaceId: string): WorkspaceRegistryEntry | undefined {
    const row = this.db.prepare(`
      SELECT id, display_name, path, device_id, default_runtime_id, git_json, health_json, metadata_json, created_at, updated_at, last_opened_at
      FROM workspace_registry
      WHERE id = ?
    `).get(workspaceId) as LocalWorkspaceRegistryRow | undefined;
    if (!row) return undefined;
    return this.shapeEntry(
      row,
      this.fetchActiveTaskCount(workspaceId),
      this.fetchRecentTaskIdsForWorkspace(workspaceId),
    );
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

  private fetchActiveTaskCounts(): Map<string, number> {
    const rows = this.db.prepare(`
      SELECT workspace_id, COUNT(*) AS total
      FROM agent_tasks
      WHERE status IN ('created', 'queued', 'running', 'waiting_for_user')
      GROUP BY workspace_id
    `).all() as Array<{ workspace_id: string; total: number }>;
    const result = new Map<string, number>();
    for (const row of rows) {
      result.set(row.workspace_id, Number(row.total || 0));
    }
    return result;
  }

  private fetchActiveTaskCount(workspaceId: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS total
      FROM agent_tasks
      WHERE workspace_id = ? AND status IN ('created', 'queued', 'running', 'waiting_for_user')
    `).get(workspaceId) as { total: number } | undefined;
    return Number(row?.total || 0);
  }

  private fetchRecentTaskIds(): Map<string, string[]> {
    const rows = this.db.prepare(`
      WITH ranked AS (
        SELECT workspace_id, id,
          ROW_NUMBER() OVER (PARTITION BY workspace_id ORDER BY updated_at DESC, id DESC) AS position
        FROM agent_tasks
      )
      SELECT workspace_id, id
      FROM ranked
      WHERE position <= 8
    `).all() as Array<{ workspace_id: string; id: string }>;
    const result = new Map<string, string[]>();
    for (const row of rows) {
      const list = result.get(row.workspace_id);
      if (list) {
        list.push(row.id);
      } else {
        result.set(row.workspace_id, [row.id]);
      }
    }
    return result;
  }

  private fetchRecentTaskIdsForWorkspace(workspaceId: string): string[] {
    const rows = this.db.prepare(`
      SELECT id
      FROM agent_tasks
      WHERE workspace_id = ?
      ORDER BY updated_at DESC
      LIMIT 8
    `).all(workspaceId) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  private shapeEntry(
    row: LocalWorkspaceRegistryRow,
    activeTaskCount: number,
    recentTaskIds: string[],
  ): WorkspaceRegistryEntry {
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
      recentTaskIds,
      metadata: parseJson(row.metadata_json, {}),
    };
  }
}
