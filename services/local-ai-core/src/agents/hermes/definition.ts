import type { AgentRuntimeDefinition } from '../shared/definition.js';
import { hermesAcpBehavior } from './behavior.js';

export const hermesAgentDefinition: AgentRuntimeDefinition = {
  agentType: 'hermes',
  displayName: 'Hermes',
  behavior: hermesAcpBehavior,
  detection: {
    commandCandidates: ['hermes'],
    versionArgs: ['--version'],
  },
  buildLaunchConfig() {
    return {
      command: 'hermes',
      args: ['acp'],
    };
  },
};
