import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  evaluateMonitorCondition,
  validateRestrictedExpression,
} from '../../services/local-ai-core/src/automation/condition-evaluator.js';
import { AutomationMonitorService } from '../../services/local-ai-core/src/automation/automation-monitor-service.js';
import { AutomationService } from '../../services/local-ai-core/src/automation/automation-service.js';
import { monitorToAutomationInput } from '../../services/local-ai-core/src/automation/legacy-automation-mappers.js';
import { LocalCoreAcpStore } from '../../services/local-ai-core/src/acp/local-core-acp-store.js';
import { LocalCoreEventBus } from '../../services/local-ai-core/src/kernel/event-bus.js';

const event = {
  id: 'event-1',
  sourceType: 'stock.quote',
  occurredAt: '2026-05-11T00:00:00.000Z',
  subject: 'AAPL',
  payload: {
    latestPrice: 188,
    change_percent: 4.2,
    volumeRatio: 2.1,
  },
};

test('monitor condition evaluator supports simple comparisons and safe boolean expressions', () => {
  assert.equal(evaluateMonitorCondition({
    metric: 'abs_change_percent',
    operator: '>=',
    value: 3,
  }, event), true);

  assert.equal(evaluateMonitorCondition({
    metric: 'expression',
    operator: '==',
    value: true,
    expression: 'abs_change_percent >= 3 && latestPrice > 100',
  }, event), true);

  assert.equal(evaluateMonitorCondition({
    metric: 'expression',
    operator: '==',
    value: true,
    expression: 'latestPrice < 100 || volumeRatio >= 2',
  }, event), true);
});

test('monitor expressions preserve payload nesting and top-level metric semantics', () => {
  const nestedEvent = {
    ...event,
    subject: 'AAPL',
    sourceType: 'stock.quote',
    payload: {
      subject: { market: 'NASDAQ' },
      sourceType: { vendor: 'IEX' },
    },
  };
  assert.equal(evaluateMonitorCondition({
    metric: 'expression',
    operator: '==',
    value: true,
    expression: 'subject.market == NASDAQ && sourceType.vendor == IEX',
  }, nestedEvent), true);
  assert.equal(evaluateMonitorCondition({
    metric: 'expression',
    operator: '==',
    value: true,
    expression: 'subject == AAPL && sourceType == stock.quote',
  }, nestedEvent), true);
});

test('restricted expression validation rejects malformed grammar without evaluating data', () => {
  for (const expression of ['not a comparison', 'latestPrice > 1 &&', '|| latestPrice > 1', 'latestPrice === 1']) {
    assert.throws(() => validateRestrictedExpression(expression), /Unsupported monitor condition expression/);
  }
  assert.doesNotThrow(() => validateRestrictedExpression('latestPrice >= 1 && sourceType == stock.quote'));
});

test('malformed legacy expressions are rejected before persistence, handles, or events', async () => {
  const context = monitorFixture();
  let starts = 0;
  let events = 0;
  context.eventBus.on('automation.definition.updated', () => { events += 1; });
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus,
    providers: [{ sourceType: 'stock.quote', modes: ['subscribe'], async startMonitor() {
      starts += 1; return { stop() {} };
    } }],
  });
  try {
    await assert.rejects(() => monitors.createMonitor({
      workspaceId: 'workspace', title: 'bad', sourceType: 'stock.quote',
      condition: { metric: 'expression', operator: '==', value: true, expression: 'not a comparison' },
      promptTemplate: 'quote',
    }), /Unsupported monitor condition expression/);
    assert.equal(context.automations.list().length, 0);
    assert.equal(starts, 0);
    assert.equal(events, 0);
  } finally { await monitors.stop(); context.close(); }
});

test('persisted malformed legacy expressions project explicitly without crashing list', () => {
  const context = monitorFixture();
  try {
    context.store.createTrustedAutomation({
      workspaceId: 'workspace', title: 'old expression', enabled: true,
      activation: { kind: 'provider-event', sourceType: 'stock.quote', sourceConfig: {} },
      condition: { kind: 'expression', expression: 'not a comparison' },
      action: { kind: 'agent-prompt', promptTemplate: 'quote', executionMode: 'side-thread' },
      delivery: { platform: 'local', route: { type: 'local.thread', channelId: 'workspace' } },
      policies: { concurrency: 'skip-if-running', cooldownMs: 0 },
      originKind: 'automation-monitor',
    });
    const monitors = new AutomationMonitorService({
      store: context.store, automations: context.automations, eventBus: context.eventBus, providers: [],
    });
    assert.deepEqual(monitors.listMonitors()[0]?.condition, {
      metric: 'expression', operator: '==', value: true, expression: 'not a comparison',
    });
  } finally { context.close(); }
});

function monitorFixture(execute?: (automationId: string) => Promise<void>) {
  const path = mkdtempSync(join(tmpdir(), 'monitor-lifecycle-'));
  const store = new LocalCoreAcpStore(path);
  const eventBus = new LocalCoreEventBus();
  const actions: string[] = [];
  const automations = new AutomationService({
    store,
    eventBus,
    actionExecutor: {
      async execute({ automation }) {
        actions.push(automation.id);
        await execute?.(automation.id);
        return { threadId: 'thread', acpRunId: `run:${automation.id}`, deliveryStatus: 'succeeded' as const };
      },
    },
    ownershipPolicy: { executes: () => true },
  });
  return { path, store, eventBus, automations, actions, close() { store.close(); rmSync(path, { recursive: true, force: true }); } };
}

test('subscription source reconfiguration stops the old handle before starting the new one', async () => {
  const context = monitorFixture();
  const transitions: string[] = [];
  const monitors = new AutomationMonitorService({
    store: context.store,
    automations: context.automations,
    eventBus: context.eventBus,
    providers: [{
      sourceType: 'stock.quote', modes: ['subscribe'],
      async startMonitor({ sourceConfig }) {
        const symbol = String(sourceConfig.symbol);
        transitions.push(`start:${symbol}`);
        return { async stop() { transitions.push(`stop:${symbol}`); } };
      },
    }],
  });
  try {
    const monitor = await monitors.createMonitor({
      workspaceId: 'workspace', title: 'Quote', sourceType: 'stock.quote', sourceConfig: { symbol: 'AAPL' },
      condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    });
    await monitors.updateMonitor(monitor.id, { sourceConfig: { symbol: 'MSFT' } });
    assert.deepEqual(transitions, ['start:AAPL', 'stop:AAPL', 'start:MSFT']);
  } finally { await monitors.stop(); context.close(); }
});

