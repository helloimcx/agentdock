import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoreClient } from '../../packages/core-sdk/src/client.js';
import type { LocalCoreEvent } from '@cc/superai-contracts';

let baseUrlCounter = 0;

function createEventCapture() {
  const listeners = new Map<string, (message: { data: string }) => void>();
  const eventSourceFactory = () => ({
    onopen: null,
    onerror: null,
    addEventListener: (type: string, listener: (message: { data: string }) => void) => {
      listeners.set(type, listener);
    },
    close: () => {},
  });
  baseUrlCounter += 1;
  const client = createCoreClient({
    baseUrl: `http://127.0.0.1:9${String(baseUrlCounter).padStart(4, '0')}`,
    eventSourceFactory,
    scheduleReconnect: () => 0,
    cancelReconnect: () => {},
  });

  const received: LocalCoreEvent[] = [];
  client.events.subscribe((event) => received.push(event));

  return {
    client,
    received,
    emit: (payload: unknown) => {
      assert(payload && typeof payload === 'object' && 'type' in payload);
      const listener = listeners.get(String((payload as { type: unknown }).type));
      assert(listener, `no listener registered for event type ${(payload as { type: unknown }).type}`);
      listener({ data: JSON.stringify(payload) });
    },
  };
}

const validDefinition = () => ({
  id: 'a1',
  workspaceId: 'ws1',
  title: 'Demo automation',
  enabled: true,
  health: 'healthy',
  activation: { kind: 'cron', expression: '* * * * *', timezone: 'UTC' },
  condition: { kind: 'expression', expression: 'price > 10' },
  action: { kind: 'agent-prompt', promptTemplate: 'analyze', executionMode: 'side-thread' },
  delivery: { platform: 'lark', route: { type: 'chat', channelId: 'c1' } },
  policies: { concurrency: 'skip-if-running', cooldownMs: 0 },
  consecutiveEvaluationFailures: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

test('automation.definition.updated guard accepts valid definitions and rejects malformed ones', () => {
  const { client, received, emit } = createEventCapture();
  try {
    emit({ type: 'automation.definition.updated', automation: validDefinition() });
    assert.equal(received.length, 1);

    emit({ type: 'automation.definition.updated', automation: { ...validDefinition(), title: 42 } });
    emit({ type: 'automation.definition.updated', automation: { ...validDefinition(), health: 'unknown' } });
    emit({
      type: 'automation.definition.updated',
      automation: { ...validDefinition(), health: 'blocked' },
    });
    emit({ type: 'automation.definition.updated', automation: { ...validDefinition(), lastSuccessfulMatch: 'yes' } });
    assert.equal(received.length, 1);

    emit({
      type: 'automation.definition.updated',
      automation: { ...validDefinition(), health: 'blocked', blockedReason: 'policy', blockedReasonExtra: undefined },
    });
    assert.equal(received.length, 2);
  } finally {
    client.events.close();
  }
});

test('automation.evaluation.updated guard pins running and finished field rules', () => {
  const { client, received, emit } = createEventCapture();
  try {
    const running = {
      id: 'e1',
      automationId: 'a1',
      activationKind: 'cron',
      status: 'running',
      startedAt: '2026-01-01T00:00:00.000Z',
    };
    emit({ type: 'automation.evaluation.updated', evaluation: running });
    emit({ type: 'automation.evaluation.updated', evaluation: { ...running, finishedAt: '2026-01-01T00:01:00.000Z' } });
    emit({ type: 'automation.evaluation.updated', evaluation: { ...running, status: 'finished' } });
    emit({ type: 'automation.evaluation.updated', evaluation: { ...running, activationKind: 'webhook' } });
    assert.equal(received.length, 1);

    const finishedBase = {
      id: 'e2',
      automationId: 'a1',
      activationKind: 'interval',
      status: 'finished',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:01:00.000Z',
    };
    emit({ type: 'automation.evaluation.updated', evaluation: { ...finishedBase, conditionOutcome: 'matched', triggerDecision: 'triggered' } });
    emit({ type: 'automation.evaluation.updated', evaluation: { ...finishedBase, conditionOutcome: 'matched', triggerDecision: 'not_rising' } });
    emit({ type: 'automation.evaluation.updated', evaluation: { ...finishedBase, conditionOutcome: 'matched', triggerDecision: 'not_evaluated' } });
    emit({ type: 'automation.evaluation.updated', evaluation: { ...finishedBase, conditionOutcome: 'not_matched', triggerDecision: 'not_rising' } });
    emit({ type: 'automation.evaluation.updated', evaluation: { ...finishedBase, conditionOutcome: 'error', triggerDecision: 'not_evaluated' } });
    emit({ type: 'automation.evaluation.updated', evaluation: { ...finishedBase, conditionOutcome: 'skipped', triggerDecision: 'skipped_concurrent' } });
    emit({ type: 'automation.evaluation.updated', evaluation: { ...finishedBase, conditionOutcome: 'skipped', triggerDecision: 'triggered' } });
    assert.equal(received.length, 6);
  } finally {
    client.events.close();
  }
});

const validScriptVersion = () => ({
  id: 'v1',
  scriptId: 's1',
  status: 'approved',
  packageSha256: 'abc123',
  packagePath: '/var/packages/s1',
  shebang: '#!/usr/bin/env python3',
  interpreterPath: '/usr/bin/python3',
  interpreterVersion: '3.12.0',
  capabilities: {},
  config: {},
  configSchema: {},
  networkMode: 'none',
  internalAccess: false,
  allowedReadDirs: [],
  secretRefs: [],
  env: [],
  limits: { timeoutMs: 1000, stdoutBytes: 1024, stderrBytes: 1024, payloadBytes: 1024, stateBytes: 1024 },
  staticCheck: {},
  testPlan: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

test('automation.script-version.updated guard accepts valid versions and rejects malformed ones', () => {
  const { client, received, emit } = createEventCapture();
  try {
    emit({ type: 'automation.script-version.updated', version: validScriptVersion() });
    assert.equal(received.length, 1);

    emit({ type: 'automation.script-version.updated', version: { ...validScriptVersion(), status: 'unknown' } });
    emit({ type: 'automation.script-version.updated', version: { ...validScriptVersion(), networkMode: 'vpn' } });
    emit({ type: 'automation.script-version.updated', version: { ...validScriptVersion(), internalAccess: 'no' } });
    emit({ type: 'automation.script-version.updated', version: { ...validScriptVersion(), env: [1] } });
    emit({ type: 'automation.script-version.updated', version: { ...validScriptVersion(), limits: { ...validScriptVersion().limits, timeoutMs: -1 } } });
    emit({ type: 'automation.script-version.updated', version: { ...validScriptVersion(), capabilities: null } });
    assert.equal(received.length, 1);
  } finally {
    client.events.close();
  }
});

test('automation.run.updated and message.updated guards pin enum and optional-field rules', () => {
  const { client, received, emit } = createEventCapture();
  try {
    const validRun = {
      id: 'r1',
      automationId: 'a1',
      evaluationId: 'e1',
      status: 'succeeded',
      executionMode: 'side-thread',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    emit({ type: 'automation.run.updated', run: validRun });
    emit({ type: 'automation.run.updated', run: { ...validRun, threadId: 't1', deliveryStatus: 'delivered' } });
    emit({ type: 'automation.run.updated', run: { ...validRun, status: 'cancelled' } });
    emit({ type: 'automation.run.updated', run: { ...validRun, deliveryStatus: 'shipped' } });
    emit({ type: 'automation.run.updated', run: { ...validRun, threadId: 7 } });
    assert.equal(received.length, 2);

    const baseMessage = { id: 'm1', role: 'assistant', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' };
    emit({ type: 'message.created', threadId: 't1', message: baseMessage });
    emit({ type: 'message.updated', threadId: 't1', message: { role: 'user' } });
    emit({ type: 'message.updated', threadId: 't1', message: { role: 'superuser' } });
    emit({ type: 'message.updated', threadId: 't1', message: { timestamp: 42 } });
    assert.equal(received.length, 4);
  } finally {
    client.events.close();
  }
});
