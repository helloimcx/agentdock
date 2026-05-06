import { DESKTOP_CLAUDECODE_ACP_PACKAGE } from '../../../../../shared/desktop.js';
import type { AgentRuntimeDefinition } from '../shared/definition.js';
import { resolveBundledAcpCommand } from '../shared/launch-utils.js';
import { claudeCodeAcpBehavior } from './behavior.js';

export const claudeCodeAgentDefinition: AgentRuntimeDefinition = {
  agentType: 'claudecode',
  displayName: 'Claude Code',
  behavior: claudeCodeAcpBehavior,
  detection: {
    commandCandidates: ['claude-agent-acp', 'claude'],
    versionArgs: ['--version'],
    bundledRuntimes: [
      {
        packageName: DESKTOP_CLAUDECODE_ACP_PACKAGE,
        candidates: [
          'dist/cli.js',
          'bin/claude-agent-acp.js',
          'cli.js',
        ],
      },
    ],
  },
  buildLaunchConfig(input) {
    const bundled = resolveBundledAcpCommand(DESKTOP_CLAUDECODE_ACP_PACKAGE, 'claude-agent-acp');
    return {
      ...bundled,
      env: input.model
        ? {
            ANTHROPIC_MODEL: input.model,
          }
        : {} as Record<string, string>,
    };
  },
};
