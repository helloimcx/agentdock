import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { DesktopBridgeEvent, LocalCoreErrorCode } from '@cc/superai-contracts';
import { LocalCoreError } from '../kernel/local-core-errors.js';
import type {
  AcpSessionState,
  LocalCoreProjectConfig,
} from '../router/workspace-router-types.js';

type JsonRpcPayload = Record<string, unknown>;

type SpawnSessionInput = {
  threadId: string;
  bridgeSessionKey: string;
  config: LocalCoreProjectConfig;
  runtimeEnv: Record<string, string>;
};

type LocalCoreAcpTransportOptions = {
  log?: (message: string) => void;
  onAgentRequest: (session: AcpSessionState, payload: any) => void;
  onAgentNotification: (session: AcpSessionState, payload: any) => void;
  onSessionClosed: (session: AcpSessionState, error: Error) => void;
};

export class LocalCoreAcpTransport {
  constructor(private readonly options: LocalCoreAcpTransportOptions) {}

  spawnSession(input: SpawnSessionInput) {
    const baseEnv = {
      ...process.env,
      ...input.config.env,
    };
    const cwd = resolveTransportCwd(input.config);
    const child = spawn(input.config.command, input.config.args, {
      cwd,
      env: {
        ...baseEnv,
        ...input.runtimeEnv,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const session: AcpSessionState = {
      child,
      requestId: 0,
      stdoutBuffer: '',
      pending: new Map(),
      sessionId: '',
      supportsLoad: false,
      workspaceId: input.config.workspaceId,
      threadId: input.threadId,
      bridgeSessionKey: input.bridgeSessionKey,
      currentRunId: null,
      currentTurn: null,
      loadReplayMode: false,
      pendingPermissionByRun: new Map(),
      schedulerJobCreatedByRun: new Map(),
      pendingRawAssistantProgressChunks: [],
      closed: false,
      closeReason: null,
      promptPromise: null,
      launchPermissionMode: '',
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.handleStdout(session, chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.options.log?.(`[localcore-acp:${input.threadId}] ${chunk.trimEnd()}`);
    });
    child.stdin.on('error', (error) => {
      this.handlePipeFailure(session, error);
    });
    child.on('exit', (code, signal) => {
      if (session.closed) {
        return;
      }
      this.options.onSessionClosed(
        session,
        new LocalCoreError(
          'runtime_exited',
          `ACP agent exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}`,
          {
            details: {
              code: code ?? 'unknown',
              signal: signal || '',
              threadId: input.threadId,
              runtimeId: input.config.agentType,
            },
          },
        ),
      );
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      this.options.onSessionClosed(
        session,
        error.code === 'ENOENT'
          ? new LocalCoreError('runtime_not_found', `ACP agent command not found: ${input.config.command}`, {
              details: {
                command: input.config.command,
                cwd,
                threadId: input.threadId,
                runtimeId: input.config.agentType,
              },
            })
          : new LocalCoreError('runtime_start_failed', `ACP agent failed to start: ${error.message}`, {
              cause: error.code,
              details: {
                command: input.config.command,
                cwd,
                threadId: input.threadId,
                runtimeId: input.config.agentType,
              },
            }),
      );
    });
    return session;
  }

  async initializeSession(session: AcpSessionState) {
    const initResult = await this.request(session, 'initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        fs: {
          readTextFile: false,
          writeTextFile: false,
        },
        terminal: false,
      },
      clientInfo: {
        name: 'agentdock',
        title: 'AgentDock',
        version: '0.1.0',
      },
    }, 30000) as {
      agentCapabilities?: { loadSession?: boolean };
    };
    session.supportsLoad = Boolean(initResult?.agentCapabilities?.loadSession);
  }

