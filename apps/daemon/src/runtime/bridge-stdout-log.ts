import process from 'node:process';

export const BRIDGE_LOG_MAX_CHARS = 4096;
export const BRIDGE_LOG_PREFIX = '[local-ai-core bridge]';

// Bridge events carry full tool outputs (tens of KB); dumping them raw to the
// journal produced multi-KB lines (2026-11-15 06:02 death log) and the write
// itself allocates the giant string right when the heap can least afford it.

/** Returns value unchanged when short enough; otherwise a capped prefix with
 *  a dropped-char marker. Generic so a required string stays required. */
export function capString<T extends string | undefined>(value: T, maxChars: number): T {
  if (value === undefined || value.length <= maxChars) {
    return value;
  }
  const capped = `${value.slice(0, maxChars)} …[truncated ${value.length - maxChars} chars]`;
  return capped as T;
}
export function formatBridgeLogLine(event: unknown, maxChars: number = BRIDGE_LOG_MAX_CHARS): string {
  const json = JSON.stringify(event) ?? 'undefined';
  const capped = capString(json, maxChars);
  if (capped === json) {
    return `${BRIDGE_LOG_PREFIX} ${json}\n`;
  }
  return `${BRIDGE_LOG_PREFIX} ${capped}\n`;
}

// process.stdout on a pipe (journald) buffers unboundedly inside libuv while
// the reader is stalled; that retained queue was the OOM vector. Diagnostic
// lines are dropped during the stall, and callers pass a producer so an
// oversized event is never stringified at all while suspended.
export function createLossyStdoutLineWriter(stream: NodeJS.WritableStream = process.stdout) {
  let suspended = false;
  let dropped = 0;
  stream.on('drain', () => {
    if (!suspended) {
      return;
    }
    suspended = false;
    if (dropped > 0) {
      suspended = !stream.write(`[local-ai-core] stdout backpressure cleared; dropped ${dropped} diagnostic lines\n`);
      dropped = 0;
    }
  });
  return (produceLine: () => string) => {
    if (suspended) {
      dropped += 1;
      return;
    }
    suspended = !stream.write(produceLine());
  };
}