test('subscription lifecycle isolates rejecting starts and stops', async () => {
  const context = monitorFixture();
  const logs: string[] = [];
  const stopped: string[] = [];
  for (const kind of ['bad-start', 'bad-stop', 'good']) {
    context.automations.createFromLegacy(monitorToAutomationInput({
      workspaceId: 'workspace', title: kind, sourceType: 'stock.quote', sourceConfig: { kind },
      condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
      platform: 'local', route: { type: 'local.thread', channelId: 'workspace' },
    }));
  }
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus, log: (message) => logs.push(message),
    providers: [{
      sourceType: 'stock.quote', modes: ['subscribe'],
      async startMonitor({ sourceConfig }) {
        const kind = String(sourceConfig.kind);
        if (kind === 'bad-start') throw new Error('start rejected');
        return { async stop() { stopped.push(kind); if (kind === 'bad-stop') throw new Error('stop rejected'); } };
      },
    }],
  });
  try {
    await Promise.all([monitors.start(), monitors.start()]);
    await monitors.stop();
    assert.deepEqual(stopped.sort(), ['bad-stop', 'good']);
    assert.ok(logs.some((message) => message.includes('start rejected')));
    assert.ok(logs.some((message) => message.includes('stop rejected')));
  } finally { await monitors.stop(); context.close(); }
});

test('rejected subscription create removes the definition and retry creates exactly one monitor', async () => {
  const context = monitorFixture();
  let starts = 0;
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus,
    providers: [{
      sourceType: 'stock.quote', modes: ['subscribe'],
      async startMonitor() {
        starts += 1;
        if (starts === 1) throw new Error('TOKEN=subscription-secret\u001b[31m start rejected');
        return { stop() {} };
      },
    }],
  });
  const input = {
    workspaceId: 'workspace', title: 'Quote', sourceType: 'stock.quote', sourceConfig: { symbol: 'AAPL' },
    condition: { metric: 'latestPrice', operator: '>' as const, value: 1 }, promptTemplate: 'quote',
  };
  try {
    await assert.rejects(() => monitors.createMonitor(input), (error: Error) => {
      assert.match(error.message, /REDACTED_SECRET/);
      assert.doesNotMatch(error.message, /subscription-secret|\u001b/);
      return true;
    });
    assert.equal(context.automations.list().length, 0);
    const created = await monitors.createMonitor(input);
    assert.equal(starts, 2);
    assert.deepEqual(context.automations.list().map((automation) => automation.id), [created.id]);
  } finally { await monitors.stop(); context.close(); }
});

test('create fails closed and retains a returned handle when degradation compensation cannot stop it', async () => {
  const context = monitorFixture();
  let releaseStart!: () => void;
  const startBlocked = new Promise<void>((resolve) => { releaseStart = resolve; });
  let stopAttempts = 0;
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus,
    providers: [{
      sourceType: 'stock.quote', modes: ['subscribe'],
      async startMonitor() {
        await startBlocked;
        return { async stop() { if (++stopAttempts === 1) throw new Error('compensation stop rejected'); } };
      },
    }],
  });
  try {
    const creating = monitors.createMonitor({
      workspaceId: 'workspace', title: 'Quote', sourceType: 'stock.quote',
      condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    });
    await new Promise((resolve) => setImmediate(resolve));
    context.store.importLegacyAutomations = () => { throw new Error('migration blocked'); };
    await context.automations.start();
    releaseStart();
    await assert.rejects(() => creating, /Unified automation migration is unavailable/);
    const [definition] = context.automations.list();
    assert.equal(definition?.enabled, false);
    assert.equal(definition?.health, 'blocked');
    await monitors.stop();
    assert.equal(stopAttempts, 2);
  } finally {
    releaseStart();
    await context.automations.stop();
    await monitors.stop();
    context.close();
  }
});

test('source update keeps the old config and tracked handle when stop rejects, then retries cleanly', async () => {
  const context = monitorFixture();
  const transitions: string[] = [];
  let oldStopAttempts = 0;
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus,
    providers: [{
      sourceType: 'stock.quote', modes: ['subscribe'],
      async startMonitor({ sourceConfig }) {
        const symbol = String(sourceConfig.symbol);
        transitions.push(`start:${symbol}`);
        return {
          async stop() {
            transitions.push(`stop:${symbol}`);
            if (symbol === 'AAPL' && ++oldStopAttempts === 1) throw new Error('temporary stop rejection');
          },
        };
      },
    }],
  });
  try {
    const monitor = await monitors.createMonitor({
      workspaceId: 'workspace', title: 'Quote', sourceType: 'stock.quote', sourceConfig: { symbol: 'AAPL' },
      condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    });
    await assert.rejects(
      () => monitors.updateMonitor(monitor.id, { sourceConfig: { symbol: 'MSFT' } }),
      /temporary stop rejection/,
    );
    assert.deepEqual(monitors.getMonitor(monitor.id)?.sourceConfig, { symbol: 'AAPL' });
    const updated = await monitors.updateMonitor(monitor.id, { sourceConfig: { symbol: 'MSFT' } });
    assert.deepEqual(updated.sourceConfig, { symbol: 'MSFT' });
    assert.deepEqual(transitions.slice(0, 4), ['start:AAPL', 'stop:AAPL', 'stop:AAPL', 'start:MSFT']);
  } finally { await monitors.stop(); context.close(); }
});

test('enabling a disabled subscription starts before persistence and leaves it disabled on rejection', async () => {
  const context = monitorFixture();
  let starts = 0;
  let stops = 0;
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus,
    providers: [{
      sourceType: 'stock.quote', modes: ['subscribe'],
      async startMonitor() {
        starts += 1;
        if (starts === 1) throw new Error('enable start rejected');
        return { async stop() { stops += 1; } };
      },
    }],
  });
  try {
    const monitor = await monitors.createMonitor({
      workspaceId: 'workspace', title: 'Quote', sourceType: 'stock.quote', enabled: false,
      condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    });
    await assert.rejects(() => monitors.updateMonitor(monitor.id, { enabled: true }), /enable start rejected/);
    assert.equal(context.automations.get(monitor.id)?.enabled, false);
    const enabled = await monitors.updateMonitor(monitor.id, { enabled: true });
    assert.equal(enabled.enabled, true);
    assert.equal(starts, 2);
    await monitors.stop();
    assert.equal(stops, 1);
  } finally { await monitors.stop(); context.close(); }
});

