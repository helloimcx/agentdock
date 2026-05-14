import type {
  DesktopConnectConfig,
  DesktopProjectConfig,
  DesktopProviderConfig,
  DesktopSandboxOptions,
} from '../../../../packages/contracts/src/index.js';
import { defaultOpenSandboxServerUrl } from '../sandbox/sandbox-config.js';

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
    if (!sandbox.provider) {
      sandbox.provider = 'opensandbox';
      changed = true;
    }
    if (!sandbox.server_url) {
      sandbox.server_url = defaultOpenSandboxServerUrl();
      changed = true;
    }
    if (!sandbox.api_key_env) {
      sandbox.api_key_env = 'OPEN_SANDBOX_API_KEY';
      changed = true;
    }
    if (!sandbox.acp_port) {
      sandbox.acp_port = 8080;
      changed = true;
    }
    if (!sandbox.state_scope) {
      sandbox.state_scope = 'project';
      changed = true;
    }
  }
  return { value: sandbox, changed };
}

function cloneConfig(input: DesktopConnectConfig): DesktopConnectConfig {
  return JSON.parse(JSON.stringify(input || {}));
}
