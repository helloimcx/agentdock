import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { parseLocalAiCoreRoute } from '../../services/local-ai-core/src/runtime/server-routes.js';
import { registerUnifiedAutomationHandlers } from '../../services/local-ai-core/src/runtime/handlers/automations-handler.js';

test('unified automation routes are explicit and do not overlap legacy monitor routes', () => {
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/automations'), { name: 'automations.list' });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/automations'), { name: 'automations.create' });
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/automations/automation%2Fone'), {
    name: 'automation.get', automationId: 'automation/one',
  });
  assert.deepEqual(parseLocalAiCoreRoute('PATCH', '/api/local/v1/automations/automation-1'), {
    name: 'automation.update', automationId: 'automation-1',
  });
  assert.deepEqual(parseLocalAiCoreRoute('DELETE', '/api/local/v1/automations/automation-1'), {
    name: 'automation.delete', automationId: 'automation-1',
  });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/automations/automation-1/check'), {
    name: 'automation.check', automationId: 'automation-1',
  });
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/automations/automation-1/evaluations'), {
    name: 'automation.evaluations', automationId: 'automation-1',
  });
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/automations/automation-1/runs'), {
    name: 'automation.runs', automationId: 'automation-1',
  });
  assert.equal(parseLocalAiCoreRoute('GET', '/api/local/v1/automations/automation-1/check'), null);
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/automation/monitors'), { name: 'automation.monitors.list' });
});

test('unified script routes expose only lifecycle transitions', () => {
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/automation-scripts'), { name: 'automation-scripts.list' });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/automation-scripts'), { name: 'automation-scripts.create' });
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/automation-scripts/script-1/versions'), {
    name: 'automation-script.versions', scriptId: 'script-1',
  });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/automation-scripts/script-1/versions'), {
    name: 'automation-script.version.submit', scriptId: 'script-1',
  });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/automation-scripts/versions/version-1/test-approval'), {
    name: 'automation-script-version.test-approval', versionId: 'version-1',
  });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/automation-scripts/versions/version-1/test'), {
    name: 'automation-script-version.test', versionId: 'version-1',
  });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/automation-scripts/versions/version-1/enable-approval'), {
    name: 'automation-script-version.enable-approval', versionId: 'version-1',
  });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/automation-scripts/versions/version-1/approve'), {
    name: 'automation-script-version.approve', versionId: 'version-1',
  });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/automation-scripts/versions/version-1/reject'), {
    name: 'automation-script-version.reject', versionId: 'version-1',
  });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/automation-scripts/versions/version-1/revoke'), {
    name: 'automation-script-version.revoke', versionId: 'version-1',
  });
  assert.equal(parseLocalAiCoreRoute('POST', '/api/local/v1/automation-scripts/versions/version-1/stage'), null);
  assert.equal(parseLocalAiCoreRoute('POST', '/api/local/v1/automation-scripts/versions/version-1/approve/extra'), null);
});

test('unified handlers enforce workspace ownership and reject server-owned fields', async () => {
  const map = new Map<string, any>();
  registerUnifiedAutomationHandlers(map, {
    automations: {
      get: () => ({ id: 'automation-1', workspaceId: 'workspace-a' }),
      create: () => { throw new Error('must not create'); },
    },
    store: { getAutomationScript: () => ({ id: 'script-1', workspaceId: 'workspace-a' }) },
  } as any);

  await assert.rejects(
    map.get('automation.get')(
      { name: 'automation.get', automationId: 'automation-1' },
      Readable.from([]), response(), new URL('http://127.0.0.1/automations/automation-1?workspace_id=workspace-b'),
    ),
    /not found in this workspace/,
  );
  await assert.rejects(
    map.get('automations.create')(
      { name: 'automations.create' },
      requestBody({
        workspaceId: 'workspace-a', title: 'Automation', enabled: true,
        activation: { kind: 'interval', intervalMs: 1000 }, condition: { kind: 'always' },
        action: { kind: 'agent-prompt', promptTemplate: 'hello', executionMode: 'same-thread' },
        delivery: { platform: 'lark', route: { type: 'group', channelId: 'channel-1' } },
        policies: { concurrency: 'skip-if-running', cooldownMs: 0 }, health: 'healthy',
      }),
      response(), new URL('http://127.0.0.1/automations'),
    ),
    /health is not writable/,
  );
  await assert.rejects(
    map.get('automation-scripts.create')(
      { name: 'automation-scripts.create' },
      requestBody({ workspaceId: 'workspace-a', title: 'Script', packagePath: '/tmp/attacker-controlled' }),
      response(), new URL('http://127.0.0.1/automation-scripts'),
    ),
    /packagePath is not writable/,
  );
  await assert.rejects(
    map.get('automation-script.version.submit')(
      { name: 'automation-script.version.submit', scriptId: 'script-1' },
      requestBody({ files: [], sourceDir: '/tmp/attacker-controlled' }), response(),
      new URL('http://127.0.0.1/automation-scripts/script-1/versions?workspace_id=workspace-a'),
    ),
    /sourceDir is not writable/,
  );
});

