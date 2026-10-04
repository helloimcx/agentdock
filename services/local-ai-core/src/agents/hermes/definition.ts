import type { AgentRuntimeDefinition } from '../shared/definition.js';
import { hermesAcpBehavior } from './behavior.js';
import { buildHermesLaunchConfig, resolveHermesModel } from './launch.js';

export const hermesAgentDefinition: AgentRuntimeDefinition = {
  agentType: 'hermes',
  displayName: 'Hermes',
  behavior: hermesAcpBehavior,
  mesh: { context: 'acp-meta', filesystem: 'unsupported', unsupportedReason: 'The Hermes ACP integration does not yet enforce remote workspace file routing.' },
  detection: {
    commandCandidates: ['hermes'],
    versionArgs: ['--version'],
  },
  resolveModel: resolveHermesModel,
  buildLaunchConfig: buildHermesLaunchConfig,
};
