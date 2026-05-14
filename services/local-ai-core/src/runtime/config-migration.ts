import {
  DEFAULT_SANDBOX_PROVIDER_ID,
  defaultSandboxProviderForProfile,
  defaultSandboxRuntimeImage,
} from '../../../../packages/contracts/src/index.js';
import type {
  DesktopConnectConfig,
  DesktopProjectConfig,
  DesktopProviderConfig,
  DesktopSandboxOptions,
} from '../../../../packages/contracts/src/index.js';

export const CURRENT_DESKTOP_CONFIG_VERSION = 2;

export interface DesktopConfigMigrationResult {
  config: DesktopConnectConfig;
  changed: boolean;
  warnings: string[];
}

export function migrateDesktopConnectConfig(input: DesktopConnectConfig): DesktopConfigMigrationResult {
  const config = cloneConfig(input);
  const warnings: string[] = [];
  let changed = false;

  if (config.config_version !== CURRENT_DESKTOP_CONFIG_VERSION) {
    config.config_version = CURRENT_DESKTOP_CONFIG_VERSION;
    changed = true;
  }

  const deploymentProfile = String(config.deployment_profile || '').trim();

  for (const project of Array.isArray(config.projects) ? config.projects : []) {
    const options = ensureProjectOptions(project);
    if ('tenant_id' in options && !options.user_id) {
      options.user_id = String(options.tenant_id || '').trim() || 'local';
      delete options.tenant_id;
      changed = true;
      warnings.push(`Project "${project.name}" migrated agent.options.tenant_id to user_id.`);
    }

    if (Array.isArray(project.agent?.providers)) {
      for (const provider of project.agent.providers) {
        if (normalizeDeepSeekProvider(provider)) {
          changed = true;
          warnings.push(`Project "${project.name}" normalized a DeepSeek provider name.`);
        }
      }
    }

    const sandbox = normalizeSandboxOptions(options.sandbox);
    if (sandbox.changed) {
      options.sandbox = sandbox.value;
      changed = true;
    }
    if (options.sandbox?.enabled) {
      const providerMigration = migrateProjectSandboxProvider(config, options.sandbox, deploymentProfile);
      if (providerMigration.changed) {
        changed = true;
      }
      const imageMigration = migrateProjectSandboxRuntimeImage(config, project, options.sandbox);
      if (imageMigration.changed) {
        changed = true;
      }
    }
  }

  return { config, changed, warnings };
}

function ensureProjectOptions(project: DesktopProjectConfig): Record<string, unknown> & { sandbox?: DesktopSandboxOptions } {
  project.agent ||= { type: 'pi', options: {}, providers: [] };
  project.agent.options ||= {};
  return project.agent.options;
}

function normalizeDeepSeekProvider(provider: DesktopProviderConfig) {
  const name = String(provider.name || '').trim().toLowerCase();
  const baseUrl = String(provider.base_url || '').trim().toLowerCase();
  if (name === 'deepseek' || (!name.startsWith('deepseek-') && !baseUrl.includes('deepseek.com'))) {
    return false;
  }
  provider.name = 'deepseek';
  return true;
}

export function normalizeDesktopProviderForStorage(provider: DesktopProviderConfig): DesktopProviderConfig {
  const next = JSON.parse(JSON.stringify(provider || {})) as DesktopProviderConfig;
  normalizeDeepSeekProvider(next);
  return next;
}

function normalizeSandboxOptions(input?: DesktopSandboxOptions): { value?: DesktopSandboxOptions; changed: boolean } {
  if (!input || typeof input !== 'object') {
    return { value: input, changed: false };
  }
  const sandbox = { ...input };
  let changed = false;
  if (sandbox.enabled) {
    if (!sandbox.provider_id) {
      sandbox.provider_id = DEFAULT_SANDBOX_PROVIDER_ID;
      changed = true;
    }
    if (!sandbox.state_scope) {
      sandbox.state_scope = 'project';
      changed = true;
    }
  }
  return { value: sandbox, changed };
}

function migrateProjectSandboxProvider(
  config: DesktopConnectConfig,
  sandbox: DesktopSandboxOptions,
  deploymentProfile: string,
): { changed: boolean } {
  const providerId = String(sandbox.provider_id || DEFAULT_SANDBOX_PROVIDER_ID).trim() || DEFAULT_SANDBOX_PROVIDER_ID;
  config.sandbox_providers = Array.isArray(config.sandbox_providers) ? config.sandbox_providers : [];
  const existing = config.sandbox_providers.find((provider) => provider.id === providerId);
  if (existing) {
    return { changed: false };
  }
  const defaultProvider = defaultSandboxProviderForProfile(deploymentProfile);
  config.sandbox_providers.push({
    ...defaultProvider,
    id: providerId,
    type: sandbox.provider || defaultProvider.type,
    server_url: sandbox.server_url || defaultProvider.server_url,
    api_key_env: sandbox.api_key_env || defaultProvider.api_key_env,
  });
  return { changed: true };
}

function migrateProjectSandboxRuntimeImage(
  config: DesktopConnectConfig,
  project: DesktopProjectConfig,
  sandbox: DesktopSandboxOptions,
): { changed: boolean } {
  const agentType = String(project.agent?.type || 'pi').trim().toLowerCase() || 'pi';
  const fallback = defaultSandboxRuntimeImage(agentType);
  const imageId = String(sandbox.runtime_image_id || fallback.id).trim() || fallback.id;
  const assignedRuntimeImage = sandbox.runtime_image_id === imageId;
  sandbox.runtime_image_id = imageId;
  config.sandbox_runtime_images = Array.isArray(config.sandbox_runtime_images) ? config.sandbox_runtime_images : [];
  const existing = config.sandbox_runtime_images.find((image) => image.id === imageId);
  if (existing) {
    return { changed: !assignedRuntimeImage };
  }
  config.sandbox_runtime_images.push({
    ...fallback,
    id: imageId,
    image: sandbox.image || fallback.image,
    transport: sandbox.transport || (sandbox.image ? 'websocket' : fallback.transport),
    acp_port: sandbox.acp_port || fallback.acp_port,
    entrypoint: sandbox.entrypoint || fallback.entrypoint,
    runtime_command: fallback.runtime_command,
    runtime_args: fallback.runtime_args,
    workspace_mount_path: sandbox.workspace_mount_path || fallback.workspace_mount_path,
    state_mount_path: sandbox.state_mount_path || fallback.state_mount_path,
  });
  return { changed: true };
}

function cloneConfig(input: DesktopConnectConfig): DesktopConnectConfig {
  return JSON.parse(JSON.stringify(input || {}));
}
