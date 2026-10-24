export const LARK_CARD_MARKDOWN_TABLE_LIMIT = 5;

export function sanitizeLarkMarkdown(markdown: string) {
  return markdown.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (match, label: string, href: string) => {
    return /^https?:\/\//i.test(href) ? match : `${label} (${href})`;
  });
}

export function countMarkdownTables(markdown: string) {
  const lines = String(markdown || '').split('\n');
  let count = 0;
  let inTable = false;

  for (let index = 0; index < lines.length; index += 1) {
    const isTableStart = isMarkdownTableLine(lines[index]) && isMarkdownTableSeparatorLine(lines[index + 1]);
    const isTableBody = inTable && isMarkdownTableLine(lines[index]);
    if (isTableStart && !inTable) {
      count += 1;
      inTable = true;
      continue;
    }
    if (!isTableBody) {
      inTable = false;
    }
  }

  return count;
}

export function shouldUseLarkMarkdownCard(markdown: string) {
  const tableCount = countMarkdownTables(markdown);
  return tableCount > 0 && tableCount <= LARK_CARD_MARKDOWN_TABLE_LIMIT;
}

export function normalizeMarkdownTablesForLarkPost(markdown: string) {
  const lines = markdown.split('\n');
  const output: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (isMarkdownTableLine(lines[index]) && isMarkdownTableSeparatorLine(lines[index + 1])) {
      const tableLines = [lines[index], lines[index + 1]];
      index += 2;
      while (index < lines.length && isMarkdownTableLine(lines[index])) {
        tableLines.push(lines[index]);
        index += 1;
      }
      index -= 1;
      output.push(renderMarkdownTableAsList(tableLines));
      continue;
    }
    output.push(lines[index]);
  }

  return output.join('\n');
}

function isMarkdownTableLine(line: string | undefined) {
  const trimmed = String(line || '').trim();
  return trimmed.length > 1 && trimmed.startsWith('|') && trimmed.endsWith('|');
}

function isMarkdownTableSeparatorLine(line: string | undefined) {
  if (!isMarkdownTableLine(line)) {
    return false;
  }
  const cells = splitMarkdownTableRow(String(line));
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitMarkdownTableRow(line: string) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function renderMarkdownTableAsList(tableLines: string[]) {
  const headers = splitMarkdownTableRow(tableLines[0] || '');
  const bodyRows = tableLines.slice(2).map(splitMarkdownTableRow);
  if (headers.length === 0 || bodyRows.length === 0) {
    return tableLines.join('\n');
  }

  return bodyRows
    .map((cells, rowIndex) => renderMarkdownTableRow(headers, cells, rowIndex))
    .join('\n');
}

function renderMarkdownTableRow(headers: string[], cells: string[], rowIndex: number) {
  const hasNumberColumn = headers[0]?.trim() === '#';
  const explicitNumber = hasNumberColumn ? cells[0]?.trim() : '';
  const prefix = explicitNumber && /^\d+$/.test(explicitNumber) ? `${explicitNumber}.` : `${rowIndex + 1}.`;
  const startIndex = hasNumberColumn ? 1 : 0;
  const parts: string[] = [];

  for (let index = startIndex; index < headers.length; index += 1) {
    const header = headers[index]?.trim();
    const value = cells[index]?.trim();
    if (!header || !value) {
      continue;
    }
    parts.push(`${header}: ${value}`);
  }

  return parts.length > 0 ? `${prefix} ${parts.join('；')}` : `${prefix} ${cells.join('；')}`;
}

interface CodeFenceState {
  inCodeBlock: boolean;
  codeBlockLang: string;
}

function updateCodeFenceState(line: string, state: CodeFenceState): void {
  const match = /^```(\w*)/.exec(line.trim());
  if (!match) return;
  if (!state.inCodeBlock) {
    state.inCodeBlock = true;
    state.codeBlockLang = match[1] || '';
  } else {
    state.inCodeBlock = false;
    state.codeBlockLang = '';
  }
}

function updateCodeFenceForText(text: string, state: CodeFenceState): void {
  for (const line of text.split('\n')) {
    updateCodeFenceState(line, state);
  }
}

function flushChunk(chunks: string[], currentChunk: string, state: CodeFenceState): string {
  if (!currentChunk) return '';
  if (state.inCodeBlock) {
    chunks.push(`${currentChunk}\n\`\`\``);
    return `\`\`\`${state.codeBlockLang}\n`;
  }
  chunks.push(currentChunk);
  return '';
}

