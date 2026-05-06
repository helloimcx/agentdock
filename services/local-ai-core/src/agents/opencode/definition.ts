import type { AgentRuntimeDefinition } from '../shared/definition.js';
import { opencodeAcpBehavior } from './behavior.js';
import { buildOpencodeLaunchConfig, resolveOpencodeModel } from './launch.js';

export const opencodeAgentDefinition: AgentRuntimeDefinition = {
  agentType: 'opencode',
  displayName: 'OpenCode',
  behavior: opencodeAcpBehavior,
  detection: {
    commandCandidates: ['opencode'],
    versionArgs: ['--version'],
  },
  resolveModel: resolveOpencodeModel,
  buildLaunchConfig(input) {
    return buildOpencodeLaunchConfig(input.model, input.providers);
  },
};
