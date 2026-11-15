import process from 'node:process';

export const BRIDGE_LOG_MAX_CHARS = 4096;

// Bridge events carry full tool outputs (tens of KB); dumping them raw to the
// journal produced multi-KB lines (2026-11-15 06:02 death log) and the write
// itself allocates the giant string right when the heap can least afford it.
export function formatBridgeLogLine(event: unknown, maxChars: number = BRIDGE_LOG_MAX_CHARS): string {
  const json = JSON.stringify(event) ?? 'undefined';
  if (json.length <= maxChars) {
    return `[local-ai-core bridge] ${json}\n`;
  }
  return `[local-ai-core bridge] ${json.slice(0, maxChars)} …[truncated ${json.length - maxChars} chars]\n`;
}

// process.stdout on a pipe (journald) buffers unboundedly inside libuv while
// the reader is stalled; diagnostic lines must be dropped instead of piling up
// in process memory on long-lived daemons.
export function createLossyStdoutLineWriter(stream: NodeJS.WritableStream = process.stdout) {
  let suspended = false;
  let dropped = 0;
  stream.on('drain', () => {
    if (!suspended) {
      return;
    }
    suspended = false;
    if (dropped > 0) {
      stream.write(`[local-ai-core] stdout backpressure cleared; dropped ${dropped} diagnostic lines\n`);
      dropped = 0;
    }
  });
  return (line: string) => {
    if (suspended) {
      dropped += 1;
      return;
    }
    suspended = !stream.write(line);
  };
}