function findCharCutIndex(str: string, maxBytes: number): number {
  let low = 1;
  let high = Math.min(str.length, maxBytes);
  let best = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (Buffer.byteLength(str.slice(0, mid), 'utf8') <= maxBytes) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (best > 0 && best < str.length) {
    const code = str.charCodeAt(best - 1);
    if (code >= 0xd800 && code <= 0xdbff) {
      best -= 1;
    }
  }
  return best;
}

function splitLongLineByBytes(
  line: string,
  state: CodeFenceState,
  chunks: string[],
  currentChunk: string,
  maxBytes: number,
): string {
  let remaining = line;
  let chunk = currentChunk;
  while (remaining.length > 0) {
    const closingOverhead = state.inCodeBlock ? 4 : 0;
    const currentBytes = Buffer.byteLength(chunk, 'utf8');
    let budget = maxBytes - currentBytes - closingOverhead;
    if (budget <= 3 && chunk) {
      chunk = flushChunk(chunks, chunk, state);
      budget = maxBytes - Buffer.byteLength(chunk, 'utf8') - closingOverhead;
    }
    const cutIdx = findCharCutIndex(remaining, budget);
    const safeCut = cutIdx > 0 ? cutIdx : 1;
    const slice = remaining.slice(0, safeCut);
    remaining = remaining.slice(safeCut);
    chunk = chunk ? `${chunk}${slice}` : slice;
    if (remaining.length > 0) {
      chunk = flushChunk(chunks, chunk, state);
    }
  }
  return chunk;
}

function appendLineToChunks(
  line: string,
  state: CodeFenceState,
  chunks: string[],
  currentChunk: string,
  maxBytes: number,
): string {
  const closingOverhead = state.inCodeBlock ? 4 : 0;
  const lineCandidate = currentChunk ? `${currentChunk}\n${line}` : line;
  if (Buffer.byteLength(lineCandidate, 'utf8') + closingOverhead <= maxBytes) {
    updateCodeFenceState(line, state);
    return lineCandidate;
  }
  let chunk = flushChunk(chunks, currentChunk, state);
  const singleCandidate = chunk ? `${chunk}${line}` : line;
  if (Buffer.byteLength(singleCandidate, 'utf8') + closingOverhead <= maxBytes) {
    updateCodeFenceState(line, state);
    return singleCandidate;
  }
  chunk = splitLongLineByBytes(line, state, chunks, chunk, maxBytes);
  updateCodeFenceState(line, state);
  return chunk;
}

function appendParagraphToChunks(
  para: string,
  state: CodeFenceState,
  chunks: string[],
  currentChunk: string,
  maxBytes: number,
): string {
  const closingOverhead = state.inCodeBlock ? 4 : 0;
  const candidate = currentChunk ? `${currentChunk}\n\n${para}` : para;
  if (Buffer.byteLength(candidate, 'utf8') + closingOverhead <= maxBytes) {
    updateCodeFenceForText(para, state);
    return candidate;
  }
  let chunk = flushChunk(chunks, currentChunk, state);
  const paraCandidate = chunk ? `${chunk}${para}` : para;
  if (Buffer.byteLength(paraCandidate, 'utf8') + closingOverhead <= maxBytes) {
    updateCodeFenceForText(para, state);
    return paraCandidate;
  }
  for (const line of para.split('\n')) {
    chunk = appendLineToChunks(line, state, chunks, chunk, maxBytes);
  }
  return chunk;
}

export function splitMarkdownForLark(markdown: string, maxBytes = 20 * 1024): string[] {
  const normalized = String(markdown || '').trim();
  if (!normalized) return [];
  if (Buffer.byteLength(normalized, 'utf8') <= maxBytes) return [normalized];

  const paragraphs = normalized.split(/\n\n+/);
  const chunks: string[] = [];
  let currentChunk = '';
  const state: CodeFenceState = { inCodeBlock: false, codeBlockLang: '' };

  for (const para of paragraphs) {
    currentChunk = appendParagraphToChunks(para, state, chunks, currentChunk, maxBytes);
  }

  if (currentChunk) {
    if (state.inCodeBlock) {
      chunks.push(`${currentChunk}\n\`\`\``);
    } else {
      chunks.push(currentChunk);
    }
  }
  return chunks;
}
