/**
 * Shared file-discovery logic for the `lint:*` quality metrics.
 *
 * The `lint:file-size` and `lint:function-length` metrics scan the same source
 * roots and honor the same ignore patterns, so the walk lives here — otherwise
 * a bug in the ignore matcher (or a change to the ignore set) has to be fixed
 * in multiple places. `lint-duplicate.mjs` intentionally stays separate: it
 * shells out to jscpd, which does its own discovery from these same patterns.
 */
import { readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const ROOT = process.cwd();

export const ENTRY_DIRS = ['src', 'services', 'packages', 'electron', 'shared'];

// Mirrors the ignore set in eslint.config.mjs — tests, build output, configs.
// Patterns use a subset of glob syntax: `**` spans path segments, `*` matches
// within a segment, `{a,b}` is alternation. Converted to regexes once at load.
export const IGNORE = [
  '**/dist/**',
  '**/dist-electron/**',
  '**/release/**',
  '**/coverage/**',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.config.{js,mjs,cjs}',
  '**/test/**',
  '**/tests/**',
  'tests/**',
  'scripts/**',
];

// Pre-compiled matchers: each is (relPath) => bool. Kept separate from the
// regexes so the regex anchor logic lives in one place below.
const matchers = IGNORE.map((pattern) => globToMatcher(pattern));

function globToMatcher(pattern) {
  // Convert a glob pattern to an anchored regex. Handles `**` (cross-segment),
  // `*` (within-segment), `?`, char escapes, and `{a,b,c}` alternation.
  let re = '';
  let i = 0;
  const n = pattern.length;
  while (i < n) {
    const c = pattern[i++];
    switch (c) {
      case '*': {
        if (pattern[i] === '*') {
          i += 1;
          if (pattern[i] === '/') {
            // `**/`: zero or more complete path segments (and their trailing /).
            i += 1;
            re += '(?:.*/)?';
          } else {
            re += '.*';
          }
        } else {
          re += '[^/]*';
        }
        break;
      }
      case '?':
        re += '[^/]';
        break;
      case '{': {
        re += '(?:';
        let depth = 1;
        while (i < n && depth > 0) {
          const ch = pattern[i++];
          if (ch === '{') depth += 1;
          else if (ch === '}') depth -= 1;
          if (depth > 0) {
            if (ch === ',') re += '|';
            else re += escapeRegexChar(ch);
          }
        }
        re += ')';
        break;
      }
      case '/':
        re += '/';
        break;
      default:
        re += escapeRegexChar(c);
        break;
    }
  }
  const regex = new RegExp('^' + re + '$');
  return (relPath) => regex.test(relPath);
}

function escapeRegexChar(c) {
  return /[.*+?^${}()|[\]\\]/.test(c) ? '\\' + c : c;
}

export function isIgnored(relPath) {
  return matchers.some((match) => match(relPath));
}

export function collectFiles(dir, exts) {
  const out = [];
  const walk = (current) => {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      const rel = full.slice(ROOT.length + 1);
      if (entry.isDirectory()) {
        if (!isIgnored(rel + '/')) walk(full);
      } else if (entry.isFile()) {
        if (exts.has(extname(entry.name)) && !isIgnored(rel)) out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

// Re-export so callers that need to filter an existing dir can do so without
// re-walking. Not currently used by the metrics but kept for completeness.
export { statSync };
