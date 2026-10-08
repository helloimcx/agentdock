import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdownFrontmatter } from '../../services/local-ai-core/src/kernel/frontmatter.js';

test('parseMarkdownFrontmatter returns null when no frontmatter block is present', () => {
  assert.equal(parseMarkdownFrontmatter('just body text\n'), null);
  assert.equal(parseMarkdownFrontmatter(''), null);
  assert.equal(parseMarkdownFrontmatter('---\nunclosed block'), null);
});

test('parseMarkdownFrontmatter parses scalars, inline lists, and comments', () => {
  const parsed = parseMarkdownFrontmatter(
    '---\r\n# comment\ntitle: "My Page"\ntags: [news, daily]\nempty_list: []\nquoted: \'hi there\'\n---\n\nBody line\n',
  );
  assert.ok(parsed);
  assert.deepEqual(parsed.meta, {
    title: 'My Page',
    tags: ['news', 'daily'],
    empty_list: [],
    quoted: 'hi there',
  });
  assert.equal(parsed.body, '\nBody line\n');
});

test('parseMarkdownFrontmatter preserves key case for callers that need raw keys', () => {
  const parsed = parseMarkdownFrontmatter('---\nTitle: Mixed\n---\nbody');
  assert.ok(parsed);
  assert.deepEqual(parsed.meta, { Title: 'Mixed' });
});