test('disabling a subscription restores the old handle and definition when persistence rejects', async () => {
  const context = monitorFixture();
  let starts = 0;
  let stops = 0;
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus,
    providers: [{ sourceType: 'stock.quote', modes: ['subscribe'], async startMonitor() {
      starts += 1;
      return { async stop() { stops += 1; } };
    } }],
  });
  try {
    const monitor = await monitors.createMonitor({
      workspaceId: 'workspace', title: 'Quote', sourceType: 'stock.quote',
      condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    });
    const updateFromLegacy = context.automations.updateFromLegacy.bind(context.automations);
    context.automations.updateFromLegacy = () => { throw new Error('database update rejected'); };
    await assert.rejects(() => monitors.updateMonitor(monitor.id, { enabled: false }), /database update rejected/);
    assert.equal(context.automations.get(monitor.id)?.enabled, true);
    assert.equal(starts, 2);
    assert.equal(stops, 1);
    context.automations.updateFromLegacy = updateFromLegacy;
    await monitors.updateMonitor(monitor.id, { enabled: false });
    assert.equal(stops, 2);
  } finally { await monitors.stop(); context.close(); }
});

test('enabling a disabled subscription stops the new handle and remains disabled when persistence rejects', async () => {
  const context = monitorFixture();
  let stops = 0;
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus,
    providers: [{
      sourceType: 'stock.quote', modes: ['subscribe'],
      async startMonitor() { return { async stop() { stops += 1; } }; },
    }],
  });
  try {
    const monitor = await monitors.createMonitor({
      workspaceId: 'workspace', title: 'Quote', sourceType: 'stock.quote', enabled: false,
      condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    });
    const updateFromLegacy = context.automations.updateFromLegacy.bind(context.automations);
    context.automations.updateFromLegacy = (automationId, input) => {
      updateFromLegacy(automationId, input);
      throw new Error('enable persistence rejected');
    };
    await assert.rejects(() => monitors.updateMonitor(monitor.id, { enabled: true }), /enable persistence rejected/);
    assert.equal(context.automations.get(monitor.id)?.enabled, false);
    assert.equal(stops, 1);
    await monitors.stop();
    assert.equal(stops, 1);
  } finally { await monitors.stop(); context.close(); }
});

test('source update restores the old subscription and config when the new start rejects', async () => {
  const context = monitorFixture();
  const transitions: string[] = [];
  let oldStarts = 0;
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus,
    providers: [{
      sourceType: 'stock.quote', modes: ['subscribe'],
      async startMonitor({ sourceConfig }) {
        const symbol = String(sourceConfig.symbol);
        transitions.push(`start:${symbol}`);
        if (symbol === 'MSFT') throw new Error('new subscription rejected');
        oldStarts += 1;
        return { async stop() { transitions.push(`stop:${symbol}:${oldStarts}`); } };
      },
    }],
  });
  try {
    const monitor = await monitors.createMonitor({
      workspaceId: 'workspace', title: 'Quote', sourceType: 'stock.quote', sourceConfig: { symbol: 'AAPL' },
      condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    });
    await assert.rejects(
      () => monitors.updateMonitor(monitor.id, { sourceConfig: { symbol: 'MSFT' } }),
      /new subscription rejected/,
    );
    assert.deepEqual(monitors.getMonitor(monitor.id)?.sourceConfig, { symbol: 'AAPL' });
    assert.equal(monitors.getMonitor(monitor.id)?.enabled, true);
    assert.equal(oldStarts, 2);
    assert.deepEqual(transitions.slice(0, 4), ['start:AAPL', 'stop:AAPL:1', 'start:MSFT', 'start:AAPL']);
  } finally { await monitors.stop(); context.close(); }
});

test('source update is disabled and blocked when both the new start and old restoration reject', async () => {
  const context = monitorFixture();
  let oldStarts = 0;
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus,
    providers: [{
      sourceType: 'stock.quote', modes: ['subscribe'],
      async startMonitor({ sourceConfig }) {
        const symbol = String(sourceConfig.symbol);
        if (symbol === 'MSFT') throw new Error('new start rejected');
        oldStarts += 1;
        if (oldStarts > 1) throw new Error('old restore rejected');
        return { stop() {} };
      },
    }],
  });
  try {
    const monitor = await monitors.createMonitor({
      workspaceId: 'workspace', title: 'Quote', sourceType: 'stock.quote', sourceConfig: { symbol: 'AAPL' },
      condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    });
    await assert.rejects(
      () => monitors.updateMonitor(monitor.id, { sourceConfig: { symbol: 'MSFT' } }),
      /new start rejected/,
    );
    const definition = context.automations.get(monitor.id);
    assert.equal(definition?.enabled, false);
    assert.equal(definition?.health, 'blocked');
    assert.match(definition?.blockedReason || '', /new start rejected/);
    assert.match(definition?.blockedReason || '', /old restore rejected/);
    assert.deepEqual(monitors.getMonitor(monitor.id)?.sourceConfig, { symbol: 'AAPL' });
  } finally { await monitors.stop(); context.close(); }
});

test('successful enable recovers a provider-owned fail-closed block but preserves unrelated blocks', async () => {
  const context = monitorFixture();
  let emit!: (snapshot: typeof event) => Promise<void> | void;
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus,
    providers: [{ sourceType: 'stock.quote', modes: ['subscribe'], async startMonitor(input) {
      emit = input.emit;
      return { stop() {} };
    } }],
  });
  try {
    const monitor = await monitors.createMonitor({
      workspaceId: 'workspace', title: 'Quote', sourceType: 'stock.quote', enabled: false,
      condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    });
    context.automations.failClosedLegacyAutomation(monitor.id, 'provider transition failed');
    await monitors.updateMonitor(monitor.id, { enabled: true });
    assert.equal(context.automations.get(monitor.id)?.health, 'healthy');
    await monitors.start();
    await emit(event);
    assert.equal(context.automations.listEvaluations(monitor.id).length, 1);
    await monitors.updateMonitor(monitor.id, { enabled: false });
    context.store.updateAutomationState(monitor.id, { health: 'blocked', blockedReason: 'Approved script revoked' });
    await monitors.updateMonitor(monitor.id, { enabled: true });
    assert.equal(context.automations.get(monitor.id)?.blockedReason, 'Approved script revoked');
    await emit({ ...event, id: 'blocked-event' });
    assert.equal(context.automations.listEvaluations(monitor.id).length, 1);
  } finally { await monitors.stop(); context.close(); }
});

