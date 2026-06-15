import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { AgentLaunchConfig, AgentSandboxLaunchConfig, AgentSandboxLifecycle, AgentSandboxStateScope } from '../../../../packages/plugin-sdk/src/index.js';
import {
  DEFAULT_SANDBOX_PROVIDER_ID,
  defaultSandboxProviderForProfile,
  defaultSandboxRuntimeImage,
  getDesktopDeploymentProfile,
  type DesktopProjectConfig,
  type DesktopSandboxOptions,
  type DesktopSandboxProviderConfig,
  type DesktopSandboxRuntimeImage,
  type RuntimeConfigState,
} from '../../../../packages/contracts/src/index.js';

export const DEFAULT_OPENSANDBOX_SERVER_URL = 'http://127.0.0.1:8080';
export const DEFAULT_OPENSANDBOX_SERVER_URL_ENV = 'AGENTDOCK_OPENSANDBOX_SERVER_URL';
export const DEFAULT_OPENSANDBOX_API_KEY_ENV = 'OPEN_SANDBOX_API_KEY';
export const DEFAULT_SANDBOX_STATE_HOST_ROOT_ENV = 'AGENTDOCK_SANDBOX_STATE_HOST_ROOT';
export const DEFAULT_PI_SANDBOX_IMAGE = 'agentdock/pi-acp:local';
export const DEFAULT_SANDBOX_ACP_PORT = 8080;
export const DEFAULT_SANDBOX_TIMEOUT_SECONDS = 7200;
export const DEFAULT_SANDBOX_IDLE_SECONDS = 900;
export const DEFAULT_SANDBOX_WARM_POOL_SIZE = 0;
export const DEFAULT_SANDBOX_CPU = '1000m';
export const DEFAULT_SANDBOX_MEMORY = '2Gi';
export const DEFAULT_WORKSPACE_MOUNT_PATH = '/workspace';
export const DEFAULT_STATE_MOUNT_PATH = '/agent-state';

export function getProjectSandboxOptions(project: DesktopProjectConfig): DesktopSandboxOptions | null {
  const sandbox = project.agent?.options?.sandbox;
  return sandbox && typeof sandbox === 'object' ? sandbox : null;
}

export function isProjectSandboxEnabled(project: DesktopProjectConfig) {
  return Boolean(getProjectSandboxOptions(project)?.enabled);
}

