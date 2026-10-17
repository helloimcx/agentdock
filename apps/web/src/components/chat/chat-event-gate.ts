import type { DesktopBridgeEvent, LocalCoreEvent } from '@cc/superai-contracts';

export type ChatPendingTurn = {
  sessionKey: string;
  runId?: string;
  supersededRunId?: string;
};

export type ChatEventContext = {
  activeRunId?: string;
  pendingTurn?: ChatPendingTurn | null;
};

const lateStreamingEventTypes = new Set<DesktopBridgeEvent['type']>([
  'buttons',
  'reply',
  'preview_start',
  'status',
  'update_message',
  'typing_start',
]);

// Stateless signals re-arm reply timeouts or re-promote task state on every
// emission, so a legitimately repeated one (e.g. a re-delivery after a brief
// transport blip, or two genuine identical status lines) must NOT be dropped by
// the echo dedup. Content-bearing events keep full fingerprint dedup.
const statelessSignalTypes = new Set<DesktopBridgeEvent['type']>(['typing_start', 'status']);

function isStatelessSignalType(type: string) {
  return statelessSignalTypes.has(type as DesktopBridgeEvent['type']);
}

export function shouldAcceptRunScopedEvent(
  event: Pick<DesktopBridgeEvent, 'replyCtx' | 'sessionKey'>,
  context: ChatEventContext,
) {
  const replyCtx = String(event.replyCtx || '').trim();
  if (!replyCtx) {
    return true;
  }
  const activeRunId = String(context.activeRunId || '').trim();
  const pendingTurn = context.pendingTurn;
  if (pendingTurn && pendingTurn.sessionKey === event.sessionKey) {
    const pendingRunId = String(pendingTurn.runId || '').trim();
    if (pendingRunId) {
      return replyCtx === pendingRunId;
    }
    const supersededRunId = String(pendingTurn.supersededRunId || '').trim();
    if (supersededRunId && replyCtx === supersededRunId) {
      return false;
    }
  }
  return !activeRunId || replyCtx === activeRunId;
}

function bridgeEventFingerprint(event: DesktopBridgeEvent) {
  return JSON.stringify([
    event.type,
    event.sessionKey || '',
    event.replyCtx || '',
    event.previewHandle || '',
    event.messageId || '',
    event.bridgeKind || '',
    event.bridgeStatus || '',
    event.content || '',
    event.toolCall || null,
    event.buttonRows || event.buttons || null,
  ]);
}

function coreEventFingerprint(event: LocalCoreEvent) {
  return JSON.stringify(event);
}

function streamFromCoreEvent(event: LocalCoreEvent) {
  return 'stream' in event ? event.stream : undefined;
}

export function createChatEventGate(maxRememberedEvents = 256) {
  const fingerprints = new Set<string>();
  const fingerprintOrder: string[] = [];
  const settledTurns = new Set<string>();
  const settledTurnOrder: string[] = [];

  const remember = (fingerprint: string) => {
    if (fingerprints.has(fingerprint)) {
      return false;
    }
    fingerprints.add(fingerprint);
    fingerprintOrder.push(fingerprint);
    while (fingerprintOrder.length > maxRememberedEvents) {
      const oldest = fingerprintOrder.shift();
      if (oldest) {
        fingerprints.delete(oldest);
      }
    }
    return true;
  };

  const rememberSettledTurn = (turnKey: string) => {
    if (settledTurns.has(turnKey)) {
      return;
    }
    settledTurns.add(turnKey);
    settledTurnOrder.push(turnKey);
    while (settledTurnOrder.length > maxRememberedEvents) {
      const oldest = settledTurnOrder.shift();
      if (oldest) {
        settledTurns.delete(oldest);
      }
    }
  };

  return {
    acceptBridgeEvent(event: DesktopBridgeEvent, context: ChatEventContext = {}) {
      if (!shouldAcceptRunScopedEvent(event, context)) {
        return false;
      }
      const turnKey = event.replyCtx
        ? `${event.sessionKey || ''}:${event.replyCtx}`
        : '';
      if (turnKey && settledTurns.has(turnKey) && lateStreamingEventTypes.has(event.type)) {
        return false;
      }
      if (!isStatelessSignalType(event.type) && !remember(`bridge:${bridgeEventFingerprint(event)}`)) {
        return false;
      }
      if (turnKey && (event.type === 'typing_stop' || event.type === 'card')) {
        rememberSettledTurn(turnKey);
      }
      return true;
    },
    acceptCoreEvent(event: LocalCoreEvent) {
      const runTurnKey = event.type === 'run.updated' ? `run:${event.run.id}` : '';
      if (
        event.type === 'run.updated' &&
        settledTurns.has(runTurnKey) &&
        (event.run.status === 'queued' || event.run.status === 'running' || event.run.status === 'awaiting_input')
      ) {
        return false;
      }
      const stream = streamFromCoreEvent(event);
      const turnKey = stream?.replyCtx
        ? `${stream.sessionKey || ''}:${stream.replyCtx}`
        : '';
      if (turnKey && settledTurns.has(turnKey) && lateStreamingEventTypes.has(stream!.type)) {
        return false;
      }
      const isStatelessStream = stream ? isStatelessSignalType(stream.type) : false;
      if (!isStatelessStream && !remember(`core:${coreEventFingerprint(event)}`)) {
        return false;
      }
      if (turnKey && (stream?.type === 'typing_stop' || stream?.type === 'card')) {
        rememberSettledTurn(turnKey);
      }
      if (
        runTurnKey &&
        event.type === 'run.updated' &&
        (event.run.status === 'completed' || event.run.status === 'failed' || event.run.status === 'interrupted')
      ) {
        rememberSettledTurn(runTurnKey);
      }
      return true;
    },
    reset() {
      fingerprints.clear();
      fingerprintOrder.length = 0;
      settledTurns.clear();
      settledTurnOrder.length = 0;
    },
  };
}

export type ChatEventGate = ReturnType<typeof createChatEventGate>;