test('source update fails closed and tracks the new handle when persistence and compensation stop reject', async () => {
  const context = monitorFixture();
  const starts = new Map<string, number>();
  const stops = new Map<string, number>();
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus,
    providers: [{
      sourceType: 'stock.quote', modes: ['subscribe'],
      async startMonitor({ sourceConfig }) {
        const symbol = String(sourceConfig.symbol);
        starts.set(symbol, (starts.get(symbol) || 0) + 1);
        return {
          async stop() {
            const count = (stops.get(symbol) || 0) + 1;
            stops.set(symbol, count);
            if (symbol === 'MSFT' && count === 1) throw new Error('new handle stop rejected');
          },
        };
      },
    }],
  });
  try {
    const monitor = await monitors.createMonitor({
      workspaceId: 'workspace', title: 'Quote', sourceType: 'stock.quote', sourceConfig: { symbol: 'AAPL' },
      condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    });
    context.automations.updateFromLegacy = () => { throw new Error('persistence rejected'); };
    await assert.rejects(
      () => monitors.updateMonitor(monitor.id, { sourceConfig: { symbol: 'MSFT' } }),
      /persistence rejected/,
    );
    assert.equal(context.automations.get(monitor.id)?.enabled, false);
    assert.equal(context.automations.get(monitor.id)?.health, 'blocked');
    assert.deepEqual(Object.fromEntries(starts), { AAPL: 1, MSFT: 1 });
    await monitors.stop();
    assert.deepEqual(Object.fromEntries(stops), { AAPL: 1, MSFT: 2 });
  } finally { await monitors.stop(); context.close(); }
});

test('delete retains the definition and subscription after a rejected stop, then retries', async () => {
  const context = monitorFixture();
  let stopAttempts = 0;
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus,
    providers: [{
      sourceType: 'stock.quote', modes: ['subscribe'],
      async startMonitor() {
        return { async stop() { if (++stopAttempts === 1) throw new Error('stop rejected'); } };
      },
    }],
  });
  try {
    const monitor = await monitors.createMonitor({
      workspaceId: 'workspace', title: 'Quote', sourceType: 'stock.quote',
      condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    });
    await assert.rejects(() => monitors.deleteMonitor(monitor.id), /stop rejected/);
    assert.equal(monitors.getMonitor(monitor.id)?.id, monitor.id);
    assert.deepEqual(await monitors.deleteMonitor(monitor.id), { deleted: true });
    assert.equal(stopAttempts, 2);
    assert.equal(monitors.getMonitor(monitor.id), undefined);
  } finally { await monitors.stop(); context.close(); }
});

test('delete restarts the old subscription when database deletion rejects', async () => {
  const context = monitorFixture();
  let starts = 0;
  let stops = 0;
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus,
    providers: [{ sourceType: 'stock.quote', modes: ['subscribe'], async startMonitor() {
      starts += 1; return { async stop() { stops += 1; } };
    } }],
  });
  try {
    const monitor = await monitors.createMonitor({
      workspaceId: 'workspace', title: 'Quote', sourceType: 'stock.quote',
      condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    });
    const deleteAutomation = context.store.deleteAutomation.bind(context.store);
    context.store.deleteAutomation = () => { throw new Error('database delete rejected'); };
    await assert.rejects(() => monitors.deleteMonitor(monitor.id), /database delete rejected/);
    assert.equal(context.automations.get(monitor.id)?.enabled, true);
    assert.equal(starts, 2);
    context.store.deleteAutomation = deleteAutomation;
    await monitors.deleteMonitor(monitor.id);
    assert.equal(stops, 2);
  } finally { await monitors.stop(); context.close(); }
});

test('service stop attempts every subscription and retains a failed handle for retry', async () => {
  const context = monitorFixture();
  const attempts = new Map<string, number>();
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus,
    providers: [{
      sourceType: 'stock.quote', modes: ['subscribe'],
      async startMonitor({ sourceConfig }) {
        const symbol = String(sourceConfig.symbol);
        return {
          async stop() {
            const count = (attempts.get(symbol) || 0) + 1;
            attempts.set(symbol, count);
            if (symbol === 'AAPL' && count === 1) throw new Error('first stop rejected');
          },
        };
      },
    }],
  });
  try {
    for (const symbol of ['AAPL', 'MSFT']) {
      await monitors.createMonitor({
        workspaceId: 'workspace', title: symbol, sourceType: 'stock.quote', sourceConfig: { symbol },
        condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
      });
    }
    await monitors.stop();
    assert.deepEqual(Object.fromEntries(attempts), { AAPL: 1, MSFT: 1 });
    await monitors.stop();
    assert.deepEqual(Object.fromEntries(attempts), { AAPL: 2, MSFT: 1 });
  } finally { await monitors.stop(); context.close(); }
});

test('stop drains a blocked provider start and prevents stale handle or timer installation', async () => {
  const context = monitorFixture();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let stops = 0;
  let timers = 0;
  context.automations.createFromLegacy(monitorToAutomationInput({
    workspaceId: 'workspace', title: 'Quote', sourceType: 'stock.quote',
    condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    platform: 'local', route: { type: 'local.thread', channelId: 'workspace' },
  }));
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus,
    providers: [{ sourceType: 'stock.quote', modes: ['subscribe'], async startMonitor() {
      await blocked;
      return { async stop() { stops += 1; } };
    } }],
    setInterval() { timers += 1; return {} as NodeJS.Timeout; },
  });
  try {
    const starting = monitors.start();
    await new Promise((resolve) => setImmediate(resolve));
    const stopping = monitors.stop();
    release();
    await Promise.all([starting, stopping]);
    const internals = monitors as unknown as { timer: unknown; subscriptionHandles: Map<string, unknown> };
    assert.equal(timers, 0);
    assert.equal(stops, 1);
    assert.equal(internals.timer, null);
    assert.equal(internals.subscriptionHandles.size, 0);
    await monitors.stop();
    assert.equal(stops, 1);
  } finally { release(); await monitors.stop(); context.close(); }
});

