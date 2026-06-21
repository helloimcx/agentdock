const FENCED_CODE_BLOCK_RE = /(^|\n) {0,3}(?:`{3,}|~{3,})[^\n]*(?:\n|$)/;
const INDENTED_CODE_BLOCK_RE = /(^|\n)(?: {4}|\t)\S/;

export function hasMarkdownCodeBlock(content: string) {
  return FENCED_CODE_BLOCK_RE.test(content) || INDENTED_CODE_BLOCK_RE.test(content);
}
