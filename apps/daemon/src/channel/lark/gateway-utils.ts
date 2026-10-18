import type { ChannelInboundContentPart } from '@cc/superai-contracts';

export function summarizeLarkInboundContentParts(parts: ChannelInboundContentPart[]) {
  const text = parts
    .filter((part): part is Extract<ChannelInboundContentPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .filter(Boolean)
    .join('\n\n')
    .trim();
  if (text) return text;
  return parts
    .map((part) => part.type === 'image'
      ? '[Image]'
      : part.type === 'file'
        ? part.fileName ? `[File: ${part.fileName}]` : '[File]'
        : '')
    .filter(Boolean)
    .join('\n');
}

export function extractLarkHeaderMimeType(headers: unknown) {
  const value = headers && typeof headers === 'object'
    ? (headers as Record<string, unknown>)['content-type'] || (headers as Record<string, unknown>)['Content-Type']
    : '';
  return String(value || '').split(';')[0]?.trim() || '';
}

export function sniffLarkImageMimeType(buffer: Buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif';
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return 'image/webp';
  return 'application/octet-stream';
}

export function sniffLarkImageExtension(buffer: Buffer) {
  const mimeType = sniffLarkImageMimeType(buffer);
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType === 'image/webp') return 'webp';
  return 'bin';
}

function summarizeWsArgs(args: unknown[]) {
  if (args.length === 0) return 'no-args';
  return args.map((arg) => {
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
    if (typeof arg === 'string') return arg.slice(0, 200);
    if (arg && typeof arg === 'object') return JSON.stringify(Object.keys(arg as Record<string, unknown>));
    return String(arg);
  }).join(' ');
}

export function attachLarkWsDiagnostics(
  workspaceId: string,
  wsClient: any,
  log?: (message: string) => void,
) {
  const on = typeof wsClient?.on === 'function' ? wsClient.on.bind(wsClient) : null;
  if (!on) {
    log?.(`localcore-lark ws diagnostics unavailable for ${workspaceId}: client has no on()`);
    return;
  }
  for (const eventName of ['open', 'connect', 'connected', 'ready', 'close', 'closed', 'disconnect', 'error', 'reconnect']) {
    try {
      on(eventName, (...args: unknown[]) => {
        log?.(`localcore-lark ws event ${eventName} for ${workspaceId}: ${summarizeWsArgs(args)}`);
      });
    } catch (error) {
      log?.(`localcore-lark ws diagnostic hook failed for ${workspaceId} event=${eventName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export function maskLarkAppId(appId: string) {
  const value = String(appId || '').trim();
  if (value.length <= 8) return value ? '***' : '';
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
