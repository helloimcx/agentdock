import assert from 'node:assert/strict';
import test from 'node:test';
import { createCoreClient, type CoreEventSource } from '../../packages/core-sdk/src/client.js';

class FakeEventSource implements CoreEventSource {
  readonly listeners = new Map<string, Set<(event: { data: string }) => void>>();
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  closed = false;

  addEventListener(type: string, listener: (event: { data: string }) => void) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, payload: unknown) {
    for (const listener of this.listeners.get(type) || []) {
      listener({ data: typeof payload === 'string' ? payload : JSON.stringify(payload) });
    }
  }

  close() {
    this.closed = true;
  }
}

test('core client shares one event source across subscribers and closes it after the last unsubscribe', () => {
  const sources: FakeEventSource[] = [];
  const client = createCoreClient({
    baseUrl: 'http://127.0.0.1:9831/api/local/v1/',
    eventSourceFactory: () => {
      const source = new FakeEventSource();
      sources.push(source);
      return source;
    },
  });

  const first = client.events.subscribe(() => {});
  const second = client.events.subscribe(() => {});
  assert.equal(sources.length, 1);
  assert.equal(client.baseUrl, 'http://127.0.0.1:9831/api/local/v1');

  first();
  assert.equal(sources[0].closed, false);
  second();
  assert.equal(sources[0].closed, true);
});

test('core clients with the same base URL share one event source across instances', () => {
  const sources: FakeEventSource[] = [];
  const firstClient = createCoreClient({
    baseUrl: 'http://127.0.0.1:9831/api/local/v1/',
    eventSourceFactory: () => {
      const source = new FakeEventSource();
      sources.push(source);
      return source;
    },
  });
  const secondClient = createCoreClient({
    baseUrl: 'http://127.0.0.1:9831/api/local/v1',
    eventSourceFactory: () => {
      const source = new FakeEventSource();
      sources.push(source);
      return source;
    },
  });

  const firstEventTypes: string[] = [];
  const secondEventTypes: string[] = [];
  const stopFirst = firstClient.events.subscribe((event) => firstEventTypes.push(event.type));
  const stopSecond = secondClient.events.subscribe((event) => secondEventTypes.push(event.type));

  assert.equal(sources.length, 1);
  sources[0].emit('presence.updated', { type: 'presence.updated', live: true });
  assert.deepEqual(firstEventTypes, ['presence.updated']);
  assert.deepEqual(secondEventTypes, ['presence.updated']);

  stopFirst();
  assert.equal(sources[0].closed, false);
  stopSecond();
  assert.equal(sources[0].closed, true);
});

test('core client ignores malformed events and maps stream events to bridge subscribers', () => {
  const source = new FakeEventSource();
  const events: string[] = [];
  const bridgeContents: string[] = [];
  const client = createCoreClient({
    baseUrl: 'http://127.0.0.1:9831/api/local/v1',
    eventSourceFactory: () => source,
  });
  const stopEvents = client.events.subscribe((event) => events.push(event.type));
  const stopBridge = client.events.subscribeBridge((event) => bridgeContents.push(event.content || ''));

  source.emit('stream.updated', '{not-json');
  source.emit('stream.updated', {
    type: 'stream.updated',
    stream: { type: 'reply', sessionKey: 'workspace:thread', content: 'done' },
  });

  assert.deepEqual(events, ['stream.updated']);
  assert.deepEqual(bridgeContents, ['done']);
  stopBridge();
  stopEvents();
});

test('core client ignores valid JSON events that do not match the event contract', () => {
  const source = new FakeEventSource();
  const events: string[] = [];
  const client = createCoreClient({
    baseUrl: 'http://127.0.0.1:9841/api/local/v1',
    eventSourceFactory: () => source,
  });
  const stop = client.events.subscribe((event) => events.push(event.type));

  source.emit('runtime.updated', { type: 'runtime.updated' });
  source.emit('presence.updated', { type: 'presence.updated', live: 'yes' });
  source.emit('stream.updated', { type: 'stream.updated', stream: { content: 'missing bridge type' } });
  source.emit('presence.updated', { type: 'presence.updated', live: false });

  assert.deepEqual(events, ['presence.updated']);
  stop();
});

