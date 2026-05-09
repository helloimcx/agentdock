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
