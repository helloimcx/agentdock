import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentLaunchConfig } from '@cc/plugin-sdk';
import { RemoteMeshScreenSessionManager } from '../../services/local-ai-core/src/execution/remote-mesh/screen-session-manager.js';

const owner = 'run:agentdock::9bdfe3c2-1d4d-46ae-a919-468b36ed06cb:1791100000000';
const config = { execution: { mode: 'mesh', nodeId: 'node:33a5bb40-14b4-4fb9-8e54-5102cad7936c', node: { platform: 'android' } } } as AgentLaunchConfig;
const response = (action: string, ownerId = owner) => ({ status: 'completed', result: { exitCode: 0, stdout: JSON.stringify({ ok: true, interactive: true, locked: false, keepAwake: action !== 'release', ownerRemainingMs: action === 'release' ? 0 : 120000, owner: ownerId, cliProtocol: 2, screenProtocol: 2 }) } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('run start acquires its owner and completion releases it', async () => {
  const calls: string[][] = [];
  const manager = new RemoteMeshScreenSessionManager({ onFailure: () => assert.fail(), execute: async input => {
    const args = input.args.arguments as string[];
    calls.push(args);
    assert.equal(input.nodeId, config.execution!.nodeId);
    const runOwner = args.find(arg => arg.startsWith('--owner='))?.slice(8) || owner;
    return response(args[1], runOwner);
  } });
  assert.equal(await manager.begin(owner, config), true);
  await manager.stop(owner);
  assert.deepEqual(calls.map(args => args[1]), ['status', 'keep-awake', 'release']);
  assert.ok(calls.every(args => args.includes(`--owner=${owner}`)));
  assert.ok(calls.slice(1).every(args => args.includes('--duration=120')));
});

test('cancellation waits for in-flight acquire then releases and never renews', async () => {
  const acquire = deferred<unknown>();
  const acquiring = deferred<void>();
  const calls: string[] = [];
  const manager = new RemoteMeshScreenSessionManager({ heartbeatMs: 1, onFailure: () => assert.fail(), execute: async input => {
    const action = (input.args.arguments as string[])[1]; calls.push(action);
    if (action === 'keep-awake') { acquiring.resolve(); return acquire.promise; }
    return response(action);
  } });
  const started = manager.begin(owner, config);
  await acquiring.promise;
  const stopped = manager.stop(owner);
  assert.deepEqual(calls, ['status', 'keep-awake']);
  acquire.resolve(response('keep-awake'));
  assert.equal(await started, false);
  await stopped;
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(calls, ['status', 'keep-awake', 'release']);
});

test('heartbeat is serialized and stop waits for renewal before release', async () => {
  const renewing = deferred<void>();
  const renew = deferred<unknown>();
  const calls: string[] = [];
  const manager = new RemoteMeshScreenSessionManager({ heartbeatMs: 1, onFailure: () => assert.fail(), execute: async input => {
    const action = (input.args.arguments as string[])[1]; calls.push(action);
    if (action === 'renew') { renewing.resolve(); return renew.promise; }
    return response(action);
  } });
  await manager.begin(owner, config);
  // Keep the test alive even though the production heartbeat is unref'ed.
  const deadline = setTimeout(() => renewing.resolve(), 200);
  await renewing.promise;
  await new Promise(resolve => setTimeout(resolve, 5));
  const stopped = manager.stop(owner);
  assert.deepEqual(calls, ['status', 'keep-awake', 'renew']);
  renew.resolve(response('renew'));
  await stopped;
  clearTimeout(deadline);
  assert.deepEqual(calls, ['status', 'keep-awake', 'renew', 'release']);
});

test('lost heartbeat stops instead of reacquiring and reports owning run', async () => {
  const failed = deferred<string>();
  const calls: string[] = [];
  const manager = new RemoteMeshScreenSessionManager({ heartbeatMs: 1, onFailure: runId => failed.resolve(runId), execute: async input => {
    const action = (input.args.arguments as string[])[1]; calls.push(action);
    if (action === 'renew') throw new Error('Device disconnected');
    return response(action);
  } });
  await manager.begin(owner, config);
  const deadline = setTimeout(() => failed.resolve('timeout'), 200);
  assert.equal(await failed.promise, owner);
  await manager.stop(owner);
  clearTimeout(deadline);
  assert.deepEqual(calls, ['status', 'keep-awake', 'renew', 'release']);
});

test('only an explicit legacy HTTP 404 degrades; other failed starts are cleaned up', async () => {
  const logs: string[] = [];
  const old = new RemoteMeshScreenSessionManager({ onFailure: () => assert.fail(), log: value => logs.push(value), execute: async () => { throw new Error('HTTP 404 Not Found'); } });
  assert.equal(await old.begin(owner, config), true);
  await old.close();
  assert.match(logs[0], /Legacy bridge/);
  const calls: string[] = [];
  const manager = new RemoteMeshScreenSessionManager({ onFailure: () => assert.fail(), execute: async input => {
    const action = (input.args.arguments as string[])[1]; calls.push(action);
    if (action === 'keep-awake') throw new Error('USER_UNLOCK_REQUIRED');
    return response(action);
  } });
  await assert.rejects(manager.begin(owner, config), /USER_UNLOCK_REQUIRED/);
  await manager.stop(owner);
  assert.deepEqual(calls, ['status', 'keep-awake', 'release']);
});

test('close clears every run owner while non-Android runs never call mesh', async () => {
  const calls: string[][] = [];
  const manager = new RemoteMeshScreenSessionManager({ onFailure: () => assert.fail(), execute: async input => {
    const args = input.args.arguments as string[]; calls.push(args); const runOwner = args.find(arg => arg.startsWith('--owner='))?.slice(8) || owner; return response(args[1], runOwner);
  } });
  await manager.begin(owner, { execution: { ...config.execution!, node: { platform: 'linux' } } } as AgentLaunchConfig);
  assert.equal(calls.length, 0);
  await manager.begin(owner, config);
  await manager.begin(`${owner}:second`, config);
  await manager.close();
  assert.equal(calls.filter(args => args[1] === 'release').length, 2);
});

test('invalid bridge responses and failed execution statuses cannot keep a run alive', async () => {
  for (const value of [ { status: 'interrupted', error: 'Device disconnected' }, { status: 'completed', result: { exitCode: 0, stdout: '{}' } }, { status: 'completed', result: { exitCode: 0, stdout: 'invalid' } } ]) {
    const manager = new RemoteMeshScreenSessionManager({ onFailure: () => assert.fail(), execute: async () => value });
    await assert.rejects(manager.begin(owner, config));
    await manager.stop(owner);
  }
});

import { LocalCoreAcpSessionCoordinator } from '../../services/local-ai-core/src/acp/local-core-acp-session-coordinator.js';
import { LocalCoreAcpBackend } from '../../services/local-ai-core/src/acp/local-core-acp-backend.js';

test('ACP cancellation marks screen stopped even before an agent session exists', async () => {
  const stopped: string[] = [];
  const coordinator = new LocalCoreAcpSessionCoordinator({
    runThreadMap: new Map([[owner, 'thread:workspace::41d4b48d-ff0c-4d9d-918d-44129d221a73']]),
    store: { getRun: () => ({ status: 'running' }), updateRun: () => {}, getAgentTaskByRunId: () => null } as any,
    transport: {} as any, emitBridge: () => {}, onRunStopped: runId => stopped.push(runId),
  });
  await coordinator.interruptRun(owner);
  assert.deepEqual(stopped, [owner]);
});

test('ACP session replacement and shutdown stop active run screen ownership', () => {
  const stopped: string[] = [];
  const coordinator = new LocalCoreAcpSessionCoordinator({
    runThreadMap: new Map(), store: {} as any,
    transport: { closeSession: () => {} } as any,
    emitBridge: () => {}, onRunStopped: runId => stopped.push(runId),
  });
  const state = coordinator as any;
  state.sessions.set('thread:workspace::41d4b48d-ff0c-4d9d-918d-44129d221a73', { currentRunId: owner });
  coordinator.closeThreadSession('thread:workspace::41d4b48d-ff0c-4d9d-918d-44129d221a73');
  state.sessions.set('thread:workspace::6bdefdb0-1b92-4d39-a7c7-e99dbaaf1629', { currentRunId: `${owner}:second` });
  coordinator.closeAll();
  assert.deepEqual(stopped, [owner, `${owner}:second`]);
});

test('backend cancellation finishes by releasing the screen owner', async () => {
  const order: string[] = [];
  const backend = Object.create(LocalCoreAcpBackend.prototype) as any;
  // interruptRun consults the submission store first; no submission owns this runId,
  // so cancellation must fall through to the ACP session coordinator and release the screen.
  backend.options = { store: { submissions: { byRun: () => undefined } } };
  backend.sessionCoordinator = { interruptRun: async () => { order.push('cancel'); return { interrupted: true }; } };
  backend.screenSessions = { stop: async (runId: string) => { assert.equal(runId, owner); order.push('release'); } };
  assert.deepEqual(await backend.interruptRun(owner), { interrupted: true });
  assert.deepEqual(order, ['cancel', 'release']);
});


test('owned protocol preflight rejects old CLI or APK before acquiring any shared hold', async () => {
  for (const legacyResponse of [
    { ok: true, cliProtocol: 2, screenProtocol: 1, owner: 'manual', interactive: true, locked: false },
    { ok: true, screenProtocol: 2, owner: owner, interactive: true, locked: false },
  ]) {
    const calls: string[] = [];
    const manager = new RemoteMeshScreenSessionManager({ onFailure: () => assert.fail(), execute: async input => {
      calls.push((input.args.arguments as string[])[1]);
      return { status: 'completed', result: { exitCode: 0, stdout: JSON.stringify(legacyResponse) } };
    } });
    await assert.rejects(manager.begin(owner, config), /OWNED_SCREEN_PROTOCOL_REQUIRED/);
    assert.deepEqual(calls, ['status']);
  }
});


test('cancel or close during owned-protocol preflight cannot start or release a hold', async () => {
  for (const stopKind of ['stop', 'close'] as const) {
    const status = deferred<unknown>();
    const checking = deferred<void>();
    const calls: string[] = [];
    const manager = new RemoteMeshScreenSessionManager({ onFailure: () => assert.fail(), execute: async input => {
      const action = (input.args.arguments as string[])[1]; calls.push(action); checking.resolve();
      return status.promise;
    } });
    const started = manager.begin(owner, config);
    await checking.promise;
    const stopped = stopKind === 'stop' ? manager.stop(owner) : manager.close();
    status.resolve(response('status'));
    assert.equal(await started, false);
    await stopped;
    assert.deepEqual(calls, ['status']);
  }
});
