import { delimiter, win32 } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import type { DesktopBridgeEvent } from '@cc/superai-contracts';
import { LocalCoreAcpStore } from './local-core-acp-store.js';
import { LocalCoreAcpTransport } from './local-core-acp-transport.js';
import type { AcpSessionState, LocalCoreProjectConfig } from '../router/workspace-router-types.js';
import { getChannelPlatformBase, getChannelPlatformInstanceId, routeTypeForPlatform } from '../scheduler/scheduled-job-route.js';
import { getPathEnv } from '../runtime/env-utils.js';
import type { AgentMcpServerConfig } from '@cc/plugin-sdk';

type AcpWireMcpServer = {
  name: string;
  type: AgentMcpServerConfig['type'];
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
};

// The ACP session/new|load `mcpServers` field takes the wire shape only — the
// local `enabled` flag is filtered out before the list leaves Local AI Core.
function toAcpMcpServers(config: LocalCoreProjectConfig): AcpWireMcpServer[] {
  return (config.mcpServers || [])
    .filter((server) => server.enabled !== false)
    .map((server) => {
      const wire: AcpWireMcpServer = { name: server.name, type: server.type };
      if (server.command) wire.command = server.command;
      if (server.args && server.args.length > 0) wire.args = server.args;
      if (server.env && Object.keys(server.env).length > 0) wire.env = server.env;
      if (server.url) wire.url = server.url;
      if (server.headers && Object.keys(server.headers).length > 0) wire.headers = server.headers;
      return wire;
    });
}

type LocalCoreAcpSessionCoordinatorOptions = {
  store: LocalCoreAcpStore;
  transport: LocalCoreAcpTransport;
  runThreadMap: Map<string, string>;
  cliBinDir?: string;
  localCoreBase?: string;
  emitBridge: (event: DesktopBridgeEvent) => void;
  log?: (message: string) => void;
};

type EnsureSessionOptions = {
  permissionMode?: string;
  runtimeEnv?: Record<string, string>;
  runId?: string;
};

export class LocalCoreAcpSessionCoordinator {
  private readonly sessions = new Map<string, AcpSessionState>();

  constructor(private readonly options: LocalCoreAcpSessionCoordinatorOptions) {}

  getSession(threadId: string) {
    return this.sessions.get(threadId);
  }

  closeAll() {
    for (const session of this.sessions.values()) {
      this.clearIdleClose(session);
      this.options.transport.closeSession(session);
    }
    this.sessions.clear();
  }

  closeThreadSession(threadId: string) {
    const session = this.sessions.get(threadId);
    if (!session) {
      return;
    }
    this.clearIdleClose(session);
    this.options.transport.closeSession(session);
    this.sessions.delete(threadId);
  }

  releaseThreadSession(threadId: string, config: LocalCoreProjectConfig) {
    if (!config.sandbox?.enabled || config.sandbox.lifecycle === 'per_run' || config.sandbox.stateScope === 'run') {
      this.closeThreadSession(threadId);
      return;
    }
    const session = this.sessions.get(threadId);
    if (!session || session.closed) {
      return;
    }
    this.scheduleIdleClose(session, config.sandbox.idleSeconds);
  }

