import { dirname, isAbsolute, resolve } from 'node:path';
import type { ConfigFileState, DesktopProjectConfig, DesktopProviderConfig } from '../../../../packages/contracts/src/index.js';
import type { AgentLaunchConfig } from '../../../../packages/plugin-sdk/src/index.js';
import {
  LOCALCORE_ACP_AGENT_TYPE,
  normalizeDesktopAgentModel,
  normalizeDesktopPlatformType,
} from '../../../../shared/desktop.js';
import { resolveAgentRuntimeDefinition, type AgentRuntimeDefinition } from '../agents/index.js';
import { collectProviderEnv as collectSharedProviderEnv } from '../agents/shared/launch-utils.js';
import {
  isProjectSandboxEnabled,
  normalizeSandboxLaunchConfig,
  sandboxProxyLaunchEnv,
  sandboxProxyScriptPath,
} from '../sandbox/sandbox-config.js';

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

export function toLocalCoreProjectConfig(configState: ConfigFileState, project: DesktopProjectConfig): AgentLaunchConfig {
  const rawWorkDir = String(project.agent?.options?.work_dir || '.').trim() || '.';
  const configDir = dirname(configState.path);
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
    workspaceId: project.name,
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
  };
  if (!isProjectSandboxEnabled(project)) {
    return launchConfig;
  }
  const sandbox = normalizeSandboxLaunchConfig({ configState, project, launchConfig });
  if (!sandbox) {
    return launchConfig;
  }
  return {
    ...launchConfig,
    command: process.execPath,
    args: [sandboxProxyScriptPath()],
    env: {
      ...sandboxProxyLaunchEnv(sandbox),
      AGENTDOCK_SANDBOX_AGENT_TYPE: agentType,
    },
    sandbox,
  };
}