test('script approval lifecycle selects the transition from the server-owned version state', async () => {
  const calls: string[] = [];
  let status = 'pending_test_approval';
  const version = () => ({ id: 'version-1', scriptId: 'script-1', status });
  const map = new Map<string, any>();
  registerUnifiedAutomationHandlers(map, {
    automations: {},
    store: {
      getAutomationScriptVersion: () => version(),
      getAutomationScript: () => ({ id: 'script-1', workspaceId: 'workspace-a' }),
      getApprovalRequest: (approvalId: string) => ({ approvalId, status: approvalId === 'approval-test' ? 'approved' : 'rejected' }),
      authorizeAutomationScriptTest: () => {
        calls.push('authorize-test');
        return version();
      },
      approveAutomationScriptVersion: () => {
        calls.push('approve-enable');
        return version();
      },
    },
  } as any);

  await map.get('automation-script-version.approve')(
    { name: 'automation-script-version.approve', versionId: 'version-1' },
    requestBody({ approvalId: 'approval-test', actor: 'user' }), response(),
    new URL('http://127.0.0.1/automation-scripts/versions/version-1/approve?workspace_id=workspace-a'),
  );
  status = 'pending_approval';
  await map.get('automation-script-version.reject')(
    { name: 'automation-script-version.reject', versionId: 'version-1' },
    requestBody({ approvalId: 'approval-enable', actor: 'user' }), response(),
    new URL('http://127.0.0.1/automation-scripts/versions/version-1/reject?workspace_id=workspace-a'),
  );

  assert.deepEqual(calls, ['authorize-test', 'approve-enable']);
  status = 'pending_test_approval';
  await assert.rejects(
    map.get('automation-script-version.reject')(
      { name: 'automation-script-version.reject', versionId: 'version-1' },
      requestBody({ approvalId: 'approval-test', actor: 'user' }), response(),
      new URL('http://127.0.0.1/automation-scripts/versions/version-1/reject?workspace_id=workspace-a'),
    ),
    /requires a rejected approval decision/,
  );
  assert.deepEqual(calls, ['authorize-test', 'approve-enable']);
});

test('script test execution accepts only an actor and persists the server-produced report', async () => {
  const reports: unknown[] = [];
  const version = { id: 'version-1', scriptId: 'script-1', status: 'test_authorized' };
  const map = new Map<string, any>();
  registerUnifiedAutomationHandlers(map, {
    automations: {},
    store: {
      getAutomationScriptVersion: () => version,
      getAutomationScript: () => ({ id: 'script-1', workspaceId: 'workspace-a' }),
      claimAutomationScriptTestExecution: () => ({ ...version, status: 'testing' }),
      recordAutomationScriptTestResult: (_versionId: string, report: unknown) => {
        reports.push(report);
        return { ...version, status: 'tested' };
      },
    },
    executeScriptTest: async () => ({ status: 'passed', finishedAt: '2026-07-12T00:00:00.000Z', summary: 'server test' }),
  } as any);

  await map.get('automation-script-version.test')(
    { name: 'automation-script-version.test', versionId: 'version-1' },
    requestBody({ actor: 'user' }), response(),
    new URL('http://127.0.0.1/automation-scripts/versions/version-1/test?workspace_id=workspace-a'),
  );
  assert.deepEqual(reports, [{ status: 'passed', finishedAt: '2026-07-12T00:00:00.000Z', summary: 'server test' }]);
  await assert.rejects(
    map.get('automation-script-version.test')(
      { name: 'automation-script-version.test', versionId: 'version-1' },
      requestBody({ actor: 'user', testReport: { status: 'passed' } }), response(),
      new URL('http://127.0.0.1/automation-scripts/versions/version-1/test?workspace_id=workspace-a'),
    ),
    /testReport is not writable/,
  );
});

test('only one concurrent request can claim a one-shot script test before sandbox execution', async () => {
  let status = 'test_authorized';
  let resolveExecution!: () => void;
  const execution = new Promise<void>((resolve) => { resolveExecution = resolve; });
  let executions = 0;
  const version = () => ({ id: 'version-1', scriptId: 'script-1', status });
  const map = new Map<string, any>();
  registerUnifiedAutomationHandlers(map, {
    automations: {},
    store: {
      getAutomationScriptVersion: () => version(),
      getAutomationScript: () => ({ id: 'script-1', workspaceId: 'workspace-a' }),
      claimAutomationScriptTestExecution: () => {
        if (status !== 'test_authorized') throw new Error(`claim requires test_authorized, got ${status}`);
        status = 'testing';
        return version();
      },
      recordAutomationScriptTestResult: () => ({ ...version(), status: 'tested' }),
    },
    executeScriptTest: async () => {
      executions += 1;
      await execution;
      return { status: 'passed', finishedAt: '2026-07-12T00:00:00.000Z' };
    },
  } as any);
  const route = { name: 'automation-script-version.test', versionId: 'version-1' };
  const url = new URL('http://127.0.0.1/automation-scripts/versions/version-1/test?workspace_id=workspace-a');
  const first = map.get('automation-script-version.test')(route, requestBody({ actor: 'user' }), response(), url);
  await Promise.resolve();
  await assert.rejects(
    map.get('automation-script-version.test')(route, requestBody({ actor: 'user' }), response(), url),
    /test_authorized/,
  );
  assert.equal(executions, 1);
  resolveExecution();
  await first;
});

function requestBody(value: unknown) {
  return Readable.from([Buffer.from(JSON.stringify(value))]);
}

function response() {
  return {
    setHeader() {},
    end() {},
  };
}
