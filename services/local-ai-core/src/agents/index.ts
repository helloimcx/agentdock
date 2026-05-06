import type { RuntimePlugin } from '../../../../packages/plugin-sdk/src/index.js';
import type { AgentAcpBehavior } from './shared/acp-behavior.js';
import { standardAcpBehavior } from './shared/acp-behavior.js';
import { codexAcpBehavior } from './codex/index.js';
import { claudeCodeAcpBehavior } from './claudecode/index.js';
import { hermesAcpBehavior } from './hermes/index.js';
import { localCoreAcpBehavior } from './localcore-acp/index.js';
import { opencodeAcpBehavior } from './opencode/index.js';
import { piAcpBehavior } from './pi/index.js';

const AGENT_ACP_BEHAVIORS: Record<string, AgentAcpBehavior> = {
  codex: codexAcpBehavior,
  claudecode: claudeCodeAcpBehavior,
  hermes: hermesAcpBehavior,
  'localcore-acp': localCoreAcpBehavior,
  opencode: opencodeAcpBehavior,
  pi: piAcpBehavior,
};

export function resolveAgentAcpBehavior(agentType?: string | null): AgentAcpBehavior {
  const normalized = String(agentType || '').trim().toLowerCase();
  return AGENT_ACP_BEHAVIORS[normalized] || standardAcpBehavior;
}

export function createBuiltinStaticAgentCapabilityPlugin(agentType: string): RuntimePlugin {
  return {
    manifest: {
      id: `builtin.agent-${agentType}`,
      kind: 'agent',
      version: '0.1.0',
      provides: [`agent:${agentType}`],
    },
    capabilities: {
      agents: [
        {
          id: `agent.${agentType}`,
          agentType,
          displayName: agentType,
        },
      ],
    },
  };
}

export { createBuiltinCodexAgentPlugin } from './codex/index.js';
export { createBuiltinClaudeCodeAgentPlugin } from './claudecode/index.js';
export { createBuiltinHermesAgentPlugin } from './hermes/index.js';
export { createBuiltinLocalCoreAcpAgentPlugin } from './localcore-acp/index.js';
export { createBuiltinOpencodeAgentPlugin } from './opencode/index.js';
export { createBuiltinPiAgentPlugin } from './pi/index.js';
export type { AgentAcpBehavior } from './shared/acp-behavior.js';