test('start-stop-start prevents stale provider work from contaminating the new generation', async () => {
  const context = monitorFixture();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let starts = 0;
  let stops = 0;
  let timers = 0;
  context.automations.createFromLegacy(monitorToAutomationInput({
    workspaceId: 'workspace', title: 'Quote', sourceType: 'stock.quote',
    condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    platform: 'local', route: { type: 'local.thread', channelId: 'workspace' },
  }));
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus,
    providers: [{ sourceType: 'stock.quote', modes: ['subscribe'], async startMonitor() {
      starts += 1;
      if (starts === 1) await blocked;
      return { async stop() { stops += 1; } };
    } }],
    setInterval() { timers += 1; return {} as NodeJS.Timeout; }, clearInterval() {},
  });
  try {
    const firstStart = monitors.start();
    await new Promise((resolve) => setImmediate(resolve));
    const stopping = monitors.stop();
    const restarting = monitors.start();
    release();
    await Promise.all([firstStart, stopping, restarting]);
    const internals = monitors as unknown as { subscriptionHandles: Map<string, unknown> };
    assert.equal(starts, 2);
    assert.equal(stops, 1);
    assert.equal(timers, 1);
    assert.equal(internals.subscriptionHandles.size, 1);
    await monitors.stop();
    assert.equal(stops, 2);
  } finally { release(); await monitors.stop(); context.close(); }
});

test('stop drains a blocked poll and persists no evaluation or run after release', async () => {
  const context = monitorFixture();
  let release!: () => void;
  let started!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const pollStarted = new Promise<void>((resolve) => { started = resolve; });
  const monitor = context.automations.createFromLegacy(monitorToAutomationInput({
    workspaceId: 'workspace', title: 'Quote', sourceType: 'stock.quote',
    condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    platform: 'local', route: { type: 'local.thread', channelId: 'workspace' },
  }));
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus,
    providers: [{ sourceType: 'stock.quote', modes: ['poll'], async poll() {
      started(); await blocked; return event;
    } }],
  });
  try {
    const starting = monitors.start();
    await pollStarted;
    const stopping = monitors.stop();
    release();
    await Promise.all([starting, stopping]);
    assert.equal(context.automations.listEvaluations(monitor.id).length, 0);
    assert.equal(context.automations.listRuns(monitor.id).length, 0);
  } finally { release(); await monitors.stop(); context.close(); }
});

test('stop cancels a callback queued for a provider permit', async () => {
  const context = monitorFixture();
  let emit!: (snapshot: typeof event) => Promise<void> | void;
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus,
    providers: [{ sourceType: 'stock.quote', modes: ['subscribe'], async startMonitor(input) {
      emit = input.emit; return { stop() {} };
    } }],
  });
  try {
    const monitor = await monitors.createMonitor({
      workspaceId: 'workspace', title: 'Quote', sourceType: 'stock.quote',
      condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    });
    await monitors.start();
    const internals = monitors as unknown as { providerEventsInFlight: number };
    internals.providerEventsInFlight = 4;
    const queued = emit(event);
    await new Promise((resolve) => setImmediate(resolve));
    await monitors.stop();
    await queued;
    assert.equal(context.automations.listEvaluations(monitor.id).length, 0);
    assert.equal(context.automations.listRuns(monitor.id).length, 0);
  } finally { await monitors.stop(); context.close(); }
});

test('startup blocks a rejected subscription and the next timer tick retries it to healthy', async () => {
  const context = monitorFixture();
  let timerHandler: (() => void) | undefined;
  let starts = 0;
  let stops = 0;
  let emit!: (snapshot: typeof event) => Promise<void> | void;
  const definition = context.automations.createFromLegacy(monitorToAutomationInput({
    workspaceId: 'workspace', title: 'Quote', sourceType: 'stock.quote',
    condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    platform: 'local', route: { type: 'local.thread', channelId: 'workspace' },
  }));
  const options = {
    store: context.store, automations: context.automations, eventBus: context.eventBus,
    providers: [{
      sourceType: 'stock.quote', modes: ['subscribe'] as const,
      async startMonitor(input) {
        emit = input.emit;
        starts += 1;
        if (starts === 1) throw new Error('TOKEN=retry-secret\u001b[31m start rejected');
        return { async stop() { stops += 1; } };
      },
    }],
    setInterval(handler: () => void, delayMs: number) {
      assert.equal(delayMs, 30_000);
      timerHandler = handler;
      return {} as NodeJS.Timeout;
    },
    clearInterval() {},
  } as ConstructorParameters<typeof AutomationMonitorService>[0];
  const monitors = new AutomationMonitorService(options);
  try {
    await monitors.start();
    const blocked = context.automations.get(definition.id);
    assert.equal(blocked?.enabled, true);
    assert.equal(blocked?.health, 'blocked');
    assert.match(blocked?.blockedReason || '', /REDACTED_SECRET/);
    assert.doesNotMatch(blocked?.blockedReason || '', /retry-secret|\u001b/);
    assert.equal(starts, 1);
    await monitors.start();
    assert.equal(starts, 1);
    await emit(event);
    assert.equal(context.automations.listEvaluations(definition.id).length, 0);
    assert.ok(timerHandler);
    timerHandler();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    const recovered = context.automations.get(definition.id);
    assert.equal(recovered?.health, 'healthy');
    assert.equal(recovered?.blockedReason, undefined);
    assert.equal(starts, 2);
    await monitors.stop();
    assert.equal(stops, 1);
  } finally { await monitors.stop(); context.close(); }
});

