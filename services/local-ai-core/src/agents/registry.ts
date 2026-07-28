import type { AgentAcpBehavior } from './shared/acp-behavior.js';
import { standardAcpBehavior } from './shared/acp-behavior.js';
import type { AgentRuntimeDefinition } from './shared/definition.js';
export type { AgentRuntimeDefinition };
import { agentDefinitionMatches, normalizeAgentType } from './shared/definition.js';
import { codexAgentDefinition } from './codex/definition.js';
import { claudeCodeAgentDefinition } from './claudecode/definition.js';
import { hermesAgentDefinition } from './hermes/definition.js';
import { localCoreAcpAgentDefinition } from './localcore-acp/definition.js';
import { opencodeAgentDefinition } from './opencode/definition.js';
import { piAgentDefinition } from './pi/definition.js';

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