export function normalizeSandboxLaunchConfig(input: {
  configState: RuntimeConfigState;
  project: DesktopProjectConfig;
  launchConfig: AgentLaunchConfig;
}): AgentSandboxLaunchConfig | undefined {
  const raw = getProjectSandboxOptions(input.project);
  if (!raw?.enabled) {
    return undefined;
  }
  const configDir = input.configState.baseDir;
  const userDataRoot = resolve(configDir, '..');
  const agentType = input.launchConfig.agentType || String(input.project.agent?.type || '').trim().toLowerCase() || 'agent';
  const desktopConfig = input.configState.config || {};
  const deploymentProfileId = String(raw.deployment_profile || desktopConfig.deployment_profile || process.env.AGENTDOCK_DEPLOYMENT_PROFILE || '').trim();
  const profile = getDesktopDeploymentProfile(deploymentProfileId);
  const sandboxProvider = resolveSandboxProvider(desktopConfig.sandbox_providers, raw, profile.id);
  const runtimeImage = resolveSandboxRuntimeImage(desktopConfig.sandbox_runtime_images, raw, agentType);
  const stateScope = normalizeStateScope(raw.state_scope);
  const stateMountPath = normalizeAbsoluteContainerPath(
    raw.state_mount_path || runtimeImage.state_mount_path || profile.stateMountPath,
    DEFAULT_STATE_MOUNT_PATH,
  );
  const projectId = sanitizePathSegment(input.project.name, 'project');
  const rawOptions = input.project.agent?.options || {};
  const userId = sanitizePathSegment(String(rawOptions.user_id || (rawOptions as Record<string, unknown>).tenant_id || 'local'), 'local');
  const agentId = sanitizePathSegment(agentType, 'agent');
  const stateHostRoot = String(process.env[DEFAULT_SANDBOX_STATE_HOST_ROOT_ENV] || '').trim() || resolve(userDataRoot, 'sandbox-state');
  const proxyCwd = resolveSandboxProxyCwd(configDir);
  const stateHostPath = resolve(
    stateHostRoot,
    'users',
    userId,
    ...(stateScope === 'user'
      ? ['agents', agentId]
      : ['projects', projectId, 'agents', agentId]),
    ...(stateScope === 'thread'
      ? ['threads', '${LOCAL_AI_THREAD_ID}', 'state']
      : stateScope === 'run'
        ? ['runs', '${AGENTDOCK_SANDBOX_RUN_ID}', 'state']
        : ['state']),
  );
  if (stateHostPath && !stateHostPath.includes('${')) {
    mkdirSync(stateHostPath, { recursive: true, mode: 0o700 });
  }
  return {
    enabled: true,
    provider: String(raw.provider || sandboxProvider.type || 'opensandbox').trim() || 'opensandbox',
    transport: normalizeSandboxTransport(runtimeImage.transport || raw.transport),
    serverUrl: normalizeServerUrl(sandboxProvider.server_url || raw.server_url || profile.openSandboxServerUrl),
    apiKeyEnv: String(sandboxProvider.api_key_env || raw.api_key_env || DEFAULT_OPENSANDBOX_API_KEY_ENV).trim() || DEFAULT_OPENSANDBOX_API_KEY_ENV,
    image: String(runtimeImage.image || raw.image || defaultSandboxImage(agentType)).trim() || defaultSandboxImage(agentType),
    acpPort: normalizePositiveInteger(runtimeImage.acp_port || raw.acp_port, DEFAULT_SANDBOX_ACP_PORT),
    entrypoint: normalizeEntrypoint(runtimeImage.entrypoint || raw.entrypoint),
    timeoutSeconds: normalizePositiveInteger(raw.timeout_seconds, DEFAULT_SANDBOX_TIMEOUT_SECONDS),
    lifecycle: normalizeSandboxLifecycle(raw.sandbox_lifecycle),
    idleSeconds: normalizePositiveInteger(raw.idle_seconds, DEFAULT_SANDBOX_IDLE_SECONDS),
    warmPoolSize: normalizeNonNegativeInteger(raw.warm_pool_size, DEFAULT_SANDBOX_WARM_POOL_SIZE),
    cpu: String(raw.cpu || DEFAULT_SANDBOX_CPU).trim() || DEFAULT_SANDBOX_CPU,
    memory: String(raw.memory || DEFAULT_SANDBOX_MEMORY).trim() || DEFAULT_SANDBOX_MEMORY,
    userId,
    projectId,
    stateScope,
    workspaceHostPath: input.launchConfig.workDir,
    workspaceMountPath: normalizeAbsoluteContainerPath(
      raw.workspace_mount_path || runtimeImage.workspace_mount_path || profile.workspaceMountPath,
      DEFAULT_WORKSPACE_MOUNT_PATH,
    ),
    proxyCwd,
    stateHostPath,
    stateMountPath,
    stateMount: {
      userId,
      projectId,
      agentType,
      scope: stateScope,
      hostPath: stateHostPath,
      containerPath: stateMountPath,
    },
    runtimeCommand: normalizeRuntimeCommandForSandbox(agentType, input.launchConfig.command, runtimeImage.runtime_command),
    runtimeArgs: normalizeRuntimeArgsForSandbox(agentType, input.launchConfig.args || [], runtimeImage.runtime_args),
    runtimeEnv: normalizeRuntimeEnvForSandbox(agentType, input.launchConfig.env || {}, stateMountPath),
  };
}

function resolveSandboxProvider(
  providers: DesktopSandboxProviderConfig[] | undefined,
  raw: DesktopSandboxOptions,
  profileId: string,
): DesktopSandboxProviderConfig {
  const providerId = String(raw.provider_id || '').trim();
  const selected = Array.isArray(providers)
    ? providers.find((provider) => provider.id === providerId)
      || providers.find((provider) => provider.id === DEFAULT_SANDBOX_PROVIDER_ID)
    : undefined;
  if (selected) {
    return selected;
  }
  if (raw.server_url || raw.api_key_env || raw.provider) {
    return {
      id: providerId || DEFAULT_SANDBOX_PROVIDER_ID,
      type: raw.provider || 'opensandbox',
      name: 'OpenSandbox',
      server_url: raw.server_url || defaultOpenSandboxServerUrl(),
      api_key_env: raw.api_key_env || DEFAULT_OPENSANDBOX_API_KEY_ENV,
    };
  }
  return {
    ...defaultSandboxProviderForProfile(profileId),
    server_url: defaultOpenSandboxServerUrl(),
  };
}

function resolveSandboxRuntimeImage(
  images: DesktopSandboxRuntimeImage[] | undefined,
  raw: DesktopSandboxOptions,
  agentType: string,
): DesktopSandboxRuntimeImage {
  const runtimeImageId = String(raw.runtime_image_id || '').trim();
  const selected = Array.isArray(images)
    ? images.find((image) => image.id === runtimeImageId)
      || images.find((image) => image.agent_type === agentType)
    : undefined;
  if (selected) {
    const fallback = defaultSandboxRuntimeImage(agentType);
    return {
      ...selected,
      transport: normalizeSandboxTransport(selected.transport || fallback.transport),
    };
  }
  if (raw.image || raw.transport || raw.acp_port || raw.entrypoint || raw.workspace_mount_path || raw.state_mount_path) {
    const fallback = defaultSandboxRuntimeImage(agentType);
    return {
      id: runtimeImageId || fallback.id,
      agent_type: agentType,
      image: raw.image || fallback.image,
      transport: normalizeSandboxTransport(raw.transport || fallback.transport),
      acp_port: normalizePositiveInteger(raw.acp_port, fallback.acp_port),
      entrypoint: raw.entrypoint || fallback.entrypoint,
      workspace_mount_path: raw.workspace_mount_path || fallback.workspace_mount_path,
      state_mount_path: raw.state_mount_path || fallback.state_mount_path,
    };
  }
  return defaultSandboxRuntimeImage(agentType);
}

