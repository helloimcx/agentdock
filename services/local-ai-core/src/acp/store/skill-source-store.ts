import type { DatabaseSync } from 'node:sqlite';
import type { SkillSource, SkillScope } from '@cc/superai-contracts/skills';

export interface LocalSkillSourceRow {
  skill_id: string;
  scope: string;
  workspace_id: string;
  workspace_path: string;
  source_repo: string;
  source_ref: string;
  source_type: string;
  content_hash: string;
  installed_at: string;
}

export class LocalSkillSourceStore {
  constructor(private readonly db: DatabaseSync) {}

  upsertSource(source: SkillSource): SkillSource {
    const workspaceId = source.workspaceId || '';
    const workspacePath = source.workspacePath || '';
    const sourceRef = source.sourceRef || '';
    const sourceType = source.sourceType || 'github';

    this.db.prepare(`
      INSERT INTO skill_sources (
        skill_id, scope, workspace_id, workspace_path,
        source_repo, source_ref, source_type, content_hash, installed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(skill_id, scope, workspace_id) DO UPDATE SET
        workspace_path = excluded.workspace_path,
        source_repo = excluded.source_repo,
        source_ref = excluded.source_ref,
        source_type = excluded.source_type,
        content_hash = excluded.content_hash,
        installed_at = excluded.installed_at
    `).run(
      source.skillId,
      source.scope,
      workspaceId,
      workspacePath,
      source.sourceRepo,
      sourceRef,
      sourceType,
      source.contentHash,
      source.installedAt,
    );

    return this.getSource(source.skillId, source.scope, workspaceId)!;
  }

  getSource(skillId: string, scope: SkillScope, workspaceId: string = ''): SkillSource | undefined {
    const row = this.db.prepare(`
      SELECT * FROM skill_sources WHERE skill_id = ? AND scope = ? AND workspace_id = ?
    `).get(skillId, scope, workspaceId) as unknown as LocalSkillSourceRow | undefined;

    return row ? mapRowToSkillSource(row) : undefined;
  }

  listSources(options: { scope?: SkillScope; workspaceId?: string } = {}): SkillSource[] {
    let sql = 'SELECT * FROM skill_sources';
    const params: string[] = [];

    if (options.scope && options.workspaceId !== undefined) {
      sql += ' WHERE scope = ? AND workspace_id = ?';
      params.push(options.scope, options.workspaceId);
    } else if (options.scope) {
      sql += ' WHERE scope = ?';
      params.push(options.scope);
    } else if (options.workspaceId !== undefined) {
      sql += ' WHERE workspace_id = ?';
      params.push(options.workspaceId);
    }

    sql += ' ORDER BY installed_at DESC';
    const rows = this.db.prepare(sql).all(...params) as unknown as LocalSkillSourceRow[];
    return rows.map(mapRowToSkillSource);
  }

  deleteSource(skillId: string, scope: SkillScope, workspaceId: string = ''): boolean {
    const result = this.db.prepare(`
      DELETE FROM skill_sources WHERE skill_id = ? AND scope = ? AND workspace_id = ?
    `).run(skillId, scope, workspaceId);

    return (result.changes ?? 0) > 0;
  }
}

function mapRowToSkillSource(row: LocalSkillSourceRow): SkillSource {
  return {
    skillId: row.skill_id,
    scope: row.scope as SkillScope,
    workspaceId: row.workspace_id || undefined,
    workspacePath: row.workspace_path || undefined,
    sourceRepo: row.source_repo,
    sourceRef: row.source_ref || undefined,
    sourceType: (row.source_type as 'github' | 'git') || 'github',
    contentHash: row.content_hash,
    installedAt: row.installed_at,
  };
}
