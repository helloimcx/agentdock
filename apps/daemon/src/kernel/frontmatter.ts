export interface ParsedMarkdownFrontmatter {
  meta: Record<string, string | string[]>;
  body: string;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Returns null when the input does not start with a frontmatter block. */
export function parseMarkdownFrontmatter(raw: string): ParsedMarkdownFrontmatter | null {
  const match = FRONTMATTER_REGEX.exec(raw);
  if (!match) {
    return null;
  }
  const meta: Record<string, string | string[]> = {};
  for (const line of match[1].split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
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
  return { meta, body: match[2] };
}