test('repeated subscription start failures stay isolated while other monitors start', async () => {
  const context = monitorFixture();
  const definitions = ['bad', 'good'].map((kind) => context.automations.createFromLegacy(monitorToAutomationInput({
    workspaceId: 'workspace', title: kind, sourceType: 'stock.quote', sourceConfig: { kind },
    condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    platform: 'local', route: { type: 'local.thread', channelId: 'workspace' },
  })));
  let goodStops = 0;
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus,
    providers: [{
      sourceType: 'stock.quote', modes: ['subscribe'],
      async startMonitor({ sourceConfig }) {
        if (sourceConfig.kind === 'bad') throw new Error('API_KEY=provider-secret start rejected');
        return { async stop() { goodStops += 1; } };
      },
    }],
  });
  try {
    await monitors.start();
    const bad = context.automations.get(definitions[0]!.id);
    const good = context.automations.get(definitions[1]!.id);
    assert.equal(bad?.enabled, true);
    assert.equal(bad?.health, 'blocked');
    assert.match(bad?.blockedReason || '', /REDACTED_SECRET/);
    assert.doesNotMatch(bad?.blockedReason || '', /provider-secret/);
    assert.equal(good?.health, 'healthy');
    await monitors.stop();
    assert.equal(goodStops, 1);
  } finally { await monitors.stop(); context.close(); }
});

test('polling admits a later monitor while the first action is slow and isolates poll failures', async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let firstId = '';
  const context = monitorFixture(async (automationId) => { if (automationId === firstId) await blocked; });
  const logs: string[] = [];
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus, log: (message) => logs.push(message),
    providers: [{
      sourceType: 'stock.quote', modes: ['poll'],
      async poll({ sourceConfig }) {
        if (sourceConfig.fail) throw new Error('poll rejected');
        return { id: String(sourceConfig.id), sourceType: 'stock.quote', occurredAt: '2026-07-05T01:00:00.000Z', subject: 'quote', payload: { latestPrice: 2 } };
      },
    }],
  });
  try {
    const first = await monitors.createMonitor({
      workspaceId: 'workspace', title: 'first', sourceType: 'stock.quote', sourceConfig: { id: 'first' },
      condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    });
    firstId = first.id;
    await monitors.createMonitor({
      workspaceId: 'workspace', title: 'bad', sourceType: 'stock.quote', sourceConfig: { fail: true },
      condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    });
    const second = await monitors.createMonitor({
      workspaceId: 'workspace', title: 'second', sourceType: 'stock.quote', sourceConfig: { id: 'second' },
      condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    });
    const starting = monitors.start();
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(context.actions.includes(first.id));
    assert.ok(context.actions.includes(second.id));
    assert.ok(logs.some((message) => message.includes('poll rejected')));
    release();
    await starting;
  } finally { release(); await monitors.stop(); context.close(); }
});

test('provider callback fails closed after automation migration degrades', async () => {
  const context = monitorFixture();
  let emit!: (value: typeof event) => void | Promise<void>;
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus,
    providers: [{
      sourceType: 'stock.quote', modes: ['subscribe'],
      async startMonitor(input) { emit = input.emit; return { stop() {} }; },
    }],
  });
  try {
    const monitor = await monitors.createMonitor({
      workspaceId: 'workspace', title: 'quote', sourceType: 'stock.quote',
      condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    });
    context.store.importLegacyAutomations = () => { throw new Error('migration blocked'); };
    await context.automations.start();
    await emit(event);
    assert.equal(context.automations.listEvaluations(monitor.id).length, 0);
    assert.equal(context.actions.length, 0);
  } finally { await context.automations.stop(); await monitors.stop(); context.close(); }
});

test('poll returning null after migration degrades persists no compatibility evaluation', async () => {
  const context = monitorFixture();
  let releasePoll!: () => void;
  const pollBlocked = new Promise<void>((resolve) => { releasePoll = resolve; });
  const compatibilityRuns: string[] = [];
  context.eventBus.on('automation.monitor.run.updated', (run) => compatibilityRuns.push(run.id));
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus,
    providers: [{
      sourceType: 'stock.quote', modes: ['poll'],
      async poll() { await pollBlocked; return null; },
    }],
  });
  try {
    const monitor = await monitors.createMonitor({
      workspaceId: 'workspace', title: 'Quote', sourceType: 'stock.quote',
      condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    });
    const polling = monitors.runMonitorNow(monitor.id);
    await new Promise((resolve) => setImmediate(resolve));
    context.store.importLegacyAutomations = () => { throw new Error('migration blocked'); };
    await context.automations.start();
    releasePoll();
    await assert.rejects(() => polling, /Unified automation migration is unavailable/);
    assert.equal(context.automations.listEvaluations(monitor.id).length, 0);
    assert.equal(context.automations.listRuns(monitor.id).length, 0);
    assert.deepEqual(compatibilityRuns, []);
  } finally {
    releasePoll();
    await context.automations.stop();
    await monitors.stop();
    context.close();
  }
});

test('poll returning an event after migration degrades persists no evaluation or run', async () => {
  const context = monitorFixture();
  let releasePoll!: () => void;
  const pollBlocked = new Promise<void>((resolve) => { releasePoll = resolve; });
  const compatibilityRuns: string[] = [];
  context.eventBus.on('automation.monitor.run.updated', (run) => compatibilityRuns.push(run.id));
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus,
    providers: [{
      sourceType: 'stock.quote', modes: ['poll'],
      async poll() { await pollBlocked; return event; },
    }],
  });
  try {
    const monitor = await monitors.createMonitor({
      workspaceId: 'workspace', title: 'Quote', sourceType: 'stock.quote',
      condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    });
    const polling = monitors.runMonitorNow(monitor.id);
    await new Promise((resolve) => setImmediate(resolve));
    context.store.importLegacyAutomations = () => { throw new Error('migration blocked'); };
    await context.automations.start();
    releasePoll();
    await assert.rejects(() => polling, /Unified automation migration is unavailable/);
    assert.equal(context.automations.listEvaluations(monitor.id).length, 0);
    assert.equal(context.automations.listRuns(monitor.id).length, 0);
    assert.deepEqual(compatibilityRuns, []);
  } finally {
    releasePoll();
    await context.automations.stop();
    await monitors.stop();
    context.close();
  }
});

