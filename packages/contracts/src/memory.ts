export type MemoryCategory = '_rules' | 'decisions' | 'procedures' | 'gotchas';

export const MEMORY_CATEGORIES: readonly MemoryCategory[] = [
  '_rules',
  'decisions',
  'procedures',
  'gotchas',
] as const;

export function isMemoryCategory(val: unknown): val is MemoryCategory {
  return typeof val === 'string' && (MEMORY_CATEGORIES as readonly string[]).includes(val);
}

export function normalizeMemoryCategory(category: unknown): MemoryCategory {
  const normalized = String(category || '').trim().toLowerCase();
  if (isMemoryCategory(normalized)) {
    return normalized;
  }
  if (normalized === 'rules') return '_rules';
  throw new Error(`Invalid memory category: "${category}". Expected one of: ${MEMORY_CATEGORIES.join(', ')}`);
}

export function isValidMemorySlug(slug: string): boolean {
  if (!slug || typeof slug !== 'string') return false;
  const trimmed = slug.trim();
  if (!trimmed || trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
    return false;
  }
  return /^[a-zA-Z0-9_\u4e00-\u9fa5\.\-]+$/.test(trimmed);
}

export interface MemoryPageMeta {
  title: string;
  category: MemoryCategory;
  tags: string[];
  summary?: string;
  updatedAt: string;
  author?: string;
}

export interface MemoryPage extends MemoryPageMeta {
  id: string;
  workspaceId: string;
  slug: string;
  relativePath: string;
  content: string;
  rawMarkdown: string;
  mtimeMs: number;
}

export interface MemoryQueryInput {
  query?: string;
  category?: MemoryCategory | string;
  tag?: string;
  limit?: number;
}

export interface MemoryPageWriteInput {
  category: MemoryCategory;
  slug: string;
  title: string;
  content: string;
  tags?: string[];
  summary?: string;
  author?: string;
}

export interface MemorySearchResult {
  page: MemoryPage;
  snippet?: string;
  rank?: number;
}
