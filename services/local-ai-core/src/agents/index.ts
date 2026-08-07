import type { RuntimePlugin } from '@cc/plugin-sdk';
import { buildAgentCapabilityFields } from './shared/agent-plugin.js';

export {
  getAgentRuntimeDefinitions,
  getStaticAgentRuntimeDefinitions,
  resolveAgentAcpBehavior,
  resolveAgentRuntimeDefinition,
} from './registry.js';

export function createBuiltinStaticAgentCapabilityPlugin(agentType: string, displayName = agentType): RuntimePlugin {
  return buildAgentCapabilityFields(agentType, displayName);
}

export { createBuiltinCodexAgentPlugin } from './codex/index.js';
export { createBuiltinClaudeCodeAgentPlugin } from './claudecode/index.js';
export { createBuiltinHermesAgentPlugin } from './hermes/index.js';
export { createBuiltinLocalCoreAcpAgentPlugin } from './localcore-acp/index.js';
export { createBuiltinOpencodeAgentPlugin } from './opencode/index.js';
export { createBuiltinPiAgentPlugin } from './pi/index.js';
export type { AgentAcpBehavior } from './shared/acp-behavior.js';
export type { AgentRuntimeDefinition } from './shared/definition.js';
