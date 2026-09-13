import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  MemoryCategory,
  MemoryPage,
  MemoryPageWriteInput,
  MemoryQueryInput,
  MemorySearchResult,
} from '@cc/superai-contracts/memory';
import { isValidMemorySlug, MEMORY_CATEGORIES } from '@cc/superai-contracts/memory';
import type { LocalCoreWorkspaceMemoryStore } from '../acp/store/workspace-memory-store.js';

export interface WorkspaceMemoryServiceOptions {
  store: LocalCoreWorkspaceMemoryStore;
  getWorkspacePath: (workspaceId: string) => Promise<string | undefined> | string | undefined;
}

export function serializeMemoryMarkdown(page: {
  title: string;
  tags?: string[];
  description?: string;
  updatedAt?: string;
  content: string;
}): string {
  const lines = ['---'];
  lines.push(`title: ${JSON.stringify(page.title || '')}`);
  if (page.description) {
    lines.push(`description: ${JSON.stringify(page.description)}`);
  }
  if (page.tags && page.tags.length > 0) {
    lines.push(`tags: [${page.tags.map((t) => JSON.stringify(t)).join(', ')}]`);
  }
  if (page.updatedAt) {
    lines.push(`updated_at: ${JSON.stringify(page.updatedAt)}`);
  }
  lines.push('---');
  lines.push('');
  lines.push(page.content || '');
  return lines.join('\n');
}

export function parseMemoryMarkdown(raw: string): {
  title?: string;
  tags?: string[];
  description?: string;
  updatedAt?: string;
  content: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) {
    return { content: raw.trim() };
  }
  const frontmatterStr = match[1];
  const content = match[2];
  const meta: Record<string, unknown> = {};

  for (const line of frontmatterStr.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim().toLowerCase();
      const val = trimmed.slice(colonIdx + 1).trim();
      if (val.startsWith('[') && val.endsWith(']')) {
        meta[key] = val
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean);
      } else {
        meta[key] = val.replace(/^['"]|['"]$/g, '');
      }
    }
  }

  const title = typeof meta.title === 'string' ? meta.title : undefined;
  const description = typeof meta.description === 'string' ? meta.description : undefined;
  const updatedAt =
    typeof meta.updated_at === 'string'
      ? meta.updated_at
      : typeof meta.updatedat === 'string'
        ? meta.updatedat
        : undefined;
  const tags = Array.isArray(meta.tags) ? meta.tags.map(String) : [];

  return { title, description, updatedAt, tags, content };
}

function resolveMemoryRoot(workspacePath: string): string {
  return join(resolve(workspacePath), '.agentdock', 'memory');
}

function resolveCategoryDir(memoryRoot: string, category: string): string {
  if (!MEMORY_CATEGORIES.includes(category as MemoryCategory)) {
    throw new Error(`Invalid memory category: ${category}. Allowed: ${MEMORY_CATEGORIES.join(', ')}`);
  }
  return join(memoryRoot, category);
}

function resolvePagePath(memoryRoot: string, category: string, slug: string): string {
  if (!isValidMemorySlug(slug)) {
    throw new Error(`Invalid memory slug: "${slug}". Must be lowercase letters, numbers, hyphens, and underscores (1-80 chars).`);
  }
  const categoryDir = resolveCategoryDir(memoryRoot, category);
  const targetFile = resolve(categoryDir, `${slug}.md`);

  // Path traversal defense
  if (!targetFile.startsWith(categoryDir + sep) && targetFile !== categoryDir) {
    throw new Error('Path traversal detected in memory page path.');
  }

  return targetFile;
}

function atomicWriteFileSync(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  writeFileSync(tmpPath, content, 'utf8');
  renameSync(tmpPath, filePath);
}

export class WorkspaceMemoryService {
  constructor(private readonly options: WorkspaceMemoryServiceOptions) {}

  private async getWorkspaceDir(workspaceId: string): Promise<string> {
    const dir = await this.options.getWorkspacePath(workspaceId);
    if (!dir) {
      throw new Error(`Workspace not found or has no workDir: ${workspaceId}`);
    }
    return dir;
  }

  async ensureMemoryStructure(workspaceId: string): Promise<string> {
    const wsDir = await this.getWorkspaceDir(workspaceId);
    const memoryRoot = resolveMemoryRoot(wsDir);
    for (const cat of MEMORY_CATEGORIES) {
      mkdirSync(join(memoryRoot, cat), { recursive: true });
    }
    return memoryRoot;
  }