test('core client accepts all four complete unified automation SSE events and rejects partial payloads', () => {
  const source = new FakeEventSource();
  const events: string[] = [];
  const client = createCoreClient({
    baseUrl: 'http://127.0.0.1:9851/api/local/v1',
    eventSourceFactory: () => source,
  });
  const stop = client.events.subscribe((event) => events.push(event.type));

  source.emit('automation.definition.updated', {
    type: 'automation.definition.updated',
    automation: completeAutomation(),
  });
  source.emit('automation.definition.updated', {
    type: 'automation.definition.updated', automation: { ...completeAutomation(), health: 'blocked' },
  });
  source.emit('automation.evaluation.updated', {
    type: 'automation.evaluation.updated',
    evaluation: completeEvaluation(),
  });
  source.emit('automation.evaluation.updated', {
    type: 'automation.evaluation.updated',
    evaluation: { ...completeEvaluation(), conditionOutcome: 'matched', triggerDecision: 'not_evaluated' },
  });
  source.emit('automation.evaluation.updated', {
    type: 'automation.evaluation.updated',
    evaluation: { id: 'evaluation-running', automationId: 'automation-1', activationKind: 'interval', status: 'running', startedAt: '2026-07-12T00:00:00.000Z', finishedAt: '2026-07-12T00:00:01.000Z' },
  });
  source.emit('automation.run.updated', {
    type: 'automation.run.updated',
    run: completeAutomationRun(),
  });
  source.emit('automation.script-version.updated', {
    type: 'automation.script-version.updated',
    version: completeScriptVersion(),
  });
  source.emit('automation.definition.updated', {
    type: 'automation.definition.updated',
    automation: { ...completeAutomation(), condition: { kind: 'approved-script', scriptId: 'script-1', approvedVersionId: 'version-1', edge: 'falling' } },
  });
  source.emit('automation.evaluation.updated', {
    type: 'automation.evaluation.updated',
    evaluation: { ...completeEvaluation(), conditionOutcome: 'matched', triggerDecision: 'not_rising' },
  });
  source.emit('automation.run.updated', {
    type: 'automation.run.updated', run: { ...completeAutomationRun(), status: 'unknown' },
  });
  source.emit('automation.script-version.updated', {
    type: 'automation.script-version.updated', version: { ...completeScriptVersion(), env: ['TOKEN', 1] },
  });
  source.emit('automation.definition.updated', {
    type: 'automation.definition.updated',
    automation: { id: 'automation-1' },
  });
  source.emit('automation.script-version.updated', {
    type: 'automation.script-version.updated',
    version: { id: 'version-1', scriptId: 'script-1' },
  });

  assert.deepEqual(events, [
    'automation.definition.updated',
    'automation.evaluation.updated',
    'automation.run.updated',
    'automation.script-version.updated',
    'automation.evaluation.updated',
  ]);
  stop();
});

function completeAutomation() {
  return {
    id: 'automation-1', workspaceId: 'workspace-1', title: 'Automation', enabled: true, health: 'healthy',
    activation: { kind: 'interval', intervalMs: 1_000 }, condition: { kind: 'always' },
    action: { kind: 'agent-prompt', promptTemplate: 'hello', executionMode: 'same-thread' },
    delivery: { platform: 'lark', route: { type: 'group', channelId: 'channel-1' } },
    policies: { concurrency: 'skip-if-running', cooldownMs: 0 }, consecutiveEvaluationFailures: 0,
    createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T00:00:00.000Z',
  };
}

function completeEvaluation() {
  return {
    id: 'evaluation-1', automationId: 'automation-1', activationKind: 'interval', status: 'finished',
    startedAt: '2026-07-12T00:00:00.000Z', finishedAt: '2026-07-12T00:00:01.000Z',
    conditionOutcome: 'not_matched', triggerDecision: 'not_rising',
  };
}

function completeAutomationRun() {
  return {
    id: 'run-1', automationId: 'automation-1', evaluationId: 'evaluation-1', status: 'succeeded',
    executionMode: 'same-thread', createdAt: '2026-07-12T00:00:00.000Z',
  };
}

function completeScriptVersion() {
  return {
    id: 'version-1', scriptId: 'script-1', status: 'approved', packageSha256: 'a'.repeat(64),
    packagePath: '/managed/a', shebang: '#!/usr/bin/env node', interpreterPath: '/usr/bin/node', interpreterVersion: 'v22',
    capabilities: {}, config: {}, configSchema: {}, networkMode: 'none', internalAccess: false,
    allowedReadDirs: [], secretRefs: [], env: [],
    limits: { timeoutMs: 30_000, stdoutBytes: 1_000, stderrBytes: 1_000, payloadBytes: 1_000, stateBytes: 1_000 },
    staticCheck: {}, testPlan: {}, createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T00:00:00.000Z',
  };
}

test('core client rejects events whose nested payload misses required contract fields', () => {
  const source = new FakeEventSource();
  const events: string[] = [];
  const client = createCoreClient({
    baseUrl: 'http://127.0.0.1:9831/api/local/v1',
    eventSourceFactory: () => source,
  });
  const stop = client.events.subscribe((event) => events.push(event.type));

  source.emit('run.updated', { type: 'run.updated', run: {} });
  source.emit('message.created', { type: 'message.created', threadId: 'thread-1', message: {} });
  source.emit('scheduler.run.updated', { type: 'scheduler.run.updated', run: { id: 'run-1' } });
  source.emit('run.updated', {
    type: 'run.updated',
    run: {
      id: 'run-1',
      threadId: 'thread-1',
      status: 'running',
      startedAt: '2026-06-21T00:00:00.000Z',
      updatedAt: '2026-06-21T00:00:01.000Z',
    },
  });

  assert.deepEqual(events, ['run.updated']);
  stop();
});

