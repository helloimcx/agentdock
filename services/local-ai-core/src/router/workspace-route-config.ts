import { isAbsolute, resolve } from 'node:path';
import type { DesktopProjectConfig, DesktopProviderConfig, RuntimeConfigState } from '@cc/superai-contracts';
import type { AgentLaunchConfig, AgentMcpServerConfig } from '@cc/plugin-sdk';
import {
  LOCALCORE_ACP_AGENT_TYPE,
  normalizeDesktopAgentModel,
  normalizeDesktopPlatformType,
} from '@cc/superai-contracts';
import { resolveAgentRuntimeDefinition, type AgentRuntimeDefinition } from '../agents/registry.js';
import { collectProviderEnv as collectSharedProviderEnv } from '../agents/shared/launch-utils.js';
import { prepareAgentExecutionLaunch } from '../execution/agent-execution-backend.js';

export function normalizePlatformTypes(project?: DesktopProjectConfig | null) {
  return Array.isArray(project?.platforms)
    ? project!.platforms.map((platform) => normalizeDesktopPlatformType(platform?.type)).filter(Boolean)
    : [];
}

export function isLocalCoreNativeAcpProject(project?: DesktopProjectConfig | null) {
  const agentType = String(project?.agent?.type || '').trim().toLowerCase();
  return !agentType
    || agentType === 'acp'
    || agentType === LOCALCORE_ACP_AGENT_TYPE;
}

function resolveAgentModel(project: DesktopProjectConfig, providers: DesktopProviderConfig[], definition?: AgentRuntimeDefinition | null) {
  const agentType = String(project.agent?.type || '').trim().toLowerCase();
  const rawModel = String(project.agent?.options?.model || '').trim();
  const normalizedModel = normalizeDesktopAgentModel(agentType, rawModel);
  return definition?.resolveModel?.({
    project,
    providers,
    rawModel,
    normalizedModel,
  }) || normalizedModel;
}

function toStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key, entryValue]) => key && entryValue !== undefined && entryValue !== null)
    .map(([key, entryValue]) => [key, String(entryValue)]);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

const MCP_TRANSPORT_TYPES = new Set(['stdio', 'sse', 'http']);

function buildMcpServerFields(entry: Record<string, unknown>, command: string, url: string) {
  const args = Array.isArray(entry.args)
    ? entry.args.map((value) => String(value ?? '')).filter(Boolean)
    : undefined;
  const env = toStringRecord(entry.env);
  const headers = toStringRecord(entry.headers);
  return {
    ...(command ? { command } : {}),
    ...(args && args.length > 0 ? { args } : {}),
    ...(env ? { env } : {}),
    ...(url ? { url } : {}),
    ...(headers ? { headers } : {}),
  };
}

function normalizeMcpServerEntry(raw: unknown): AgentMcpServerConfig | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const entry = raw as Record<string, unknown>;
  const name = String(entry.name || '').trim();
  if (!name) {
    return null;
  }
  const type = String(entry.type || 'stdio').trim().toLowerCase();
  if (!MCP_TRANSPORT_TYPES.has(type)) {
    return null;
  }
  const command = String(entry.command || '').trim();
  const url = String(entry.url || '').trim();
  if (type === 'stdio' && !command) {
    return null;
  }
  if (type !== 'stdio' && !url) {
    return null;
  }
  return {
    name,
    type: type as AgentMcpServerConfig['type'],
    ...buildMcpServerFields(entry, command, url),
    enabled: entry.enabled !== false,
  };
}

export function normalizeMcpServerOptions(input: unknown): AgentMcpServerConfig[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set<string>();
  const servers: AgentMcpServerConfig[] = [];
  for (const raw of input) {
    const server = normalizeMcpServerEntry(raw);
    if (!server || seen.has(server.name)) {
      continue;
    }
    seen.add(server.name);
    servers.push(server);
  }
  return servers;
}

export function toLocalCoreProjectConfig(configState: RuntimeConfigState, project: DesktopProjectConfig): AgentLaunchConfig {
  const rawWorkDir = String(project.agent?.options?.work_dir || '.').trim() || '.';
  const configDir = configState.baseDir;
  const workDir = isAbsolute(rawWorkDir) ? rawWorkDir : resolve(configDir, rawWorkDir);
  const rawArgs = project.agent?.options?.args;
  const args = Array.isArray(rawArgs)
    ? rawArgs.map((value) => String(value || '')).filter(Boolean)
    : [];
  const rawEnv = project.agent?.options?.env;
  const env = rawEnv && typeof rawEnv === 'object'
    ? Object.fromEntries(
        Object.entries(rawEnv as Record<string, unknown>)
          .filter(([key]) => key)
          .map(([key, value]) => [key, String(value ?? '')]),
      )
    : {};
  const agentType = String(project.agent?.type || '').trim().toLowerCase();
  const providers = Array.isArray(project.agent?.providers) ? project.agent.providers : [];
  const definition = resolveAgentRuntimeDefinition(agentType);
  const model = resolveAgentModel(project, providers, definition);
  const providerEnv = collectSharedProviderEnv(providers);
  const launchDefaults = definition?.buildLaunchConfig?.({
    configState,
    project,
    agentType,
    providers,
    model,
  }) || {};
  const inferredCommand = launchDefaults.command || '';
  const command = String(project.agent?.options?.command || inferredCommand).trim();
  if (!command) {
    throw new Error(`Workspace "${project.name}" requires [projects.agent.options].command for Local AI Core ACP execution.`);
  }
  const defaultArgs = launchDefaults.args || [];
  const launchConfig: AgentLaunchConfig = {
    workspaceId: project.workspace_id || project.name,
    agentType,
    workDir,
    command,
    args: args.length > 0 ? args : defaultArgs,
    env: {
      ...(launchDefaults.env || {}),
      ...providerEnv,
      ...env,
    },
    model,
    mcpServers: normalizeMcpServerOptions(project.agent?.options?.mcp_servers),
  };
  return prepareAgentExecutionLaunch({ configState, project, launchConfig });
}