test('old subscription callbacks are ignored after source reconfiguration', async () => {
  const context = monitorFixture();
  const emits: Array<(snapshot: typeof event) => Promise<void> | void> = [];
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus,
    providers: [{ sourceType: 'stock.quote', modes: ['subscribe'], async startMonitor(input) {
      emits.push(input.emit); return { stop() {} };
    } }],
  });
  try {
    const monitor = await monitors.createMonitor({
      workspaceId: 'workspace', title: 'Quote', sourceType: 'stock.quote', sourceConfig: { symbol: 'AAPL' },
      condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    });
    await monitors.updateMonitor(monitor.id, { sourceConfig: { symbol: 'MSFT' } });
    await monitors.start();
    await emits[0]!(event);
    assert.equal(context.automations.listEvaluations(monitor.id).length, 0);
    await emits[1]!(event);
    assert.equal(context.automations.listEvaluations(monitor.id).length, 1);
  } finally { await monitors.stop(); context.close(); }
});

test('queued subscription event is ignored after the monitor is disabled', async () => {
  const context = monitorFixture();
  let emit!: (snapshot: typeof event) => Promise<void> | void;
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus,
    providers: [{ sourceType: 'stock.quote', modes: ['subscribe'], async startMonitor(input) {
      emit = input.emit; return { stop() {} };
    } }],
  });
  try {
    const monitor = await monitors.createMonitor({
      workspaceId: 'workspace', title: 'Quote', sourceType: 'stock.quote',
      condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    });
    const internals = monitors as unknown as { providerEventsInFlight: number; releaseProviderEventPermit(): void };
    internals.providerEventsInFlight = 4;
    const queued = emit(event);
    await new Promise((resolve) => setImmediate(resolve));
    await monitors.updateMonitor(monitor.id, { enabled: false });
    internals.releaseProviderEventPermit();
    await queued;
    assert.equal(context.automations.listEvaluations(monitor.id).length, 0);
  } finally { await monitors.stop(); context.close(); }
});

test('queued subscription events are ignored after reconfiguration or deletion', async () => {
  for (const transition of ['reconfigure', 'delete'] as const) {
    const context = monitorFixture();
    let emit!: (snapshot: typeof event) => Promise<void> | void;
    const monitors = new AutomationMonitorService({
      store: context.store, automations: context.automations, eventBus: context.eventBus,
      providers: [{ sourceType: 'stock.quote', modes: ['subscribe'], async startMonitor(input) {
        emit ||= input.emit;
        return { stop() {} };
      } }],
    });
    try {
      const monitor = await monitors.createMonitor({
        workspaceId: 'workspace', title: 'Quote', sourceType: 'stock.quote', sourceConfig: { symbol: 'AAPL' },
        condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
      });
      const internals = monitors as unknown as { providerEventsInFlight: number; releaseProviderEventPermit(): void };
      internals.providerEventsInFlight = 4;
      const queued = emit(event);
      await new Promise((resolve) => setImmediate(resolve));
      if (transition === 'reconfigure') {
        await monitors.updateMonitor(monitor.id, { sourceConfig: { symbol: 'MSFT' } });
      } else {
        await monitors.deleteMonitor(monitor.id);
      }
      internals.releaseProviderEventPermit();
      await queued;
      assert.equal(context.automations.listEvaluations(monitor.id).length, 0);
    } finally { await monitors.stop(); context.close(); }
  }
});

test('poll result is ignored when source config changes while polling', async () => {
  const context = monitorFixture();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus,
    providers: [{ sourceType: 'stock.quote', modes: ['poll'], async poll() { await blocked; return event; } }],
  });
  try {
    const monitor = await monitors.createMonitor({
      workspaceId: 'workspace', title: 'Quote', sourceType: 'stock.quote', sourceConfig: { symbol: 'AAPL' },
      condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    });
    const polling = monitors.runMonitorNow(monitor.id);
    await new Promise((resolve) => setImmediate(resolve));
    await monitors.updateMonitor(monitor.id, { sourceConfig: { symbol: 'MSFT' } });
    release();
    await assert.rejects(() => polling, /changed while provider polling/);
    assert.equal(context.automations.listEvaluations(monitor.id).length, 0);
  } finally { release(); await monitors.stop(); context.close(); }
});

test('queued automatic poll is ignored after disable once it receives a global permit', async () => {
  const context = monitorFixture();
  let polled!: () => void;
  const pollStarted = new Promise<void>((resolve) => { polled = resolve; });
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus,
    providers: [{ sourceType: 'stock.quote', modes: ['poll'], async poll() { polled(); return event; } }],
  });
  try {
    const monitor = await monitors.createMonitor({
      workspaceId: 'workspace', title: 'Quote', sourceType: 'stock.quote',
      condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    });
    const internals = monitors as unknown as {
      providerEventsInFlight: number;
      releaseProviderEventPermit(): void;
      tick(refreshSubscriptions?: boolean): Promise<void>;
    };
    internals.providerEventsInFlight = 4;
    const ticking = internals.tick(false);
    await pollStarted;
    await new Promise((resolve) => setImmediate(resolve));
    await monitors.updateMonitor(monitor.id, { enabled: false });
    internals.releaseProviderEventPermit();
    await ticking;
    assert.equal(context.automations.listEvaluations(monitor.id).length, 0);
  } finally { await monitors.stop(); context.close(); }
});

test('manual polling remains available while a monitor is disabled', async () => {
  const context = monitorFixture();
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus,
    providers: [{ sourceType: 'stock.quote', modes: ['poll'], async poll() { return event; } }],
  });
  try {
    const monitor = await monitors.createMonitor({
      workspaceId: 'workspace', title: 'Quote', sourceType: 'stock.quote', enabled: false,
      condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    });
    const run = await monitors.runMonitorNow(monitor.id);
    assert.equal(run.status, 'succeeded');
    assert.equal(context.automations.listEvaluations(monitor.id).length, 1);
  } finally { await monitors.stop(); context.close(); }
});

