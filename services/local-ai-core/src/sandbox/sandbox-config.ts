import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { AgentLaunchConfig, AgentSandboxLaunchConfig, AgentSandboxStateScope } from '../../../../packages/plugin-sdk/src/index.js';
import type { ConfigFileState, DesktopProjectConfig, DesktopSandboxOptions } from '../../../../packages/contracts/src/index.js';

export const DEFAULT_OPENSANDBOX_SERVER_URL = 'http://127.0.0.1:8080';
export const DEFAULT_OPENSANDBOX_API_KEY_ENV = 'OPEN_SANDBOX_API_KEY';
export const DEFAULT_PI_SANDBOX_IMAGE = 'agentdock/pi-acp:local';
export const DEFAULT_SANDBOX_ACP_PORT = 39231;
export const DEFAULT_SANDBOX_TIMEOUT_SECONDS = 7200;
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
  configState: ConfigFileState;
  project: DesktopProjectConfig;
  launchConfig: AgentLaunchConfig;
}): AgentSandboxLaunchConfig | undefined {
  const raw = getProjectSandboxOptions(input.project);
  if (!raw?.enabled) {
    return undefined;
  }
  const configDir = dirname(input.configState.path);
  const userDataRoot = dirname(configDir);
  const agentType = input.launchConfig.agentType || String(input.project.agent?.type || '').trim().toLowerCase() || 'agent';
  const stateScope = normalizeStateScope(raw.state_scope);
  const stateMountPath = normalizeAbsoluteContainerPath(raw.state_mount_path, DEFAULT_STATE_MOUNT_PATH);
  const projectId = sanitizePathSegment(input.project.name, 'project');
  const userId = sanitizePathSegment(String(input.project.agent?.options?.user_id || 'local'), 'local');
  const stateHostPath = resolve(
    userDataRoot,
    'sandbox-state',
    'users',
    userId,
    'projects',
    projectId,
    'agents',
    sanitizePathSegment(agentType, 'agent'),
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
    provider: String(raw.provider || 'opensandbox').trim() || 'opensandbox',
    serverUrl: normalizeServerUrl(raw.server_url),
    apiKeyEnv: String(raw.api_key_env || DEFAULT_OPENSANDBOX_API_KEY_ENV).trim() || DEFAULT_OPENSANDBOX_API_KEY_ENV,
    image: String(raw.image || defaultSandboxImage(agentType)).trim() || defaultSandboxImage(agentType),
    acpPort: normalizePositiveInteger(raw.acp_port, DEFAULT_SANDBOX_ACP_PORT),
    entrypoint: normalizeEntrypoint(raw.entrypoint),
    timeoutSeconds: normalizePositiveInteger(raw.timeout_seconds, DEFAULT_SANDBOX_TIMEOUT_SECONDS),
    cpu: String(raw.cpu || DEFAULT_SANDBOX_CPU).trim() || DEFAULT_SANDBOX_CPU,
    memory: String(raw.memory || DEFAULT_SANDBOX_MEMORY).trim() || DEFAULT_SANDBOX_MEMORY,
    userId,
    projectId,
    stateScope,
    workspaceHostPath: input.launchConfig.workDir,
    workspaceMountPath: normalizeAbsoluteContainerPath(raw.workspace_mount_path, DEFAULT_WORKSPACE_MOUNT_PATH),
    stateHostPath,
    stateMountPath,
    runtimeCommand: normalizeRuntimeCommandForSandbox(agentType, input.launchConfig.command),
    runtimeArgs: normalizeRuntimeArgsForSandbox(agentType, input.launchConfig.args || []),
    runtimeEnv: normalizeRuntimeEnvForSandbox(agentType, input.launchConfig.env || {}, stateMountPath),
  };
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
  return String(value || DEFAULT_OPENSANDBOX_SERVER_URL).trim().replace(/\/+$/, '') || DEFAULT_OPENSANDBOX_SERVER_URL;
}

function normalizeStateScope(value?: string): AgentSandboxStateScope {
  return value === 'thread' || value === 'run' ? value : 'project';
}

function normalizePositiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
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

function normalizeRuntimeCommandForSandbox(agentType: string, command: string) {
  return agentType === 'pi' ? '/usr/local/bin/pi-acp' : command;
}

function normalizeRuntimeArgsForSandbox(agentType: string, args: string[]) {
  return agentType === 'pi' ? [] : args;
}

export function sandboxProxyScriptPath() {
  return resolve(__dirname, 'sandbox-stdio-proxy.js');
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

export function resolveHostPathFromConfigDir(configState: ConfigFileState, rawPath: string) {
  return isAbsolute(rawPath) ? rawPath : resolve(dirname(configState.path), rawPath);
}
