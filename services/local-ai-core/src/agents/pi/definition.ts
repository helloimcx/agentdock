import {
  DESKTOP_PI_CODING_AGENT_PACKAGE,
} from '../../../../../shared/desktop.js';
import type { AgentRuntimeDefinition } from '../shared/definition.js';
import { piAcpBehavior } from './behavior.js';
import { buildPiLaunchConfig, resolvePiModel } from './launch.js';

export const piAgentDefinition: AgentRuntimeDefinition = {
  agentType: 'pi',
  displayName: 'Pi',
  behavior: piAcpBehavior,
  detection: {
    commandCandidates: ['pi'],
    versionArgs: ['--version'],
    bundledRuntimes: [
      {
        packageName: DESKTOP_PI_CODING_AGENT_PACKAGE,
        candidates: ['dist/cli.js'],
      },
    ],
  },
  resolveModel: resolvePiModel,
  buildLaunchConfig: buildPiLaunchConfig,
};
