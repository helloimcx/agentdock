import assert from 'node:assert/strict';
import test from 'node:test';

import type { AutomationDefinition, AutomationEvaluation } from '../../packages/contracts/src/automations.js';
import {
  AutomationActionExecutor,
  renderAutomationPrompt,
} from '../../services/local-ai-core/src/automation/automation-action-executor.js';

function definition(platform = 'lark'): AutomationDefinition {
  return {
    id: 'automation-1',
    workspaceId: 'workspace-1',
    title: 'Safe prompt',
    enabled: true,
    health: 'healthy',
    activation: { kind: 'once', runAt: '2026-07-05T08:00:00.000Z' },
    condition: { kind: 'always' },
    action: { kind: 'agent-prompt', promptTemplate: 'run', executionMode: 'side-thread' },
    delivery: { platform, route: { type: 'channel.chat', channelId: 'chat-1' } },
    policies: { concurrency: 'skip-if-running', cooldownMs: 0 },
    consecutiveEvaluationFailures: 0,
    createdAt: '2026-07-05T07:00:00.000Z',
    updatedAt: '2026-07-05T07:00:00.000Z',
    originKind: 'native',
  };
}

const evaluation: AutomationEvaluation = {
  id: 'evaluation-1',
  automationId: 'automation-1',
  status: 'finished',
  activationKind: 'once',
  startedAt: '2026-07-05T08:00:00.000Z',
  finishedAt: '2026-07-05T08:00:00.000Z',
  conditionOutcome: 'matched',
  triggerDecision: 'triggered',
};

test('prompt rendering uses only own data properties and safely serializes objects', () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const inherited = Object.create({ constructor: 'unsafe', toString: 'unsafe', prototype: 'unsafe' }) as Record<string, unknown>;
  Object.defineProperty(inherited, 'constructor', { enumerable: true, value: 'also unsafe' });
  const object = Object.create({ toJSON: () => { throw new Error('must not run'); } }) as Record<string, unknown>;
  object.value = 42;
  Object.defineProperty(object, 'nestedGetter', { enumerable: true, get: () => { throw new Error('must not run'); } });
  inherited.object = object;
  inherited.circular = circular;
  Object.defineProperty(inherited, 'getter', { enumerable: true, get: () => { throw new Error('must not run'); } });

  assert.equal(
    renderAutomationPrompt(
      '{{constructor}}|{{toString}}|{{prototype}}|{{getter}}|{{object}}|{{circular}}',
      inherited,
    ),
    '||||{"value":42}|[Unserializable]',
  );
});

test('action executor closes an opened bridge when ACP send fails', async () => {
  let closed = false;
  const executor = new AutomationActionExecutor({
    store: {
      getPlatformThreadBinding: () => undefined,
      getRun: () => ({ status: 'completed' }),
    },
    getWorkspaceRouter: () => ({
      listThreads: async () => [],
      createThread: async () => ({ id: 'thread-1' }),
      getThreadSessionKey: () => 'session-1',
      sendThreadMessage: async () => { throw new Error('send failed'); },
    }),
    getChannelRuntime: () => ({
      platform: 'lark',
      registerScheduledThreadBridge: async () => () => { closed = true; },
      onBridgeEvent: async () => undefined,
    }),
  } as any);

  await assert.rejects(() => executor.execute({
    automation: definition(),
    evaluation,
    promptVariables: {},
  }), /send failed/);
  assert.equal(closed, true);
});
