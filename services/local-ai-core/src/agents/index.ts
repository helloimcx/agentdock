import type { RuntimePlugin } from '../../../../packages/plugin-sdk/src/index.js';
import type { AgentAcpBehavior } from './shared/acp-behavior.js';
import { standardAcpBehavior } from './shared/acp-behavior.js';
import type { AgentRuntimeDefinition } from './shared/definition.js';
import { agentDefinitionMatches, normalizeAgentType } from './shared/definition.js';
import { codexAgentDefinition } from './codex/index.js';
import { claudeCodeAgentDefinition } from './claudecode/index.js';
import { hermesAgentDefinition } from './hermes/index.js';
import { localCoreAcpAgentDefinition } from './localcore-acp/index.js';
import { opencodeAgentDefinition } from './opencode/index.js';
import { piAgentDefinition } from './pi/index.js';

const STATIC_AGENT_DEFINITIONS: AgentRuntimeDefinition[] = [
  {
    agentType: 'cursor',
    displayName: 'Cursor',
    behavior: standardAcpBehavior,
    detection: { commandCandidates: ['cursor-agent', 'cursor'], versionArgs: ['--version'] },
  },
  {
    agentType: 'gemini',
    displayName: 'Gemini',
    behavior: standardAcpBehavior,
    detection: { commandCandidates: ['gemini'], versionArgs: ['--version'] },
  },
  {
    agentType: 'qoder',
    displayName: 'Qoder',
    behavior: standardAcpBehavior,
    detection: { commandCandidates: ['qoder'], versionArgs: ['--version'] },
  },
  {
    agentType: 'iflow',
    displayName: 'iFlow',
    behavior: standardAcpBehavior,
    detection: { commandCandidates: ['iflow'], versionArgs: ['--version'] },
  },
];

const AGENT_RUNTIME_DEFINITIONS: AgentRuntimeDefinition[] = [
  piAgentDefinition,
  opencodeAgentDefinition,
  codexAgentDefinition,
  claudeCodeAgentDefinition,
  hermesAgentDefinition,
  localCoreAcpAgentDefinition,
  ...STATIC_AGENT_DEFINITIONS,
];

const AGENT_RUNTIME_DEFINITIONS_BY_TYPE = new Map(
  AGENT_RUNTIME_DEFINITIONS.map((definition) => [definition.agentType, definition]),
);

export function getAgentRuntimeDefinitions() {
  return [...AGENT_RUNTIME_DEFINITIONS];
}

export function getStaticAgentRuntimeDefinitions() {
  return [...STATIC_AGENT_DEFINITIONS];
}

export function resolveAgentRuntimeDefinition(agentType?: string | null): AgentRuntimeDefinition | null {
  const normalized = normalizeAgentType(agentType);
  return AGENT_RUNTIME_DEFINITIONS_BY_TYPE.get(normalized)
    || AGENT_RUNTIME_DEFINITIONS.find((definition) => agentDefinitionMatches(definition, normalized))
    || null;
}

export function resolveAgentAcpBehavior(agentType?: string | null): AgentAcpBehavior {
  return resolveAgentRuntimeDefinition(agentType)?.behavior || standardAcpBehavior;
}

export function createBuiltinStaticAgentCapabilityPlugin(agentType: string, displayName = agentType): RuntimePlugin {
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
          displayName,
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
export type { AgentRuntimeDefinition } from './shared/definition.js';