  async ensureSession(
    threadId: string,
    bridgeSessionKey: string,
    config: LocalCoreProjectConfig,
    options: EnsureSessionOptions = {},
  ) {
    const existing = this.sessions.get(threadId);
    const permissionMode = this.resolveLaunchPermissionMode(threadId, options.permissionMode);
    const configKey = this.buildLaunchConfigKey(config);
    const runtimeEnvKey = this.buildRuntimeEnvKey(options.runtimeEnv);
    if (
      existing
      && !existing.closed
      && existing.sessionId
      && existing.launchPermissionMode === permissionMode
      && existing.launchConfigKey === configKey
      && existing.launchRuntimeEnvKey === runtimeEnvKey
    ) {
      this.clearIdleClose(existing);
      this.options.log?.(`[acp.session:${threadId}] reuse existing session mode=${config.sandbox?.enabled ? 'sandbox' : 'local'}`);
      return existing;
    }
    if (existing) {
      this.closeThreadSession(threadId);
    }
    const startedAt = Date.now();
    this.options.log?.(`[acp.session:${threadId}] spawn mode=${config.sandbox?.enabled ? 'sandbox' : 'local'} transport=${config.execution?.transport || 'stdio'}`);
    const baseEnv = {
      ...process.env,
      ...config.env,
    };
    const session = this.options.transport.spawnSession({
      threadId,
      bridgeSessionKey,
      config,
      runtimeEnv: this.buildAgentRuntimeEnv(threadId, getPathEnv(baseEnv), options.runtimeEnv, options.runId),
    });
    session.launchPermissionMode = permissionMode;
    session.launchConfigKey = configKey;
    session.launchRuntimeEnvKey = runtimeEnvKey;
    this.sessions.set(threadId, session);
    await this.options.transport.initializeSession(session);
    this.options.log?.(`[acp.session:${threadId}] initialize done in ${Date.now() - startedAt}ms`);
    const row = this.options.store.getThreadRow(threadId);
    const providerKey = this.buildSessionProviderKey(config);
    const hasProviderMismatch = Boolean(
      row?.acp_launch_config_key && row.acp_launch_config_key !== providerKey,
    );
    if (hasProviderMismatch && row?.acp_session_id) {
      this.options.log?.(
        `[acp.session:${threadId}] provider configuration mismatch (stored=${row.acp_launch_config_key} current=${providerKey}); ` +
        `discarding stale session ${row.acp_session_id} to prevent provider/model pollution`,
      );
    }
    if (row?.acp_session_id && row.acp_supports_load && session.supportsLoad && !hasProviderMismatch) {
      try {
        session.loadReplayMode = true;
        await this.options.transport.request(session, 'session/load', {
          sessionId: row.acp_session_id,
          cwd: acpSessionCwd(config),
          mcpServers: toAcpMcpServers(config),
        }, 30000);
        session.sessionId = row.acp_session_id;
      } catch (error) {
        this.options.log?.(`ACP loadSession failed for ${threadId}; creating a fresh session instead: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        session.loadReplayMode = false;
      }
    }
    if (!session.sessionId) {
      try {
        const created = await this.options.transport.request(session, 'session/new', {
          cwd: acpSessionCwd(config),
          mcpServers: toAcpMcpServers(config),
          _meta: this.buildSessionMeta(threadId, permissionMode),
        }, 30000) as { id?: string; sessionId?: string; session_id?: string; session?: { id?: string; sessionId?: string; session_id?: string } };
        session.sessionId = String(created.sessionId || created.session_id || created.id || created.session?.sessionId || created.session?.session_id || created.session?.id || '').trim();
        if (!session.sessionId) {
          throw new Error('ACP session/new did not return a sessionId');
        }
        this.options.store.updateThreadSession(threadId, session.sessionId, session.supportsLoad, providerKey);
        this.options.log?.(`[acp.session:${threadId}] session/new done in ${Date.now() - startedAt}ms`);
      } catch (error) {
        this.closeThreadSession(threadId);
        throw error;
      }
    } else if (!row?.acp_launch_config_key) {
      this.options.store.updateThreadSession(threadId, session.sessionId, session.supportsLoad, providerKey);
    }
    this.options.log?.(`[acp.session:${threadId}] ready in ${Date.now() - startedAt}ms`);
    return session;
  }

  async setThreadMode(threadId: string, mode: string) {
    const session = this.sessions.get(threadId);
    if (!session || session.closed || !session.sessionId) {
      return;
    }
    await this.options.transport.request(session, 'session/set_mode', {
      sessionId: session.sessionId,
      modeId: mode,
    }, 30000);
  }

  async interruptRun(runId: string): Promise<{ interrupted: boolean }> {
    const threadId = this.options.runThreadMap.get(runId);
    if (!threadId) {
      return { interrupted: false };
    }
    const run = this.options.store.getRun(runId);
    if (run && ['completed', 'failed', 'interrupted'].includes(run.status)) {
      return { interrupted: false };
    }
    const session = this.sessions.get(threadId);
    if (!session) {
      this.markRunInterrupted(runId, threadId);
      return { interrupted: false };
    }
    if (session.currentRunId && session.currentRunId !== runId) {
      this.markRunInterrupted(runId, threadId);
      return { interrupted: false };
    }
    if (!session.sessionId) {
      this.markRunInterrupted(runId, threadId);
      this.closeThreadSession(threadId);
      return { interrupted: false };
    }
    if (!session.currentRunId) {
      this.markRunInterrupted(runId, threadId);
      return { interrupted: false };
    }
    const pendingPermission = session.pendingPermissionByRun.get(runId);
    if (pendingPermission) {
      this.options.transport.sendRaw(session, {
        jsonrpc: '2.0',
        id: pendingPermission.requestId,
        result: {
          outcome: {
            outcome: 'cancelled',
          },
        },
      });
      session.pendingPermissionByRun.delete(runId);
    }
    const cancelled = this.options.transport.sendRaw(session, {
      jsonrpc: '2.0',
      method: 'session/cancel',
      params: {
        sessionId: session.sessionId,
      },
    });
    if (!cancelled) {
      this.markRunInterrupted(runId, threadId);
      return { interrupted: false };
    }
    this.markRunInterrupted(runId, threadId);
    return { interrupted: true };
  }

  private markRunInterrupted(runId: string, threadId: string) {
    this.options.store.updateRun(runId, threadId, 'interrupted');
    const task = this.options.store.getAgentTaskByRunId(runId);
    if (task) {
      this.options.store.updateAgentTask(task.taskId, {
        status: 'cancelled',
        summary: 'Request cancelled.',
      });
    }
  }

  handleTransportSessionClosed(session: AcpSessionState, error: Error) {
    if (session.closed) {
      return;
    }
    const activeRunId = session.currentRunId;
    this.clearIdleClose(session);
    this.options.transport.closeSessionWithError(session, error);
    if (activeRunId) {
      this.options.store.updateRun(activeRunId, session.threadId, 'failed');
      this.options.emitBridge({
        type: 'typing_stop',
        sessionKey: session.bridgeSessionKey,
        replyCtx: activeRunId,
      });
      session.pendingPermissionByRun.delete(activeRunId);
    }
    if (this.sessions.get(session.threadId) === session) {
      this.sessions.delete(session.threadId);
    }
  }

  private scheduleIdleClose(session: AcpSessionState, idleSeconds: number) {
    this.clearIdleClose(session);
    const seconds = Number.isFinite(idleSeconds) && idleSeconds > 0 ? idleSeconds : 900;
    this.options.log?.(`[acp.session:${session.threadId}] keep sandbox session warm for ${seconds}s`);
    session.idleCloseTimer = setTimeout(() => {
      if (this.sessions.get(session.threadId) === session && !session.closed && !session.currentRunId) {
        this.options.log?.(`[acp.session:${session.threadId}] idle timeout reached; closing sandbox session`);
        this.closeThreadSession(session.threadId);
      }
    }, seconds * 1000);
    session.idleCloseTimer.unref?.();
  }

  private clearIdleClose(session: AcpSessionState) {
    if (session.idleCloseTimer) {
      clearTimeout(session.idleCloseTimer);
      session.idleCloseTimer = undefined;
    }
  }

  private buildRuntimeEnvKey(runtimeEnv: Record<string, string> = {}) {
    return Object.keys(runtimeEnv)
      .sort()
      .map((key) => `${key}=${runtimeEnv[key]}`)
      .join('\n');
  }

  private buildAgentRuntimeEnv(threadId: string, existingPath: string, runtimeEnv: Record<string, string> = {}, runId = '') {
    const row = this.options.store.getThreadRow(threadId);
    if (!row) {
      return {};
    }
    const binding = this.options.store.getPlatformThreadBindingByThreadId(threadId);
    const env: Record<string, string> = {
      LOCAL_AI_CORE_BASE: this.options.localCoreBase || 'http://127.0.0.1:9831/api/local/v1',
      LOCAL_AI_WORKSPACE_ID: row.workspace_id,
      LOCAL_AI_THREAD_ID: threadId,
      ...(runId ? { AGENTDOCK_SANDBOX_RUN_ID: runId } : {}),
    };
    const workspace = this.options.store.getWorkspaceRegistryEntry(row.workspace_id);
    if (workspace?.path) {
      env.LOCAL_AI_WORKSPACE_PATH = workspace.path;
    }
    if (binding) {
      env.LOCAL_AI_PLATFORM = getChannelPlatformBase(binding.platform);
      env.LOCAL_AI_ROUTE_TYPE = routeTypeForPlatform(binding.platform);
      const instanceId = getChannelPlatformInstanceId(binding.platform);
      if (instanceId) {
        env.LOCAL_AI_PLATFORM_INSTANCE_ID = instanceId;
      }
      env.LOCAL_AI_CHAT_ID = binding.chat_id;
      env.LOCAL_AI_PLATFORM_USER_ID = binding.platform_user_id;
    }
    if (this.options.cliBinDir) {
      env.PATH = buildAgentPath(existingPath, this.options.cliBinDir);
    } else {
      env.PATH = buildAgentPath(existingPath);
    }
    return {
      ...env,
      ...runtimeEnv,
    };
  }

  private buildLaunchConfigKey(config: LocalCoreProjectConfig) {
    return JSON.stringify({
      agentType: config.agentType,
      workDir: config.workDir,
      command: config.command,
      args: config.args || [],
      env: config.env || {},
      model: config.model || '',
      execution: config.execution || null,
      sandbox: config.sandbox || null,
      mcpServers: toAcpMcpServers(config),
    });
  }

  private buildSessionProviderKey(config: LocalCoreProjectConfig) {
    const env = config.env || {};
    return JSON.stringify({
      agentType: config.agentType,
      model: config.model || '',
      baseUrl: env.OPENAI_BASE_URL || env.HERMES_BASE_URL || env.ANTHROPIC_BASE_URL || '',
      apiKey: env.OPENAI_API_KEY || env.HERMES_API_KEY || env.ANTHROPIC_API_KEY || '',
    });
  }

  private resolveLaunchPermissionMode(threadId: string, permissionModeOverride = '') {
    const row = this.options.store.getThreadRow(threadId);
    const mode = String(permissionModeOverride || row?.agent_mode || '').trim();
    return !mode || mode === 'default' ? '' : mode;
  }

  private buildSessionMeta(threadId: string, permissionModeOverride = '') {
    const mode = this.resolveLaunchPermissionMode(threadId, permissionModeOverride);
    return {
      claudeCode: {
        emitRawSDKMessages: [
          { type: 'system', subtype: 'local_command_output' },
        ],
        ...(mode
          ? {
              options: {
                permissionMode: mode,
              },
            }
          : {}),
      },
    };
  }
}

function acpSessionCwd(config: LocalCoreProjectConfig) {
  return config.sandbox?.enabled ? config.sandbox.workspaceMountPath : config.workDir;
}

type BuildAgentPathOptions = {
  platform?: NodeJS.Platform;
  pathExists?: (path: string) => boolean;
};

export function buildAgentPath(existingPath: string, cliBinDir?: string, options: BuildAgentPathOptions = {}) {
  const platform = options.platform || process.platform;
  const pathDelimiter = platform === 'win32' ? ';' : delimiter;
  const entries = [
    cliBinDir,
    ...userBinDirs(platform),
    ...windowsGitBashDirs(existingPath, platform, options.pathExists || existsSync),
    ...String(existingPath || '').split(pathDelimiter),
  ];
  const seen = new Set<string>();
  return entries
    .map((entry) => String(entry || '').trim())
    .filter((entry) => {
      if (!entry || seen.has(entry)) {
        return false;
      }
      seen.add(entry);
      return true;
    })
    .join(pathDelimiter);
}

function userBinDirs(platform: NodeJS.Platform) {
  if (platform === 'win32') {
    return [];
  }
  const home = process.env.HOME || homedir();
  return home ? [`${home}/.local/bin`, `${home}/bin`] : [];
}

function windowsGitBashDirs(existingPath: string, platform: NodeJS.Platform, pathExists: (path: string) => boolean) {
  if (platform !== 'win32') {
    return [];
  }
  const pathEntries = String(existingPath || '')
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const gitRoots = new Set<string>();
  for (const entry of pathEntries) {
    const normalized = win32.normalize(entry).replace(/[\\/]+$/, '');
    const base = win32.basename(normalized).toLowerCase();
    const parent = win32.dirname(normalized);
    const parentBase = win32.basename(parent).toLowerCase();
    const grandParent = win32.dirname(parent);
    if (base === 'cmd' && parentBase === 'git') {
      gitRoots.add(parent);
    } else if (base === 'bin' && parentBase === 'git') {
      gitRoots.add(parent);
    } else if (base === 'bin' && parentBase === 'usr' && win32.basename(grandParent).toLowerCase() === 'git') {
      gitRoots.add(grandParent);
    }
  }
  for (const root of ['C:\\Program Files\\Git', 'C:\\Program Files (x86)\\Git', 'D:\\Program Files\\Git']) {
    gitRoots.add(root);
  }
  const dirs: string[] = [];
  for (const root of gitRoots) {
    const binDir = win32.join(root, 'bin');
    if (pathExists(win32.join(binDir, 'bash.exe'))) {
      dirs.push(binDir);
    }
    const usrBinDir = win32.join(root, 'usr', 'bin');
    if (pathExists(win32.join(usrBinDir, 'bash.exe'))) {
      dirs.push(usrBinDir);
    }
  }
  return dirs;
}