  async writePage(workspaceId: string, input: MemoryPageWriteInput): Promise<MemoryPage> {
    const memoryRoot = await this.ensureMemoryStructure(workspaceId);
    const filePath = resolvePagePath(memoryRoot, input.category, input.slug);
    const now = new Date().toISOString();

    const rawMarkdown = serializeMemoryMarkdown({
      title: input.title,
      description: input.summary,
      tags: input.tags,
      updatedAt: now,
      content: input.content,
    });

    atomicWriteFileSync(filePath, rawMarkdown);

    const stat = statSync(filePath);
    const relativePath = `.agentdock/memory/${input.category}/${input.slug}.md`;

    return this.options.store.upsertPage({
      workspaceId,
      category: input.category,
      slug: input.slug,
      relativePath,
      title: input.title,
      content: input.content,
      rawMarkdown,
      tags: input.tags,
      summary: input.summary,
      author: input.author,
      mtimeMs: stat.mtimeMs,
    });
  }

  async getPage(workspaceId: string, category: string, slug: string): Promise<MemoryPage | null> {
    const wsDir = await this.getWorkspaceDir(workspaceId);
    const memoryRoot = resolveMemoryRoot(wsDir);
    const filePath = resolvePagePath(memoryRoot, category, slug);

    if (!existsSync(filePath)) {
      return this.options.store.getPage(workspaceId, category as MemoryCategory, slug) ?? null;
    }

    const raw = readFileSync(filePath, 'utf8');
    const parsed = parseMemoryMarkdown(raw);
    const stat = statSync(filePath);
    const relativePath = `.agentdock/memory/${category}/${slug}.md`;

    return this.options.store.upsertPage({
      workspaceId,
      category: category as MemoryCategory,
      slug,
      relativePath,
      title: parsed.title || slug,
      content: parsed.content,
      rawMarkdown: raw,
      tags: parsed.tags,
      summary: parsed.description,
      mtimeMs: stat.mtimeMs,
    });
  }

  async deletePage(workspaceId: string, category: string, slug: string): Promise<boolean> {
    const wsDir = await this.getWorkspaceDir(workspaceId);
    const memoryRoot = resolveMemoryRoot(wsDir);
    const filePath = resolvePagePath(memoryRoot, category, slug);

    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }

    return this.options.store.deletePage(workspaceId, category as MemoryCategory, slug);
  }

  listPages(workspaceId: string, category?: string): MemoryPage[] {
    return this.options.store.listPages(workspaceId, category);
  }

  queryPages(workspaceId: string, query: MemoryQueryInput): MemorySearchResult[] {
    return this.options.store.queryPages(workspaceId, query);
  }

  async syncWorkspace(workspaceId: string): Promise<{ synced: number; deleted: number; total: number }> {
    const wsDir = await this.getWorkspaceDir(workspaceId);
    const memoryRoot = resolveMemoryRoot(wsDir);

    if (!existsSync(memoryRoot)) {
      await this.ensureMemoryStructure(workspaceId);
    }

    let added = 0;
    let updated = 0;
    let deleted = 0;
    const diskPageIds = new Set<string>();


    for (const category of MEMORY_CATEGORIES) {
      const categoryDir = join(memoryRoot, category);
      if (!existsSync(categoryDir)) continue;

      const entries = readdirSync(categoryDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

        const slug = entry.name.replace(/\.md$/, '');
        if (!isValidMemorySlug(slug)) continue;

        const filePath = join(categoryDir, entry.name);
        const stat = statSync(filePath);
        const pageId = `${workspaceId}:${category}/${slug}`;
        diskPageIds.add(pageId);
        const existing = this.options.store.getPage(workspaceId, category, slug);

        const shouldSync = !existing || (existing.mtimeMs || 0) < stat.mtimeMs;
        if (shouldSync) {
          const raw = readFileSync(filePath, 'utf8');
          const parsed = parseMemoryMarkdown(raw);
          this.options.store.upsertPage({
            workspaceId,
            category,
            slug,
            relativePath: `.agentdock/memory/${category}/${entry.name}`,
            title: parsed.title || slug,
            content: parsed.content,
            rawMarkdown: raw,
            tags: parsed.tags,
            summary: parsed.description,
            mtimeMs: stat.mtimeMs,
          });
          if (!existing) {
            added++;
          } else {
            updated++;
          }
        }
      }
    }

    // Prune rows from DB whose files were deleted on disk
    const allDbPages = this.options.store.listPages(workspaceId);
    for (const dbPage of allDbPages) {
      if (!diskPageIds.has(dbPage.id)) {
        this.options.store.deletePage(workspaceId, dbPage.category, dbPage.slug);
        deleted++;
      }
    }

    const total = this.options.store.listPages(workspaceId).length;
    return { synced: added + updated, deleted, total };
  }
}


