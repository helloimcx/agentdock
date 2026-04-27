import { constants, existsSync, accessSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { createRequire } from 'node:module';
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

export function detectInstalledAgentRuntimes(
  options: AgentRuntimeDetectionOptions = {},
): InstalledAgentRuntime[] {
  const env = options.env || process.env;
  const configuredCommands = collectConfiguredAgentCommands(options.config);
  return DESKTOP_AGENT_TYPE_OPTIONS.map((agentType) => {
    if (agentType === LOCALCORE_ACP_AGENT_TYPE) {
      return {
        agentType,
        displayName: displayName(agentType),
        installed: true,
        source: 'builtin' as const,
      };
    }

    const configured = configuredCommands.get(agentType);
    if (configured) {
      const resolved = resolveCommand(configured, env);
      return resolved
        ? installedRuntime(agentType, resolved, 'config')
        : missingRuntime(agentType, `Configured command not found: ${configured}`);
    }

    if (agentType === 'claudecode') {
      const bundled = resolveBundledClaudeAgentAcp(options.requireFrom);
      if (bundled) {
        return installedRuntime(agentType, bundled, 'bundled');
      }
    }

    for (const command of COMMAND_CANDIDATES[agentType] || [agentType]) {
      const resolved = resolveCommand(command, env);
      if (resolved) {
        return installedRuntime(agentType, resolved, 'path');
      }
    }

    return missingRuntime(agentType);
  });
}

function installedRuntime(
  agentType: string,
  command: string,
  source: InstalledAgentRuntime['source'],
): InstalledAgentRuntime {
  return {
    agentType,
    displayName: displayName(agentType),
    installed: true,
    command,
    source,
  };
}

function missingRuntime(agentType: string, error?: string): InstalledAgentRuntime {
  return {
    agentType,
    displayName: displayName(agentType),
    installed: false,
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
