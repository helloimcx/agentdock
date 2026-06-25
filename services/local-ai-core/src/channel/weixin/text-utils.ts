export function stripWeixinHtml(html: string): string {
  let result = html;
  let previous: string;
  do {
    previous = result;
    result = result.replace(/<[^>]*>/g, '');
  } while (result !== previous);
  return result
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export function waitForWeixinRetry(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf-8');
}

export function splitTextByUtf8Bytes(text: string, maxBytes: number): string[] {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  if (utf8ByteLength(normalized) <= maxBytes) return [normalized];

  const chunks: string[] = [];
  let current = '';
  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = '';
  };
  const appendPart = (part: string) => {
    if (!part.trim()) return;
    const separator = current ? '\n\n' : '';
    if (current && utf8ByteLength(`${current}${separator}${part}`) <= maxBytes) {
      current = `${current}${separator}${part}`;
      return;
    }
    if (current) pushCurrent();
    if (utf8ByteLength(part) <= maxBytes) {
      current = part;
      return;
    }
    let segment = '';
    for (const character of Array.from(part)) {
      if (segment && utf8ByteLength(`${segment}${character}`) > maxBytes) {
        chunks.push(segment);
        segment = '';
      }
      segment += character;
    }
    current = segment;
  };
  for (const part of normalized.split(/\n{2,}/)) appendPart(part);
  pushCurrent();
  return chunks;
}

export function truncateTextByUtf8Bytes(text: string, maxBytes: number): string {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (utf8ByteLength(normalized) <= maxBytes) return normalized;
  const suffix = '\n\n（内容过长，已截断以保证微信送达）';
  const budget = Math.max(0, maxBytes - utf8ByteLength(suffix));
  let result = '';
  for (const character of Array.from(normalized)) {
    if (utf8ByteLength(`${result}${character}`) > budget) break;
    result += character;
  }
  return `${result.trim()}${suffix}`;
}
