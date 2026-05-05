import { spawn } from 'node:child_process';
import type { DesktopBridgeEvent } from '../../../../packages/contracts/src/index.js';
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
    const child = spawn(input.config.command, input.config.args, {
      cwd: input.config.workDir,
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
      this.options.onSessionClosed(
        session,
        new Error(`ACP agent exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}`),
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
        reject(new Error(`Timed out waiting for ACP ${method} after ${timeoutMs}ms`));
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
          pending.reject(new Error(payload.error.message || `ACP request failed: ${payload.id}`));
        } else {
          pending.resolve(payload.result);
        }
      }
    }
  }

  private handlePipeFailure(session: AcpSessionState, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.options.log?.(`[localcore-acp:${session.threadId}] stdin failure: ${message}`);
    this.options.onSessionClosed(session, new Error(message));
  }
}