test('identical listener functions retain independent subscriptions', () => {
  const source = new FakeEventSource();
  let calls = 0;
  const listener = () => {
    calls += 1;
  };
  const client = createCoreClient({
    baseUrl: 'http://127.0.0.1:9831/api/local/v1',
    eventSourceFactory: () => source,
  });

  const stopFirst = client.events.subscribe(listener);
  const stopSecond = client.events.subscribe(listener);
  stopFirst();

  assert.equal(source.closed, false);
  source.emit('presence.updated', { type: 'presence.updated', live: true });
  assert.equal(calls, 1);

  stopSecond();
  assert.equal(source.closed, true);
});

test('one failing event listener does not prevent other subscribers from receiving the event', () => {
  const source = new FakeEventSource();
  const events: string[] = [];
  const client = createCoreClient({
    baseUrl: 'http://127.0.0.1:9844/api/local/v1',
    eventSourceFactory: () => source,
  });
  const stopFailing = client.events.subscribe(() => {
    throw new Error('listener failed');
  });
  const stopHealthy = client.events.subscribe((event) => events.push(event.type));

  source.emit('presence.updated', { type: 'presence.updated', live: true });

  assert.deepEqual(events, ['presence.updated']);
  stopFailing();
  stopHealthy();
});

test('core client schedules only one reconnect while an error is outstanding', () => {
  const sources: FakeEventSource[] = [];
  const reconnects: Array<() => void> = [];
  const client = createCoreClient({
    baseUrl: 'http://127.0.0.1:9831/api/local/v1',
    eventSourceFactory: () => {
      const source = new FakeEventSource();
      sources.push(source);
      return source;
    },
    scheduleReconnect: (callback) => {
      reconnects.push(callback);
      return reconnects.length;
    },
    cancelReconnect: () => {},
  });
  const stop = client.events.subscribe(() => {});

  sources[0].onerror?.();
  sources[0].onerror?.();
  assert.equal(reconnects.length, 1);
  reconnects[0]();
  assert.equal(sources.length, 2);

  stop();
});

test('an obsolete event source cannot schedule another reconnect after replacement', () => {
  const sources: FakeEventSource[] = [];
  const reconnects: Array<() => void> = [];
  const client = createCoreClient({
    baseUrl: 'http://127.0.0.1:9842/api/local/v1',
    eventSourceFactory: () => {
      const source = new FakeEventSource();
      sources.push(source);
      return source;
    },
    scheduleReconnect: (callback) => {
      reconnects.push(callback);
      return reconnects.length;
    },
    cancelReconnect: () => {},
  });
  const stop = client.events.subscribe(() => {});

  sources[0].onerror?.();
  reconnects[0]();
  sources[0].onerror?.();

  assert.equal(reconnects.length, 1);
  stop();
});

test('core client reports reconnect so consumers can recover missed state', () => {
  const sources: FakeEventSource[] = [];
  const reconnects: Array<() => void> = [];
  const states: string[] = [];
  const client = createCoreClient({
    baseUrl: 'http://127.0.0.1:9845/api/local/v1',
    eventSourceFactory: () => {
      const source = new FakeEventSource();
      sources.push(source);
      return source;
    },
    scheduleReconnect: (callback) => {
      reconnects.push(callback);
      return reconnects.length;
    },
    cancelReconnect: () => {},
  });
  const stop = client.events.subscribeConnectionState((state) => states.push(state));

  sources[0].onopen?.();
  sources[0].onerror?.();
  reconnects[0]();
  sources[1].onopen?.();

  assert.deepEqual(states, ['connected', 'disconnected', 'connected']);
  stop();
  assert.equal(sources[1].closed, true);
});

test('core client rejects partially populated scheduler and automation payloads', () => {
  const source = new FakeEventSource();
  const events: string[] = [];
  const client = createCoreClient({
    baseUrl: 'http://127.0.0.1:9843/api/local/v1',
    eventSourceFactory: () => source,
  });
  const stop = client.events.subscribe((event) => events.push(event.type));

  source.emit('scheduler.job.updated', {
    type: 'scheduler.job.updated',
    job: {
      id: 'job-1',
      workspaceId: 'workspace-1',
      platform: 'local',
      triggerType: 'cron',
      promptTemplate: 'run',
      enabled: true,
      createdAt: '',
      updatedAt: '',
    },
  });
  source.emit('automation.monitor.updated', {
    type: 'automation.monitor.updated',
    monitor: {
      id: 'monitor-1',
      workspaceId: 'workspace-1',
      title: 'price',
      sourceType: 'stock.quote',
      sourceConfig: {},
      condition: {},
      promptTemplate: 'analyze',
      enabled: true,
      cooldownMs: 1000,
      createdAt: '',
      updatedAt: '',
    },
  });

  assert.deepEqual(events, []);
  stop();
});
