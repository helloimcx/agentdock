import type { DesktopBridgeEvent } from '@cc/superai-contracts';

export function resolveBridgeEventKind(event: DesktopBridgeEvent) {
  if (event.bridgeKind) {
    return event.bridgeKind;
  }
  return event.type === 'status' ? 'status' : 'assistant';
}

export function pushUniqueLine(target: string[], value: string, maxLines: number) {
  const normalized = value.trim();
  if (!normalized) {
    return;
  }
  if (target[target.length - 1] === normalized) {
    return;
  }
  target.push(normalized);
  if (target.length > maxLines) {
    target.splice(0, target.length - maxLines);
  }
}
