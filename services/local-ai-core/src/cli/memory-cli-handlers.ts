import { existsSync, readFileSync } from 'node:fs';
import type {
  MemoryCategory,
  MemoryPage,
  MemorySearchResult,
} from '@cc/superai-contracts/memory';
import { normalizeMemoryCategory } from '@cc/superai-contracts/memory';
import type { ParsedFlags, StdIo, CliContext } from './cli-helpers.js';
import {
  request,
  resolveContext,
  getFlag,
  print,
} from './cli-helpers.js';

export async function runMemoryDomain(
  action: string,
  maybeId: string,
  flags: ParsedFlags,
  env: NodeJS.ProcessEnv,
  io: StdIo,
  json: boolean,
): Promise<number> {
  switch (action) {
    case 'list':
    case 'ls':
      return await handleMemoryList(flags, env, io, json);
    case 'get':
      return await handleMemoryGet(maybeId, flags, env, io, json);
    case 'query':
    case 'search':
    case 'find':
      return await handleMemoryQuery(maybeId, flags, env, io, json);
    case 'write':
    case 'set':
    case 'add':
      return await handleMemoryWrite(maybeId, flags, env, io, json);
    case 'del':
    case 'delete':
    case 'rm':
      return await handleMemoryDelete(maybeId, flags, env, io, json);
    case 'sync':
      return await handleMemorySync(flags, env, io, json);
    default:
      io.stderr.write(
        `Unknown memory action: "${action}". Supported actions: list, get, query, write, del, sync.\n`,
      );
      return 2;
  }
}

function ensureWorkspace(ctx: CliContext, io: StdIo): boolean {
  if (!ctx.workspaceId) {
    io.stderr.write('Missing required workspace. Provide --workspace <id> or set LOCAL_AI_WORKSPACE_ID.\n');
    return false;
  }
  return true;
}

async function handleMemoryList(flags: ParsedFlags, env: NodeJS.ProcessEnv, io: StdIo, json: boolean): Promise<number> {
  const ctx = resolveContext(flags, env);
  if (!ensureWorkspace(ctx, io)) return 2;

  const category = getFlag(flags, 'category') || getFlag(flags, 'c');
  const queryParam = category ? `?category=${encodeURIComponent(category)}` : '';
  const res = await request<{ pages: MemoryPage[] }>(
    ctx.baseUrl,
    'GET',
    `/workspaces/${encodeURIComponent(ctx.workspaceId)}/memory/pages${queryParam}`,
  );

  const pages = res.pages || [];
  let text = '';
  if (pages.length === 0) {
    text = `No memory pages found in workspace "${ctx.workspaceId}".`;
  } else {
    const lines = [`Workspace Memory Pages (${pages.length}):`];
    for (const p of pages) {
      const tagsStr = p.tags && p.tags.length > 0 ? ` [${p.tags.join(', ')}]` : '';
      lines.push(`- [${p.category}] ${p.slug}: "${p.title}"${tagsStr}`);
    }
    text = lines.join('\n');
  }

  print(json, io.stdout, res, text);
  return 0;
}

function parseCategoryAndSlug(maybeId: string, flags: ParsedFlags, defaultCategory = ''): { category: string; slug: string } {
  let category = getFlag(flags, 'category') || getFlag(flags, 'c');
  let slug = getFlag(flags, 'slug') || getFlag(flags, 's');

  if (maybeId && maybeId.includes('/')) {
    const parts = maybeId.split('/');
    category = category || parts[0];
    slug = slug || parts.slice(1).join('/');
  } else if (maybeId && !slug) {
    slug = maybeId;
  }
  return { category: category || defaultCategory, slug };
}

function resolveTargetPage(
  maybeId: string,
  flags: ParsedFlags,
  env: NodeJS.ProcessEnv,
  io: StdIo,
  defaultCategory = '',
): { ctx: CliContext; category: string; slug: string } | null {
  const ctx = resolveContext(flags, env);
  if (!ensureWorkspace(ctx, io)) return null;
  const { category, slug } = parseCategoryAndSlug(maybeId, flags, defaultCategory);
  return { ctx, category, slug };
}

async function handleMemoryGet(
  maybeId: string,
  flags: ParsedFlags,
  env: NodeJS.ProcessEnv,
  io: StdIo,
  json: boolean,
): Promise<number> {
  const target = resolveTargetPage(maybeId, flags, env, io, '_rules');
  if (!target) return 2;
  const { ctx, category, slug } = target;
  if (!slug) {
    io.stderr.write('Missing required page slug. Usage: lac memory get <category>/<slug> or --slug <slug>\n');
    return 2;
  }

  const res = await request<{ page: MemoryPage }>(
    ctx.baseUrl,
    'GET',
    `/workspaces/${encodeURIComponent(ctx.workspaceId)}/memory/pages/${encodeURIComponent(category)}/${encodeURIComponent(slug)}`,
  );

  const page = res.page;
  const lines = [`# ${page.title} (${page.category}/${page.slug})`, ''];
  if (page.tags && page.tags.length > 0) {
    lines.push(`Tags: ${page.tags.join(', ')}`);
  }
  if (page.summary) {
    lines.push(`Summary: ${page.summary}`);
  }
  lines.push('', page.content || '');
  print(json, io.stdout, res, lines.join('\n'));
  return 0;
}

