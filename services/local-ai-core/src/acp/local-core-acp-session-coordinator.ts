import { delimiter } from 'node:path';
import type { DesktopBridgeEvent } from '../../../../packages/contracts/src/index.js';
import { LocalCoreAcpStore } from './local-core-acp-store.js';
import { LocalCoreAcpTransport } from './local-core-acp-transport.js';
import type { AcpSessionState, LocalCoreProjectConfig } from '../router/workspace-router-types.js';

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
};

export class LocalCoreAcpSessionCoordinator {
  private readonly sessions = new Map<string, AcpSessionState>();

  constructor(private readonly options: LocalCoreAcpSessionCoordinatorOptions) {}

  getSession(threadId: string) {
    return this.sessions.get(threadId);
  }

  closeAll() {
    for (const session of this.sessions.values()) {
      this.options.transport.closeSession(session);
    }
    this.sessions.clear();
  }

  closeThreadSession(threadId: string) {
    const session = this.sessions.get(threadId);
    if (!session) {
      return;
    }
    this.options.transport.closeSession(session);
    this.sessions.delete(threadId);
  }

  async ensureSession(
    threadId: string,
    bridgeSessionKey: string,
    config: LocalCoreProjectConfig,
    options: EnsureSessionOptions = {},
  ) {
    const existing = this.sessions.get(threadId);
    const permissionMode = this.resolveLaunchPermissionMode(threadId, options.permissionMode);
    if (
      existing
      && !existing.closed
      && existing.sessionId
      && existing.launchPermissionMode === permissionMode
    ) {
      return existing;
    }
    if (existing) {
      this.closeThreadSession(threadId);
    }
    const baseEnv = {
      ...process.env,
      ...config.env,
    };
    const session = this.options.transport.spawnSession({
      threadId,
      bridgeSessionKey,
      config,
      runtimeEnv: this.buildAgentRuntimeEnv(threadId, String(baseEnv.PATH || '')),
    });
    session.launchPermissionMode = permissionMode;
    this.sessions.set(threadId, session);
    await this.options.transport.initializeSession(session);
    const row = this.options.store.getThreadRow(threadId);
    if (row?.acp_session_id && row.acp_supports_load && session.supportsLoad) {
      try {
        session.loadReplayMode = true;
        await this.options.transport.request(session, 'session/load', {
          sessionId: row.acp_session_id,
          cwd: config.workDir,
          mcpServers: [],
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
          cwd: config.workDir,
          mcpServers: [],
          _meta: this.buildSessionMeta(threadId, permissionMode),
        }, 30000) as { id?: string; sessionId?: string; session_id?: string; session?: { id?: string; sessionId?: string; session_id?: string } };
        session.sessionId = String(created.sessionId || created.session_id || created.id || created.session?.sessionId || created.session?.session_id || created.session?.id || '').trim();
        if (!session.sessionId) {
          throw new Error('ACP session/new did not return a sessionId');
        }
        this.options.store.updateThreadSession(threadId, session.sessionId, session.supportsLoad);
      } catch (error) {
        this.closeThreadSession(threadId);
        throw error;
      }
    }
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
    const session = this.sessions.get(threadId);
    if (!session) {
      this.options.store.updateRun(runId, threadId, 'interrupted');
      return { interrupted: false };
    }
    if (!session.sessionId) {
      this.options.store.updateRun(runId, threadId, 'interrupted');
      this.closeThreadSession(threadId);
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
      this.options.store.updateRun(runId, threadId, 'interrupted');
      return { interrupted: false };
    }
    this.options.store.updateRun(runId, threadId, 'interrupted');
    return { interrupted: true };
  }

  handleTransportSessionClosed(session: AcpSessionState, error: Error) {
    if (session.closed) {
      return;
    }
    const activeRunId = session.currentRunId;
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

  private buildAgentRuntimeEnv(threadId: string, existingPath: string) {
    const row = this.options.store.getThreadRow(threadId);
    if (!row) {
      return {};
    }
    const binding = this.options.store.getPlatformThreadBindingByThreadId(threadId);
    const env: Record<string, string> = {
      LOCAL_AI_CORE_BASE: this.options.localCoreBase || 'http://127.0.0.1:9831/api/local/v1',
      LOCAL_AI_WORKSPACE_ID: row.workspace_id,
      LOCAL_AI_THREAD_ID: threadId,
    };
    const workspace = this.options.store.getWorkspaceRegistryEntry(row.workspace_id);
    if (workspace?.path) {
      env.LOCAL_AI_WORKSPACE_PATH = workspace.path;
    }
    if (binding) {
      env.LOCAL_AI_PLATFORM = binding.platform;
      env.LOCAL_AI_ROUTE_TYPE = 'lark_chat';
      env.LOCAL_AI_CHAT_ID = binding.chat_id;
      env.LOCAL_AI_PLATFORM_USER_ID = binding.platform_user_id;
    }
    if (this.options.cliBinDir) {
      env.PATH = existingPath
        ? `${this.options.cliBinDir}${delimiter}${existingPath}`
        : this.options.cliBinDir;
    }
    return env;
  }

  private resolveLaunchPermissionMode(threadId: string, permissionModeOverride = '') {
    const row = this.options.store.getThreadRow(threadId);
    const mode = String(permissionModeOverride || row?.agent_mode || '').trim();
    return !mode || mode === 'default' ? '' : mode;
  }

  private buildSessionMeta(threadId: string, permissionModeOverride = '') {
    const mode = this.resolveLaunchPermissionMode(threadId, permissionModeOverride);
    if (!mode) {
      return undefined;
    }
    return {
      claudeCode: {
        options: {
          permissionMode: mode,
        },
      },
    };
  }
}