  request(session: AcpSessionState, method: string, params: unknown, timeoutMs = 30000) {
    session.requestId += 1;
    const id = session.requestId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        session.pending.delete(id);
        reject(new LocalCoreError('runtime_protocol_timeout', `Timed out waiting for ACP ${method} after ${timeoutMs}ms`, {
          details: {
            method,
            timeoutMs,
            threadId: session.threadId,
            runtimeId: session.currentTurn?.agentType || '',
          },
        }));
      }, timeoutMs);
      session.pending.set(id, {
        resolve: (value: any) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      if (!this.sendRaw(session, {
        jsonrpc: '2.0',
        id,
        method,
        params,
      })) {
        session.pending.delete(id);
        reject(new Error(session.closeReason || 'ACP session is not writable'));
      }
    });
  }

  sendRaw(session: AcpSessionState, payload: JsonRpcPayload) {
    if (session.closed || !session.child.stdin.writable) {
      return false;
    }
    try {
      session.child.stdin.write(`${JSON.stringify(payload)}\n`, (error?: Error | null) => {
        if (error) {
          this.handlePipeFailure(session, error);
        }
      });
      return true;
    } catch (error) {
      this.handlePipeFailure(session, error);
      return false;
    }
  }

  closeSession(session: AcpSessionState, reason = 'ACP session closed') {
    if (session.closed) {
      return;
    }
    session.closed = true;
    session.closeReason = reason;
    if (!session.child.killed) {
      session.child.kill('SIGTERM');
    }
  }

  closeSessionWithError(session: AcpSessionState, error: Error) {
    if (session.closed) {
      return;
    }
    session.closed = true;
    session.closeReason = error.message;
    for (const pending of session.pending.values()) {
      pending.reject(error);
    }
    session.pending.clear();
    if (!session.child.killed) {
      session.child.kill('SIGTERM');
    }
  }

  private handleStdout(session: AcpSessionState, chunk: string) {
    session.stdoutBuffer += chunk;
    while (session.stdoutBuffer.includes('\n')) {
      const newlineIndex = session.stdoutBuffer.indexOf('\n');
      const line = session.stdoutBuffer.slice(0, newlineIndex).trim();
      session.stdoutBuffer = session.stdoutBuffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }
      let payload: any;
      try {
        payload = JSON.parse(line);
      } catch (error) {
        this.options.log?.(`ACP stdout parse failed: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if (payload.method && payload.id !== undefined) {
        this.options.onAgentRequest(session, payload);
        continue;
      }
      if (payload.method) {
        this.options.onAgentNotification(session, payload);
        continue;
      }
      if (payload.id !== undefined) {
        const pending = session.pending.get(payload.id);
        if (!pending) {
          continue;
        }
        session.pending.delete(payload.id);
        if (payload.error) {
          pending.reject(new LocalCoreError(errorCodeForAcpError(payload.error), payload.error.message || `ACP request failed: ${payload.id}`, {
            details: {
              payloadId: payload.id,
              errorCode: payload.error.code,
              errorData: payload.error.data,
              threadId: session.threadId,
              runtimeId: session.currentTurn?.agentType || '',
            },
          }));
        } else {
          pending.resolve(payload.result);
        }
      }
    }
  }

  private handlePipeFailure(session: AcpSessionState, error: unknown) {
    if (session.closed) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    this.options.log?.(`[localcore-acp:${session.threadId}] stdin failure: ${message}`);
    this.options.onSessionClosed(session, new LocalCoreError('runtime_protocol_error', message, {
      details: {
        threadId: session.threadId,
        runtimeId: session.currentTurn?.agentType || '',
      },
    }));
  }
}

function resolveTransportCwd(config: LocalCoreProjectConfig) {
  if (config.sandbox?.enabled) {
    const proxyCwd = String(config.sandbox.proxyCwd || '').trim();
    if (proxyCwd && existsSync(proxyCwd)) {
      return proxyCwd;
    }
    return process.cwd();
  }
  return config.workDir;
}

function errorCodeForAcpError(error: { message?: unknown; data?: unknown }): LocalCoreErrorCode {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('authentication required') || message.includes('api key') || message.includes('oauth')) {
    return 'provider_auth_failed';
  }
  return 'runtime_protocol_error';
}
