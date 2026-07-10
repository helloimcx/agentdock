import { existsSync } from 'node:fs';
import {
  defaultSandboxProviderForProfile,
  getDesktopDeploymentProfile,
  type DesktopConnectConfig,
  type LocalCoreDoctorCheck,
  type LocalCoreDoctorResult,
} from '@cc/superai-contracts';
import { defaultOpenSandboxServerUrl } from '../sandbox/sandbox-config.js';
import { AnthropicSandboxRunner } from '../automation/scripts/anthropic-sandbox-runner.js';

export async function runDeploymentDiagnostics(input: {
  config: DesktopConnectConfig | null | undefined;
  env?: NodeJS.ProcessEnv;
}): Promise<LocalCoreDoctorResult> {
  const env = input.env || process.env;
  const checkedAt = new Date().toISOString();
  const config = input.config || {};
  const profile = getDesktopDeploymentProfile(String(config.deployment_profile || env.AGENTDOCK_DEPLOYMENT_PROFILE || '').trim());
  const provider = Array.isArray(config.sandbox_providers)
    ? config.sandbox_providers.find((item) => item.id === profile.defaultSandboxProviderId) || config.sandbox_providers[0]
    : undefined;
  const sandboxProvider = provider || defaultSandboxProviderForProfile(profile.id);
  const opensandboxUrl = normalizeUrl(
    sandboxProvider.server_url || env.AGENTDOCK_OPENSANDBOX_SERVER_URL || defaultOpenSandboxServerUrl(env),
  );
  const checks: LocalCoreDoctorCheck[] = [
    {
      id: 'deployment.profile',
      label: 'Deployment profile',
      status: 'pass',
      summary: `${profile.label} uses OpenSandbox at ${opensandboxUrl || 'not configured'}.`,
    },
    {
      id: 'core.bind-host',
      label: 'Core bind host',
      status: profile.id === 'docker-compose' && env.AI_WORKSTATION_HOST !== '0.0.0.0' ? 'warn' : 'pass',
      summary: `AI_WORKSTATION_HOST=${env.AI_WORKSTATION_HOST || '127.0.0.1'}.`,
    },
    dockerSocketCheck(profile.id),
    workspacePathCheck(config, profile.id),
    allowlistCheck(config, env),
    sandboxImageCheck(config),
    await automationSandboxCheck(),
    await opensandboxHealthCheck(opensandboxUrl, sandboxProvider.api_key_env, env),
  ];
  return {
    status: summarizeStatus(checks),
    checkedAt,
    checks,
  };
}

async function automationSandboxCheck(): Promise<LocalCoreDoctorCheck> {
  try {
    const capability = await new AnthropicSandboxRunner().probe();
    return {
      id: 'automation.sandbox',
      label: 'Automation script sandbox',
      status: capability.available ? 'pass' : 'fail',
      summary: capability.available
        ? `Anthropic Sandbox Runtime is available on ${capability.platform}.`
        : `Automation scripts are blocked on ${capability.platform}; missing ${capability.missing.join(', ')}.`,
    };
  } catch (error) {
    return {
      id: 'automation.sandbox',
      label: 'Automation script sandbox',
      status: 'fail',
      summary: error instanceof Error ? error.message : String(error),
    };
  }
}

function dockerSocketCheck(profileId: string): LocalCoreDoctorCheck {
  if (profileId === 'docker-compose') {
    return {
      id: 'docker.socket',
      label: 'Docker socket',
      status: 'pass',
      summary: 'Docker Compose delegates Docker access to OpenSandbox.',
    };
  }
  const socketPath = '/var/run/docker.sock';
  const ok = existsSync(socketPath);
  return {
    id: 'docker.socket',
    label: 'Docker socket',
    status: ok ? 'pass' : 'warn',
    summary: ok ? `${socketPath} is available.` : `${socketPath} is not visible to Core.`,
  };
}

