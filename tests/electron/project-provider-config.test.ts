import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getProjectProviderId,
  removeProviderReferences,
  selectProjectModel,
  selectProjectProvider,
} from '../../src/pages/Projects/project-provider-config';
import type { DesktopConnectConfig } from '../../shared/desktop';

function createConfig(): DesktopConnectConfig {
  return {
    projects: [{
      name: 'agentdock',
      agent: {
        type: 'localcore-acp',
        options: {
          model: 'old-model',
          provider_id: 'old-provider',
        },
      },
      platforms: [],
    }],
  };
}

test('project provider selection updates agent provider_id without mutating the original config', () => {
  const config = createConfig();
  const next = selectProjectProvider(config, 'agentdock', 'deepseek');

  assert.equal(getProjectProviderId(next, 'agentdock'), 'deepseek');
  assert.equal(getProjectProviderId(config, 'agentdock'), 'old-provider');
  assert.equal(next.projects?.[0]?.agent.options?.model, 'old-model');
});

test('project model selection updates only the project model override', () => {
  const config = createConfig();
  const next = selectProjectModel(config, 'agentdock', 'deepseek-chat');

  assert.equal(next.projects?.[0]?.agent.options?.model, 'deepseek-chat');
  assert.equal(next.projects?.[0]?.agent.options?.provider_id, 'old-provider');
  assert.equal(config.projects?.[0]?.agent.options?.model, 'old-model');
});

test('project provider selection reports missing projects clearly', () => {
  assert.throws(
    () => selectProjectProvider(createConfig(), 'missing', 'deepseek'),
    /Project not found in config: missing/,
  );
});

test('provider removal clears references from every project without mutating the original config', () => {
  const config = createConfig();
  config.projects?.push({
    name: 'project-2',
    agent: {
      type: 'localcore-acp',
      options: {
        model: 'other-model',
        provider_id: 'old-provider',
      },
    },
    platforms: [],
  });
  config.projects?.push({
    name: 'project-3',
    agent: {
      type: 'localcore-acp',
      options: {
        model: 'third-model',
        provider_id: 'keep-provider',
      },
    },
    platforms: [],
  });

  const next = removeProviderReferences(config, 'old-provider');

  assert.equal(getProjectProviderId(next, 'agentdock'), '');
  assert.equal(getProjectProviderId(next, 'project-2'), '');
  assert.equal(getProjectProviderId(next, 'project-3'), 'keep-provider');
  assert.equal(getProjectProviderId(config, 'agentdock'), 'old-provider');
  assert.equal(getProjectProviderId(config, 'project-2'), 'old-provider');
});
