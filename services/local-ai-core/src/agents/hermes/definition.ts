import type { AgentRuntimeDefinition } from '../shared/definition.js';
import { hermesAcpBehavior } from './behavior.js';
import { buildHermesLaunchConfig, resolveHermesModel } from './launch.js';

export const hermesAgentDefinition: AgentRuntimeDefinition = {
  agentType: 'hermes',
  displayName: 'Hermes',
  behavior: hermesAcpBehavior,
  detection: {
    commandCandidates: ['hermes'],
    versionArgs: ['--version'],
  },
  resolveModel: resolveHermesModel,
  buildLaunchConfig: buildHermesLaunchConfig,
};
