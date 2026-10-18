import type { DatabaseSync } from 'node:sqlite';
import type {
  MemoryCategory,
  MemoryPage,
  MemoryQueryInput,
  MemorySearchResult,
} from '@cc/superai-contracts';

interface WorkspaceMemoryPageRow {
  id: string;
  workspace_id: string;
  category: string;
  slug: string;
  relative_path: string;
  title: string;
  tags_json: string;
  summary: string;
  content: string;
  raw_markdown: string;
  author: string | null;
  mtime_ms: number;
  created_at: string;
  updated_at: string;
}

import { parseJsonArray } from './session-handoff-store.js';

function mapMemoryRow(row: WorkspaceMemoryPageRow): MemoryPage {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    category: row.category as MemoryCategory,
    slug: row.slug,
    relativePath: row.relative_path,
    title: row.title,
    tags: parseJsonArray(row.tags_json),
    summary: row.summary || undefined,
    content: row.content,
    rawMarkdown: row.raw_markdown,
    author: row.author || undefined,
    mtimeMs: row.mtime_ms,
    updatedAt: row.updated_at,
  };
}

function sanitizeFts5Query(query: string): string {
  const words = query
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/["*]/g, '').trim())
    .filter((word) => word.length > 0);
  if (words.length === 0) return '';
  return words.map((w) => `"${w}"*`).join(' ');
}

export class LocalCoreWorkspaceMemoryStore {
  constructor(private readonly db: DatabaseSync) {}

  upsertPage(input: {
    workspaceId: string;
    category: MemoryCategory;
    slug: string;
    relativePath: string;
    title: string;
    content: string;
    rawMarkdown: string;
    tags?: string[];
    summary?: string;
    author?: string;
    mtimeMs?: number;
  }): MemoryPage {
    const id = `${input.workspaceId}:${input.category}/${input.slug}`;
    const now = new Date().toISOString();
    const tagsJson = JSON.stringify(input.tags || []);
    const summary = input.summary || '';
    const mtimeMs = input.mtimeMs ?? Date.now();

    const existing = this.getPageById(id);
    const createdAt = existing ? existing.updatedAt : now;

    this.db.prepare(`
      INSERT INTO workspace_memory_pages (
        id, workspace_id, category, slug, relative_path, title,
        tags_json, summary, content, raw_markdown, author,
        mtime_ms, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        relative_path = excluded.relative_path,
        title = excluded.title,
        tags_json = excluded.tags_json,
        summary = excluded.summary,
        content = excluded.content,
        raw_markdown = excluded.raw_markdown,
        author = excluded.author,
        mtime_ms = excluded.mtime_ms,
        updated_at = excluded.updated_at
    `).run(
      id,
      input.workspaceId,
      input.category,
      input.slug,
      input.relativePath,
      input.title,
      tagsJson,
      summary,
      input.content,
      input.rawMarkdown,
      input.author || null,
      mtimeMs,
      createdAt,
      now,
    );

    // Synchronize FTS5 virtual table
    this.db.prepare('DELETE FROM workspace_memory_fts WHERE page_id = ?').run(id);
    this.db.prepare(`
      INSERT INTO workspace_memory_fts (
        page_id, workspace_id, title, category, tags, summary, content
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.workspaceId,
      input.title,
      input.category,
      (input.tags || []).join(' '),
      summary,
      input.content,
    );

    return this.getPageById(id)!;
  }

  getPage(workspaceId: string, category: MemoryCategory, slug: string): MemoryPage | undefined {
    const id = `${workspaceId}:${category}/${slug}`;
    return this.getPageById(id);
  }

  getPageById(id: string): MemoryPage | undefined {
    const row = this.db.prepare(
      'SELECT * FROM workspace_memory_pages WHERE id = ?'
    ).get(id) as WorkspaceMemoryPageRow | undefined;
    return row ? mapMemoryRow(row) : undefined;
  }

  listPages(workspaceId: string, category?: string): MemoryPage[] {
    let rows: WorkspaceMemoryPageRow[];
    if (category) {
      rows = this.db.prepare(
        'SELECT * FROM workspace_memory_pages WHERE workspace_id = ? AND category = ? ORDER BY updated_at DESC'
      ).all(workspaceId, category) as unknown as WorkspaceMemoryPageRow[];
    } else {
      rows = this.db.prepare(
        'SELECT * FROM workspace_memory_pages WHERE workspace_id = ? ORDER BY updated_at DESC'
      ).all(workspaceId) as unknown as WorkspaceMemoryPageRow[];
    }
    return rows.map(mapMemoryRow);
  }

  deletePage(workspaceId: string, category: MemoryCategory, slug: string): boolean {
    const id = `${workspaceId}:${category}/${slug}`;
    return this.deletePageById(id);
  }

  deletePageById(id: string): boolean {
    this.db.prepare('DELETE FROM workspace_memory_fts WHERE page_id = ?').run(id);
    const result = this.db.prepare('DELETE FROM workspace_memory_pages WHERE id = ?').run(id);
    return Number(result.changes || 0) > 0;
  }

  private queryWithoutFts(
    workspaceId: string,
    query: MemoryQueryInput,
    limit: number,
  ): MemorySearchResult[] {
    const pages = this.listPages(workspaceId, query.category);
    if (!query.tag) {
      return pages.slice(0, limit).map((page) => ({ page }));
    }
    const targetTag = query.tag.toLowerCase();
    return pages
      .filter((p) => p.tags.some((t) => t.toLowerCase() === targetTag))
      .slice(0, limit)
      .map((page) => ({ page }));
  }

  queryPages(
    workspaceId: string,
    queryOptions?: MemoryQueryInput,
  ): MemorySearchResult[] {
    const query = queryOptions || {};
    const limit = Math.max(1, Math.min(query.limit || 20, 100));
    const rawFts = query.query?.trim() || '';

    if (!rawFts) {
      return this.queryWithoutFts(workspaceId, query, limit);
    }

    const sanitized = sanitizeFts5Query(rawFts);
    if (!sanitized) return [];

    try {
      const ftsRows = this.db.prepare(`
        SELECT page_id, snippet(workspace_memory_fts, 6, '<b>', '</b>', '...', 15) AS snip, rank
        FROM workspace_memory_fts
        WHERE workspace_id = ? AND workspace_memory_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(workspaceId, sanitized, limit * 2) as unknown as Array<{ page_id: string; snip: string; rank: number }>;

      const results: MemorySearchResult[] = [];
      for (const row of ftsRows) {
        const page = this.getPageById(row.page_id);
        if (!page) continue;
        if (query.category && page.category !== query.category) continue;
        if (query.tag && !page.tags.some((t) => t.toLowerCase() === query.tag!.toLowerCase())) continue;

        results.push({
          page,
          snippet: row.snip,
          rank: row.rank,
        });
        if (results.length >= limit) break;
      }
      return results;
    } catch {
      return [];
    }
  }
}
