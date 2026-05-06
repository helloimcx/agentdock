import { DESKTOP_CODEX_ACP_PACKAGE } from '../../../../../shared/desktop.js';
import type { AgentRuntimeDefinition } from '../shared/definition.js';
import { resolveBundledAcpCommand } from '../shared/launch-utils.js';
import { codexAcpBehavior } from './behavior.js';

export const codexAgentDefinition: AgentRuntimeDefinition = {
  agentType: 'codex',
  displayName: 'Codex',
  behavior: codexAcpBehavior,
  detection: {
    commandCandidates: ['codex-acp', 'codex'],
    versionArgs: ['--version'],
    bundledRuntimes: [
      {
        packageName: DESKTOP_CODEX_ACP_PACKAGE,
        candidates: ['bin/codex-acp.js'],
      },
    ],
  },
  buildLaunchConfig() {
    return resolveBundledAcpCommand(DESKTOP_CODEX_ACP_PACKAGE, 'codex-acp');
  },
};
