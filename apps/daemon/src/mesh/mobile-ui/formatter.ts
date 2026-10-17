import type { UIElement, UIDumpResult } from './types.js';

function simplifyClassName(className: string): string {
  if (!className) return 'View';
  const parts = className.split('.');
  return parts[parts.length - 1] || 'View';
}

function simplifyViewId(id?: string): string {
  if (!id) return '';
  const idx = id.indexOf(':id/');
  if (idx !== -1) {
    return id.substring(idx + 4);
  }
  const slashIdx = id.lastIndexOf('/');
  if (slashIdx !== -1) {
    return id.substring(slashIdx + 1);
  }
  return id;
}

function truncateText(text: string, maxLength = 50): string {
  if (!text) return '';
  const singleLine = text.replace(/[\r\n]+/g, ' ').trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  return `${singleLine.slice(0, maxLength - 3)}...`;
}

export function sortElementsByReadingOrder(elements: UIElement[], rowTolerance = 20): UIElement[] {
  if (!elements || elements.length === 0) return [];

  // Group elements into horizontal rows based on top coordinate
  const validElements = elements.filter(el => el.bounds && el.bounds.length >= 4);
  const cloned = validElements.map(el => ({ ...el }));
  cloned.sort((a, b) => a.bounds[1] - b.bounds[1]);

  interface ElementRow {
    baseTop: number;
    items: UIElement[];
  }

  const rows: ElementRow[] = [];
  for (const el of cloned) {
    const top = el.bounds[1];
    let matchedRow = rows.find(r => Math.abs(r.baseTop - top) <= rowTolerance);
    if (!matchedRow) {
      matchedRow = { baseTop: top, items: [] };
      rows.push(matchedRow);
    }
    matchedRow.items.push(el);
  }

  // Sort rows vertically, and items in each row horizontally
  rows.sort((a, b) => a.baseTop - b.baseTop);

  const result: UIElement[] = [];
  let currentIndex = 1;
  for (const row of rows) {
    row.items.sort((a, b) => a.bounds[0] - b.bounds[0]);
    for (const item of row.items) {
      item.index = currentIndex++;
      result.push(item);
    }
  }

  return result;
}

export function formatElementsCompact(dump: UIDumpResult): string {
  const lines: string[] = [
    `=== Screen: ${dump.package || 'unknown'} (${dump.screenWidth}x${dump.screenHeight}) ===`,
  ];

  if (!dump.elements || dump.elements.length === 0) {
    lines.push('(No interactive elements found on screen)');
    return lines.join('\n');
  }

  for (const el of dump.elements) {
    const type = simplifyClassName(el.className);
    const textDesc = truncateText(el.text || el.desc || '');
    const textPart = textDesc ? ` "${textDesc}"` : '';
    const id = simplifyViewId(el.id);
    const idPart = id ? ` (id: ${id})` : '';
    const centerPart = (!id && el.center) ? ` (center: ${el.center[0]},${el.center[1]})` : '';
    const statePart = el.selected ? ' (selected)' : '';

    lines.push(`[${el.index}] [${type}]${textPart}${idPart}${centerPart}${statePart}`);
  }

  return lines.join('\n');
}