test('provider snapshots are fully validated before evaluation persistence', async () => {
  const context = monitorFixture();
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus, providers: [],
  });
  try {
    const monitor = await monitors.createMonitor({
      workspaceId: 'workspace', title: 'Quote', sourceType: 'stock.quote',
      condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    });
    let compatibilityEvents = 0;
    context.eventBus.on('automation.evaluation.updated', () => { compatibilityEvents += 1; });
    context.eventBus.on('automation.monitor.run.updated', () => { compatibilityEvents += 1; });
    context.eventBus.on('automation.run.updated', () => { compatibilityEvents += 1; });
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const cyclicSnapshot = { ...event, payload: cycle };
    const symbolPayload = { latestPrice: 188 } as Record<PropertyKey, unknown>;
    symbolPayload[Symbol('hidden')] = true;
    let accessorReads = 0;
    const accessorPayload = Object.defineProperty({}, 'latestPrice', {
      enumerable: true,
      get() { accessorReads += 1; return 188; },
    });
    let tooDeep: Record<string, unknown> = {};
    for (let depth = 0; depth < 66; depth += 1) tooDeep = { nested: tooDeep };
    class ProviderValue { value = 1; }
    const malformed = [
      null,
      [],
      Object.assign(Object.create({ inherited: true }), event),
      (({ id: _id, ...rest }) => rest)(event),
      (({ sourceType: _sourceType, ...rest }) => rest)(event),
      (({ subject: _subject, ...rest }) => rest)(event),
      { ...event, id: '' },
      { ...event, id: '   ' },
      { ...event, sourceType: '   ' },
      { ...event, subject: '   ' },
      { ...event, subject: 1 },
      { ...event, summary: 1 },
      { ...event, summary: null },
      { ...event, payload: null },
      { ...event, payload: [] },
      { ...event, payload: new Date() },
      { ...event, payload: { value: 1n } },
      { ...event, payload: { value: undefined } },
      { ...event, payload: { value: () => true } },
      { ...event, payload: { value: Symbol('nested') } },
      { ...event, payload: { value: Number.NaN } },
      { ...event, payload: { value: Number.POSITIVE_INFINITY } },
      { ...event, payload: { nested: new Map() } },
      { ...event, payload: { nested: new Set() } },
      { ...event, payload: { nested: new ProviderValue() } },
      cyclicSnapshot,
      { ...event, payload: tooDeep },
      { ...event, payload: symbolPayload },
      { ...event, payload: accessorPayload },
      { ...event, occurredAt: '2026-01-01T00:00:00' },
      { ...event, occurredAt: '2026-13-01T00:00:00Z' },
      { ...event, occurredAt: '2026-02-30T00:00:00Z' },
      { ...event, occurredAt: '2026-01-01T24:00:00Z' },
      { ...event, occurredAt: '2026-01-01T00:60:00Z' },
      { ...event, occurredAt: '2026-01-01T00:00:60Z' },
      { ...event, occurredAt: '2026-01-01T00:00:00+24:00' },
      { ...event, sourceType: 'weather.alert' },
      { ...event, subject: 'x'.repeat(100_001) },
      { ...event, summary: 'x'.repeat(100_001) },
    ];
    for (const [index, snapshot] of malformed.entries()) {
      await assert.rejects(() => monitors.runMonitorNow(monitor.id, snapshot as never), (error) => {
        if (snapshot === cyclicSnapshot) {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(message, /^Invalid provider event payload: .*cycle/);
          assert.ok(message.length <= 2_000);
          assert.doesNotMatch(message, /[\u0000-\u001f\u007f-\u009f]/);
        }
        return true;
      }, `malformed snapshot ${index}`);
    }
    assert.equal(context.automations.listEvaluations(monitor.id).length, 0);
    assert.equal(context.automations.listRuns(monitor.id).length, 0);
    assert.equal(compatibilityEvents, 0);
    assert.equal(accessorReads, 0);
  } finally { await monitors.stop(); context.close(); }
});

test('provider snapshot payload is detached at call time and preserves valid nested JSON data', async () => {
  const context = monitorFixture();
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus, providers: [],
  });
  try {
    const monitor = await monitors.createMonitor({
      workspaceId: 'workspace', title: 'Quote', sourceType: 'stock.quote',
      condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'quote',
    });
    const payload = {
      latestPrice: 188,
      nested: { label: 'original', values: [true, null, { count: 2 }] },
    };
    const evaluating = monitors.runMonitorNow(monitor.id, { ...event, payload });
    payload.nested.label = 'mutated';
    payload.nested.values[2] = { count: 99 };
    await evaluating;
    const evaluation = context.automations.getLatestEvaluationWithState(monitor.id);
    assert.equal(evaluation?.status, 'finished');
    if (!evaluation || evaluation.status !== 'finished') throw new Error('Expected a finished evaluation');
    assert.deepEqual(evaluation.nextState?.payload, {
      latestPrice: 188,
      nested: { label: 'original', values: [true, null, { count: 2 }] },
    });
    assert.deepEqual(evaluation.payload?.eventSnapshot, {
      ...event,
      payload: {
        latestPrice: 188,
        nested: { label: 'original', values: [true, null, { count: 2 }] },
      },
    });
  } finally { await monitors.stop(); context.close(); }
});

test('unified monitor evaluation preserves nested legacy metrics and trusted state checkpoints', async () => {
  const context = monitorFixture();
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, eventBus: context.eventBus, providers: [],
  });
  try {
    const monitor = await monitors.createMonitor({
      workspaceId: 'workspace', title: 'Nested', sourceType: 'stock.quote',
      condition: {
        metric: 'expression', operator: '==', value: true,
        expression: 'subject == AAPL && sourceType == stock.quote && subject.market == NASDAQ && sourceType.vendor == IEX',
      },
      promptTemplate: 'quote',
    });
    await monitors.runMonitorNow(monitor.id, {
      id: 'trusted-id', sourceType: 'stock.quote', occurredAt: '2026-07-05T09:00:00+08:00', subject: 'AAPL',
      payload: {
        subject: { market: 'NASDAQ' }, sourceType: { vendor: 'IEX' },
        lastEventId: 'spoofed', lastEventAt: 'spoofed', payload: { spoofed: true },
      },
    });
    const evaluation = context.automations.getLatestEvaluationWithState(monitor.id);
    assert.equal(evaluation?.conditionOutcome, 'matched');
    assert.equal(evaluation?.nextState?.lastEventId, 'trusted-id');
    assert.equal(evaluation?.nextState?.lastEventAt, '2026-07-05T01:00:00.000Z');
    assert.deepEqual(evaluation?.nextState?.payload, {
      subject: { market: 'NASDAQ' }, sourceType: { vendor: 'IEX' },
      lastEventId: 'spoofed', lastEventAt: 'spoofed', payload: { spoofed: true },
    });
  } finally { await monitors.stop(); context.close(); }
});
