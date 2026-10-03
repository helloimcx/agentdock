import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DesktopConnectConfig } from '@cc/superai-contracts';
import { LocalCoreAcpStore } from '../../services/local-ai-core/src/acp/store/local-core-acp-store.js';
import { ExternalService } from '../../services/local-ai-core/src/runtime/external-service.js';

const USER_ID = 'user-alice-2f1a';
const PROJECT_ID = 'proj-demo-9c4e';
const RUN_ID = 'run:agentdock::d41b7c2e-8a35-4f19-9c6d-3e7a1b5f0c88:1790900000000';

function createHarness() {
  const dir = mkdtempSync(join(tmpdir(), 'external-run-config-'));
  const store = new LocalCoreAcpStore(dir);
  store.upsertModelProvider({
    id: 'provider-default',
    name: 'Default Provider',
    base_url: 'https://default.ai/v1',
    api_key: 'key-1',
  });
  const calls = { readRuntimeConfig: 0, saveRuntimeConfig: 0 };
  const deps = {
    readRuntimeConfig: async () => {
      calls.readRuntimeConfig += 1;
      return store.readRuntimeConfig();
    },
    saveRuntimeConfig: async (config: DesktopConnectConfig) => {
      calls.saveRuntimeConfig += 1;
      return store.saveRuntimeConfig(config);
    },
  };
  const workspaceRouter = {
    async sendThreadMessage() {
      return { runId: RUN_ID };
    },
    async getThread(threadId: string) {
      return { id: threadId, messages: [] };
    },
    async createThread(workspaceId: string, title: string) {
      return store.createThread(workspaceId, title);
    },
  };
  const service = new ExternalService(
    store,
    workspaceRouter as never,
    deps,
    join(dir, 'user-data'),
  );
  return {
    service,
    store,
    calls,
    input: {
      user_id: USER_ID,
      external_project_id: PROJECT_ID,
      prompt: '汇总今天的运行结果',
      agent_type: 'pi',
      provider_id: 'provider-default',
    },
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('repeated external runs skip the unchanged runtime config save', async () => {
  const harness = createHarness();
  try {
    const first = await harness.service.createRun(harness.input);
    assert.equal(first.run_id, RUN_ID);
    assert.equal(harness.calls.saveRuntimeConfig, 1, 'first run for a new project must persist its project config');
    const projectsAfterFirst = harness.store.readRuntimeConfig().config.projects;

    const second = await harness.service.createRun(harness.input);
    assert.equal(second.run_id, RUN_ID);
    assert.equal(harness.calls.saveRuntimeConfig, 1, `unchanged rerun must not rewrite the runtime config, saw ${harness.calls.saveRuntimeConfig}`);
    assert.deepEqual(harness.store.readRuntimeConfig().config.projects, projectsAfterFirst, 'skipped save must not alter stored project entries');

    const withNewModel = await harness.service.createRun({ ...harness.input, model: 'deepseek-v4-flash' });
    assert.equal(withNewModel.run_id, RUN_ID);
    assert.equal(harness.calls.saveRuntimeConfig, 2, 'a changed model option must persist the updated config');
    assert.equal(harness.calls.readRuntimeConfig, 3, 'each run still reads the config so store-side migration self-healing stays alive');
  } finally {
    harness.close();
  }
});
