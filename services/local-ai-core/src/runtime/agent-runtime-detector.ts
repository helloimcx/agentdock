import { constants, existsSync, accessSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import type { DesktopConnectConfig, InstalledAgentRuntime } from '../../../../packages/contracts/src/index.js';
import {
  DESKTOP_AGENT_TYPE_OPTIONS,
  DESKTOP_CLAUDECODE_ACP_PACKAGE,
  LOCALCORE_ACP_AGENT_TYPE,
} from '../../../../shared/desktop.js';

export interface AgentRuntimeDetectionOptions {
  env?: NodeJS.ProcessEnv;
  config?: DesktopConnectConfig | null;
  requireFrom?: string;
  now?: Date;
  versionTimeoutMs?: number;
}

const DISPLAY_NAMES: Record<string, string> = {
  opencode: 'OpenCode',
  codex: 'Codex',
  claudecode: 'Claude Code',
  cursor: 'Cursor',
  gemini: 'Gemini',
  qoder: 'Qoder',
  iflow: 'iFlow',
  [LOCALCORE_ACP_AGENT_TYPE]: 'LocalCore ACP',
};

const COMMAND_CANDIDATES: Record<string, string[]> = {
  opencode: ['opencode'],
  codex: ['codex'],
  claudecode: ['claude-agent-acp'],
  cursor: ['cursor-agent', 'cursor'],
  gemini: ['gemini'],
  qoder: ['qoder'],
  iflow: ['iflow'],
};

const VERSION_ARGUMENTS: Record<string, string[]> = {
  opencode: ['--version'],
  codex: ['--version'],
  claudecode: ['--version'],
  cursor: ['--version'],
  gemini: ['--version'],
  qoder: ['--version'],
  iflow: ['--version'],
};

export function detectInstalledAgentRuntimes(
  options: AgentRuntimeDetectionOptions = {},
): InstalledAgentRuntime[] {
  const env = options.env || process.env;
  const configuredCommands = collectConfiguredAgentCommands(options.config);
  const detectedAt = (options.now || new Date()).toISOString();
  const versionTimeoutMs = options.versionTimeoutMs ?? 2500;
  return DESKTOP_AGENT_TYPE_OPTIONS.map((agentType) => {
    if (agentType === LOCALCORE_ACP_AGENT_TYPE) {
      return {
        agentType,
        runtimeId: agentType,
        displayName: displayName(agentType),
        status: 'installed',
        installed: true,
        detectedAt,
        summary: `${displayName(agentType)} is built in.`,
        issues: [],
        recommendedActions: [],
        source: 'builtin' as const,
      };
    }

    const configured = configuredCommands.get(agentType);
    if (configured) {
      const resolved = resolveCommand(configured, env);
      return resolved
        ? installedRuntime(agentType, resolved, 'config', detectedAt, env, versionTimeoutMs)
        : missingRuntime(agentType, detectedAt, `Configured command not found: ${configured}`);
    }

    if (agentType === 'claudecode') {
      const bundled = resolveBundledClaudeAgentAcp(options.requireFrom);
      if (bundled) {
        return installedRuntime(agentType, bundled, 'bundled', detectedAt, env, versionTimeoutMs);
      }
    }

    for (const command of COMMAND_CANDIDATES[agentType] || [agentType]) {
      const resolved = resolveCommand(command, env);
      if (resolved) {
        return installedRuntime(agentType, resolved, 'path', detectedAt, env, versionTimeoutMs);
      }
    }

    return missingRuntime(agentType, detectedAt);
  });
}

function installedRuntime(
  agentType: string,
  command: string,
  source: InstalledAgentRuntime['source'],
  detectedAt: string,
  env: NodeJS.ProcessEnv,
  versionTimeoutMs: number,
): InstalledAgentRuntime {
  const versionResult = detectRuntimeVersion(agentType, command, env, versionTimeoutMs);
  const issues = versionResult.issue ? [versionResult.issue] : [];
  return {
    agentType,
    runtimeId: agentType,
    displayName: displayName(agentType),
    status: 'installed',
    installed: true,
    command,
    binaryPath: command,
    version: versionResult.version,
    detectedAt,
    summary: versionResult.version
      ? `${displayName(agentType)} ${versionResult.version} is installed.`
      : `${displayName(agentType)} is installed.`,
    details: issues[0]?.message,
    issues,
    recommendedActions: [],
    source,
  };
}

function missingRuntime(agentType: string, detectedAt: string, error?: string): InstalledAgentRuntime {
  const name = displayName(agentType);
  return {
    agentType,
    runtimeId: agentType,
    displayName: name,
    status: error ? 'error' : 'not_installed',
    installed: false,
    detectedAt,
    summary: error || `${name} was not found on PATH or in project configuration.`,
    details: error,
    issues: [
      {
        code: error ? 'configured_command_not_found' : 'runtime_not_found',
        severity: error ? 'error' : 'info',
        message: error || `${name} is not installed or is not available on PATH.`,
        help: error
          ? 'Update the project runtime command or make the configured binary executable.'
          : 'Install the runtime manually, then refresh detection.',
      },
    ],
    recommendedActions: [
      {
        label: error ? 'Fix configured command' : `Install ${name}`,
        description: error
          ? 'Check the workspace agent command path in configuration.'
          : `Install ${name} manually and make sure its command is available on PATH.`,
      },
    ],
    source: 'path',
    error,
  };
}

function displayName(agentType: string) {
  return DISPLAY_NAMES[agentType] || agentType;
}

function collectConfiguredAgentCommands(config?: DesktopConnectConfig | null) {
  const commands = new Map<string, string>();
  for (const project of Array.isArray(config?.projects) ? config.projects : []) {
    const agentType = String(project?.agent?.type || '').trim().toLowerCase();
    const command = String(project?.agent?.options?.command || '').trim();
    if (agentType && command && !commands.has(agentType)) {
      commands.set(agentType, command);
    }
  }
  return commands;
}

function resolveCommand(command: string, env: NodeJS.ProcessEnv) {
  const normalized = command.trim();
  if (!normalized) {
    return null;
  }
  if (isAbsolute(normalized) || normalized.includes('/') || normalized.includes('\\')) {
    return isExecutableFile(normalized) ? normalized : null;
  }

  for (const dir of String(env.PATH || '').split(delimiter).filter(Boolean)) {
    for (const candidate of commandCandidates(normalized, env)) {
      const fullPath = join(dir, candidate);
      if (isExecutableFile(fullPath)) {
        return fullPath;
      }
    }
  }
  return null;
}

function commandCandidates(command: string, env: NodeJS.ProcessEnv) {
  if (process.platform !== 'win32' || /\.[a-z0-9]+$/i.test(command)) {
    return [command];
  }
  const extensions = String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((ext) => ext.trim())
    .filter(Boolean);
  return [command, ...extensions.map((ext) => `${command}${ext}`)];
}

function isExecutableFile(path: string) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function detectRuntimeVersion(
  agentType: string,
  command: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Pick<InstalledAgentRuntime, 'version'> & { issue?: InstalledAgentRuntime['issues'][number] } {
  const args = VERSION_ARGUMENTS[agentType];
  if (!args || agentType === LOCALCORE_ACP_AGENT_TYPE) {
    return {};
  }

  try {
    const output = execFileSync(command, args, {
      env,
      timeout: timeoutMs,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { version: parseVersionOutput(output) };
  } catch (err: any) {
    const timedOut = err?.code === 'ETIMEDOUT' || err?.signal === 'SIGTERM';
    return {
      issue: {
        code: timedOut ? 'version_detection_timeout' : 'version_detection_failed',
        severity: 'warning',
        message: timedOut
          ? `${displayName(agentType)} was found, but version detection timed out.`
          : `${displayName(agentType)} was found, but its version could not be detected.`,
        help: 'Installation detection remains valid because the executable was resolved.',
      },
    };
  }
}

function parseVersionOutput(output: string) {
  const text = output.trim().split(/\r?\n/).find(Boolean) || '';
  const match = text.match(/\d+(?:\.\d+)+(?:[-+._a-zA-Z0-9]*)?/);
  return match?.[0] || text || undefined;
}

function resolveBundledClaudeAgentAcp(requireFrom?: string) {
  try {
    const require = createRequire(requireFrom || join(process.cwd(), 'package.json'));
    const packageJsonPath = require.resolve(`${DESKTOP_CLAUDECODE_ACP_PACKAGE}/package.json`);
    const packageDir = dirname(packageJsonPath);
    for (const candidate of [
      join(packageDir, 'dist', 'cli.js'),
      join(packageDir, 'bin', 'claude-agent-acp.js'),
      join(packageDir, 'cli.js'),
    ]) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    return packageJsonPath;
  } catch {
    return null;
  }
}
