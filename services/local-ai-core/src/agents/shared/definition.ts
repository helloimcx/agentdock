import type { ConfigFileState, DesktopProjectConfig, DesktopProviderConfig } from '../../../../../packages/contracts/src/index.js';
import type { AgentAcpBehavior } from './acp-behavior.js';

export type AgentBundledRuntime = {
  packageName: string;
  candidates: string[];
};

export type AgentRuntimeDetectionDefinition = {
  builtin?: boolean;
  commandCandidates?: string[];
  versionArgs?: string[];
  bundledRuntimes?: AgentBundledRuntime[];
};

export type AgentModelResolverInput = {
  project: DesktopProjectConfig;
  providers: DesktopProviderConfig[];
  rawModel: string;
  normalizedModel: string;
};

export type AgentLaunchResolverInput = {
  configState: ConfigFileState;
  project: DesktopProjectConfig;
  agentType: string;
  providers: DesktopProviderConfig[];
  model: string;
};

export type AgentLaunchDefaults = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
};

export type AgentRuntimeDefinition = {
  agentType: string;
  displayName: string;
  aliases?: string[];
  behavior: AgentAcpBehavior;
  detection?: AgentRuntimeDetectionDefinition;
  resolveModel?(input: AgentModelResolverInput): string;
  buildLaunchConfig?(input: AgentLaunchResolverInput): AgentLaunchDefaults;
};

export function normalizeAgentType(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

export function agentDefinitionMatches(definition: AgentRuntimeDefinition, agentType?: string | null) {
  const normalized = normalizeAgentType(agentType);
  return normalized === definition.agentType
    || Boolean(definition.aliases?.some((alias) => normalizeAgentType(alias) === normalized));
}