function formatMemoryQueryResults(results: MemorySearchResult[], query: string): string {
  if (results.length === 0) {
    return `No memory pages matched query "${query}".`;
  }
  const lines = [`Matched Memory Pages (${results.length}):`];
  for (const r of results) {
    const p = r.page;
    lines.push(`\n--- [${p.category}/${p.slug}] "${p.title}" ---`);
    const preview = r.snippet || p.summary || `${p.content.slice(0, 150)}...`;
    lines.push(preview);
  }
  return lines.join('\n');
}

async function handleMemoryQuery(
  maybeId: string,
  flags: ParsedFlags,
  env: NodeJS.ProcessEnv,
  io: StdIo,
  json: boolean,
): Promise<number> {
  const ctx = resolveContext(flags, env);
  if (!ensureWorkspace(ctx, io)) return 2;

  const query = maybeId || getFlag(flags, 'query') || getFlag(flags, 'q');
  const category = getFlag(flags, 'category') || getFlag(flags, 'c');
  const tag = getFlag(flags, 'tag') || getFlag(flags, 't');
  const limit = getFlag(flags, 'limit') || getFlag(flags, 'n') || '10';

  const params = new URLSearchParams();
  if (query) params.set('query', query);
  if (category) params.set('category', category);
  if (tag) params.set('tag', tag);
  if (limit) params.set('limit', limit);

  const res = await request<{ results: MemorySearchResult[] }>(
    ctx.baseUrl,
    'GET',
    `/workspaces/${encodeURIComponent(ctx.workspaceId)}/memory/query?${params.toString()}`,
  );

  const text = formatMemoryQueryResults(res.results || [], query);
  print(json, io.stdout, res, text);
  return 0;
}

async function handleMemoryWrite(
  maybeId: string,
  flags: ParsedFlags,
  env: NodeJS.ProcessEnv,
  io: StdIo,
  json: boolean,
): Promise<number> {
  const target = resolveTargetPage(maybeId, flags, env, io, 'decisions');
  if (!target) return 2;
  const { ctx, category, slug } = target;
  if (!slug) {
    io.stderr.write('Missing required slug. Usage: lac memory write --slug <slug> --title "<title>" ...\n');
    return 2;
  }

  const title = getFlag(flags, 'title') || slug;
  const summary = getFlag(flags, 'summary') || getFlag(flags, 'desc') || undefined;
  const rawTags = getFlag(flags, 'tags');
  const tags = rawTags ? rawTags.split(',').map((t) => t.trim()).filter(Boolean) : undefined;
  const filePath = getFlag(flags, 'file');
  let content = getFlag(flags, 'content');

  if (filePath) {
    if (!existsSync(filePath)) {
      io.stderr.write(`Content file not found: ${filePath}\n`);
      return 2;
    }
    content = readFileSync(filePath, 'utf8');
  }

  if (!content) {
    io.stderr.write('Missing page content. Specify --content "<text>" or --file <path>.\n');
    return 2;
  }

  const res = await request<{ page: MemoryPage }>(
    ctx.baseUrl,
    'POST',
    `/workspaces/${encodeURIComponent(ctx.workspaceId)}/memory/pages`,
    {
      category: normalizeMemoryCategory(category),
      slug,
      title,
      content,
      summary,
      tags,
    },
  );

  const text = `Memory page saved: ${res.page.category}/${res.page.slug} (${res.page.relativePath})`;
  print(json, io.stdout, res, text);
  return 0;
}

async function handleMemoryDelete(
  maybeId: string,
  flags: ParsedFlags,
  env: NodeJS.ProcessEnv,
  io: StdIo,
  json: boolean,
): Promise<number> {
  const target = resolveTargetPage(maybeId, flags, env, io, '');
  if (!target) return 2;
  const { ctx, category, slug } = target;
  if (!category || !slug) {
    io.stderr.write('Missing category or slug. Usage: lac memory del <category>/<slug>\n');
    return 2;
  }

  const res = await request<{ deleted: boolean }>(
    ctx.baseUrl,
    'DELETE',
    `/workspaces/${encodeURIComponent(ctx.workspaceId)}/memory/pages/${encodeURIComponent(category)}/${encodeURIComponent(slug)}`,
  );

  const text = `Memory page deleted: ${category}/${slug}`;
  print(json, io.stdout, res, text);
  return 0;
}

async function handleMemorySync(flags: ParsedFlags, env: NodeJS.ProcessEnv, io: StdIo, json: boolean): Promise<number> {
  const ctx = resolveContext(flags, env);
  if (!ensureWorkspace(ctx, io)) return 2;

  const res = await request<{ synced: number; deleted: number; total: number }>(
    ctx.baseUrl,
    'POST',
    `/workspaces/${encodeURIComponent(ctx.workspaceId)}/memory/sync`,
  );

  const text = `Memory sync complete: ${res.synced} synced, ${res.deleted} removed, ${res.total} total pages.`;
  print(json, io.stdout, res, text);
  return 0;
}