function workspacePathCheck(config: DesktopConnectConfig, profileId: string): LocalCoreDoctorCheck {
  const projects = Array.isArray(config.projects) ? config.projects : [];
  const missing = projects
    .map((project) => ({
      name: project.name,
      workDir: String(project.agent?.options?.work_dir || '').trim(),
      sandboxEnabled: Boolean(project.agent?.options?.sandbox?.enabled),
    }))
    .filter((project) => !(profileId === 'docker-compose' && project.sandboxEnabled))
    .filter((project) => project.workDir && !existsSync(project.workDir));
  if (missing.length > 0) {
    return {
      id: 'workspace.paths',
      label: 'Workspace paths',
      status: 'warn',
      summary: `${missing.length} configured workspace path(s) are not visible to Core.`,
    };
  }
  if (profileId === 'docker-compose' && projects.some((project) => project.agent?.options?.sandbox?.enabled)) {
    return {
      id: 'workspace.paths',
      label: 'Workspace paths',
      status: 'pass',
      summary: 'Sandbox workspace host paths are delegated to OpenSandbox.',
    };
  }
  return {
    id: 'workspace.paths',
    label: 'Workspace paths',
    status: 'pass',
    summary: projects.length > 0 ? `${projects.length} workspace path(s) checked.` : 'No projects configured.',
  };
}

function allowlistCheck(config: DesktopConnectConfig, env: NodeJS.ProcessEnv): LocalCoreDoctorCheck {
  const allowlist = String(env.OPEN_SANDBOX_HOST_MOUNT_ALLOWLIST || '')
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (allowlist.length === 0) {
    return {
      id: 'opensandbox.allowlist',
      label: 'OpenSandbox mount allowlist',
      status: 'warn',
      summary: 'OPEN_SANDBOX_HOST_MOUNT_ALLOWLIST is not set.',
    };
  }
  const projects = Array.isArray(config.projects) ? config.projects : [];
  const denied = projects.filter((project) => {
    const workDir = String(project.agent?.options?.work_dir || '').trim().replace(/\/+$/, '');
    return workDir && !allowlist.some((root) => workDir === root || workDir.startsWith(`${root}/`));
  });
  return {
    id: 'opensandbox.allowlist',
    label: 'OpenSandbox mount allowlist',
    status: denied.length > 0 ? 'warn' : 'pass',
    summary: denied.length > 0
      ? `${denied.length} project workspace path(s) are outside the allowlist.`
      : `Allowlist covers configured workspace paths: ${allowlist.join(', ')}.`,
  };
}

function sandboxImageCheck(config: DesktopConnectConfig): LocalCoreDoctorCheck {
  const images = Array.isArray(config.sandbox_runtime_images) ? config.sandbox_runtime_images : [];
  const missing = images.filter((image) => !String(image.image || '').trim());
  return {
    id: 'sandbox.images',
    label: 'Sandbox images',
    status: missing.length > 0 ? 'fail' : 'pass',
    summary: images.length > 0 ? `${images.length} sandbox image registration(s) configured.` : 'No sandbox image registrations configured.',
  };
}

async function opensandboxHealthCheck(
  serverUrl: string,
  apiKeyEnv: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<LocalCoreDoctorCheck> {
  if (!serverUrl) {
    return {
      id: 'opensandbox.health',
      label: 'OpenSandbox health',
      status: 'fail',
      summary: 'OpenSandbox server URL is empty.',
    };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const apiKey = apiKeyEnv ? env[apiKeyEnv] : undefined;
    const response = await fetch(`${serverUrl}/health`, {
      signal: controller.signal,
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
    });
    clearTimeout(timer);
    return {
      id: 'opensandbox.health',
      label: 'OpenSandbox health',
      status: response.ok ? 'pass' : 'fail',
      summary: `GET ${serverUrl}/health returned HTTP ${response.status}.`,
    };
  } catch (error) {
    return {
      id: 'opensandbox.health',
      label: 'OpenSandbox health',
      status: 'fail',
      summary: error instanceof Error ? error.message : String(error),
    };
  }
}

function normalizeUrl(value: string) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function summarizeStatus(checks: LocalCoreDoctorCheck[]): LocalCoreDoctorResult['status'] {
  if (checks.some((check) => check.status === 'fail')) {
    return 'fail';
  }
  if (checks.some((check) => check.status === 'warn')) {
    return 'warn';
  }
  return 'pass';
}