export function resolveSandboxStateHostPath(config: AgentSandboxLaunchConfig, threadId: string, runId: string) {
  if (!config.stateHostPath) {
    return '';
  }
  const resolved = config.stateHostPath
    .replaceAll('${LOCAL_AI_THREAD_ID}', sanitizePathSegment(threadId, 'thread'))
    .replaceAll('${AGENTDOCK_SANDBOX_RUN_ID}', sanitizePathSegment(runId, 'run'));
  mkdirSync(resolved, { recursive: true, mode: 0o700 });
  return resolved;
}

export function cleanupRunScopedState(config: AgentSandboxLaunchConfig, statePath: string) {
  if (config.stateScope !== 'run' || !statePath || !existsSync(statePath)) {
    return;
  }
  rmSync(statePath, { recursive: true, force: true });
}

export function materializeSandboxLaunchConfig(config: AgentSandboxLaunchConfig, env: NodeJS.ProcessEnv): AgentSandboxLaunchConfig {
  const threadId = String(env.LOCAL_AI_THREAD_ID || 'thread');
  const runId = String(env.AGENTDOCK_SANDBOX_RUN_ID || 'run');
  const stateHostPath = resolveSandboxStateHostPath(config, threadId, runId);
  return {
    ...config,
    stateHostPath,
  };
}

function defaultSandboxImage(agentType: string) {
  return agentType === 'pi' ? DEFAULT_PI_SANDBOX_IMAGE : `agentdock/${agentType}-acp:local`;
}

function normalizeServerUrl(value?: string) {
  const fallback = defaultOpenSandboxServerUrl();
  return String(value || fallback).trim().replace(/\/+$/, '') || fallback;
}

export function defaultOpenSandboxServerUrl(env: NodeJS.ProcessEnv = process.env) {
  return String(env[DEFAULT_OPENSANDBOX_SERVER_URL_ENV] || DEFAULT_OPENSANDBOX_SERVER_URL)
    .trim()
    .replace(/\/+$/, '') || DEFAULT_OPENSANDBOX_SERVER_URL;
}

function normalizeStateScope(value?: string): AgentSandboxStateScope {
  return value === 'user' || value === 'thread' || value === 'run' ? value : 'project';
}

function normalizeSandboxTransport(_value?: string): 'http-ndjson' {
  return 'http-ndjson';
}

function normalizeSandboxLifecycle(value?: string): AgentSandboxLifecycle {
  return value === 'per_run' ? 'per_run' : 'per_thread';
}

function normalizePositiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeNonNegativeInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function normalizeAbsoluteContainerPath(value: unknown, fallback: string) {
  const normalized = String(value || '').trim();
  return normalized.startsWith('/') ? normalized : fallback;
}

function normalizeEntrypoint(value: unknown) {
  if (Array.isArray(value)) {
    const entries = value.map((entry) => String(entry || '').trim()).filter(Boolean);
    if (entries.length > 0) {
      return entries;
    }
  }
  return ['node', '/opt/agentdock/acp-bridge.mjs'];
}

function normalizeRuntimeEnvForSandbox(agentType: string, env: Record<string, string>, stateMountPath: string) {
  const output: Record<string, string> = {
    ...env,
    AGENTDOCK_SANDBOX_AGENT_TYPE: agentType,
  };
  if (agentType === 'pi') {
    output.PI_CODING_AGENT_DIR = `${stateMountPath}/pi`;
    output.PI_ACP_PI_COMMAND = '/usr/local/bin/pi';
  }
  return output;
}

function normalizeRuntimeCommandForSandbox(agentType: string, command: string, override?: string) {
  const runtimeCommand = String(override || '').trim();
  if (runtimeCommand) {
    return runtimeCommand;
  }
  return agentType === 'pi' ? '/usr/local/bin/pi-acp' : command;
}

function normalizeRuntimeArgsForSandbox(agentType: string, args: string[], override?: string[]) {
  if (Array.isArray(override)) {
    return override.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  return agentType === 'pi' ? [] : args;
}

export function sandboxProxyScriptPath() {
  return resolve(__dirname, 'sandbox-stdio-proxy.js');
}

export function resolveSandboxProxyCwd(configDir: string) {
  const candidates = [
    String(process.env.AI_WORKSTATION_USER_DATA_DIR || '').trim(),
    configDir,
    process.cwd(),
    '/tmp',
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || process.cwd();
}

export function sandboxProxyLaunchEnv(config: AgentSandboxLaunchConfig) {
  return {
    AGENTDOCK_SANDBOX_CONFIG: JSON.stringify(config),
  };
}

export function sanitizePathSegment(value: string, fallback: string) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

export function resolveHostPathFromConfigDir(configState: RuntimeConfigState, rawPath: string) {
  return isAbsolute(rawPath) ? rawPath : resolve(configState.baseDir, rawPath);
}
