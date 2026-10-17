import type { AgentLaunchConfig } from '@cc/plugin-sdk';

type MeshExecute = (input: { nodeId: string; capability: string; args: Record<string, unknown>; timeoutMs?: number }) => Promise<any>;
type Session = {
  runId: string; nodeId: string; stopped: boolean; acquiring?: boolean;
  inFlight?: Promise<void>; timer?: ReturnType<typeof setTimeout>; stopping?: Promise<void>;
};
type Options = {
  execute?: MeshExecute;
  log?: (message: string) => void;
  onFailure: (runId: string, error: Error) => void;
  heartbeatMs?: number;
};

/** Core owns renewal; the device owns monotonic expiry when Core disappears. */
export class RemoteMeshScreenSessionManager {
  private readonly sessions = new Map<string, Session>();
  private closed = false;

  constructor(private readonly options: Options) {}

  async begin(runId: string, config: AgentLaunchConfig): Promise<boolean> {
    const execution = config.execution;
    if (!this.isAndroidMesh(execution)) return true;
    const nodeId = execution?.nodeId;
    this.assertCanBegin(runId, nodeId);
    const session: Session = { runId, nodeId, stopped: false };
    this.sessions.set(runId, session);
    return this.startSession(session);
  }

  private async startSession(session: Session): Promise<boolean> {
    try {
      session.inFlight = this.checkOwnedProtocol(session.nodeId, session.runId);
      await session.inFlight;
      if (session.stopped || this.closed) return false;
      session.acquiring = true;
      session.inFlight = this.command(session, 'keep-awake');
      await session.inFlight;
      if (session.stopped) return false;
      this.schedule(session);
      return true;
    } catch (error) {
      if (session.stopped || this.closed) return false;
      if (error instanceof Error && /HTTP 404/.test(error.message)) {
        this.options.log?.(`[screen:${session.runId}] Legacy bridge has no screen session API; proceeding without keep-awake.`);
        this.sessions.delete(session.runId);
        return true;
      }
      await this.finish(session);
      throw error;
    }
  }

  private isAndroidMesh(execution: AgentLaunchConfig['execution']): boolean {
    return execution?.mode === 'mesh' && execution.node?.platform === 'android';
  }

  private assertCanBegin(runId: string, nodeId?: string): asserts nodeId is string {
    if (this.closed) throw new Error('Android screen session manager has stopped.');
    if (!nodeId || !this.options.execute) throw new Error('Android screen session requires Mesh execution.');
    if (this.sessions.has(runId)) throw new Error('Android screen session already exists for this run.');
  }

  private async checkOwnedProtocol(nodeId: string, runId: string): Promise<void> {
    const result = await this.options.execute!({
      nodeId, capability: 'shell.exec', timeoutMs: 5_000,
      args: { program: 'mobile-ui', arguments: ['screen', 'status', `--owner=${runId}`] },
    });
    this.assertCompleted(result);
    const status = this.parseStatus(result);
    if (!status.ok || status.cliProtocol !== 2 || status.screenProtocol !== 2 || status.owner !== runId) {
      throw new Error('OWNED_SCREEN_PROTOCOL_REQUIRED: Update the remote mobile-ui CLI and Android bridge before starting managed keep-awake.');
    }
    if (status.locked || status.interactive !== true) throw new Error('USER_UNLOCK_REQUIRED: Unlock the phone before starting this run.');
  }

  async stop(runId: string): Promise<void> {
    const session = this.sessions.get(runId);
    if (!session) return;
    session.stopped = true;
    if (session.timer) clearTimeout(session.timer);
    if (!session.stopping) session.stopping = this.finish(session);
    await session.stopping;
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.sessions.keys()].map(runId => this.stop(runId)));
  }

  private async finish(session: Session): Promise<void> {
    try {
      await session.inFlight?.catch(() => {});
      // Acquire may have succeeded remotely even when the response was lost.
      if (session.acquiring) await this.command(session, 'release');
    } catch (error) {
      this.options.log?.(`[screen:${session.runId}] Release unavailable; device lease expires within 120 seconds: ${String(error)}`);
    } finally {
      if (this.sessions.get(session.runId) === session) this.sessions.delete(session.runId);
    }
  }

  private schedule(session: Session): void {
    if (session.stopped) return;
    session.timer = setTimeout(() => {
      if (session.stopped) return;
      session.inFlight = this.command(session, 'renew');
      void session.inFlight.then(() => this.schedule(session), error => {
        session.stopped = true;
        const failure = error instanceof Error ? error : new Error(String(error));
        this.options.log?.(`[screen:${session.runId}] Renewal failed; stopping run: ${failure.message}`);
        this.options.onFailure(session.runId, failure);
        void this.stop(session.runId);
      });
    }, this.options.heartbeatMs ?? 30_000);
    session.timer.unref?.();
  }

  private async command(session: Session, action: 'keep-awake' | 'renew' | 'release'): Promise<void> {
    const result = await this.executeScreenCommand(session, action);
    this.assertCompleted(result);
    const status = this.parseStatus(result);
    this.assertOwnerActionStatus(status, session.runId, action);
  }

  private executeScreenCommand(session: Session, action: 'keep-awake' | 'renew' | 'release') {
    return this.options.execute!({
      nodeId: session.nodeId, capability: 'shell.exec', timeoutMs: 5_000,
      args: { program: 'mobile-ui', arguments: ['screen', action, `--owner=${session.runId}`, '--duration=120'] },
    });
  }

  private assertCompleted(result: any): void {
    const execution = result?.data || result;
    const output = execution?.result || execution;
    if (execution?.status && execution.status !== 'completed') throw new Error(execution.error || `Screen execution ${execution.status}`);
    if (output?.exitCode !== 0) throw new Error(output?.stderr || 'Screen command failed.');
  }

  private parseStatus(result: any): { ok?: boolean; keepAwake?: boolean; error?: string; locked?: boolean; interactive?: boolean; ownerRemainingMs?: number; owner?: string; cliProtocol?: number; screenProtocol?: number } {
    const output = (result?.data || result)?.result || result?.data || result;
    try { return JSON.parse(output.stdout || ''); }
    catch { throw new Error('Screen bridge returned an invalid response.'); }
  }

  private assertOwnerActionStatus(
    status: ReturnType<RemoteMeshScreenSessionManager['parseStatus']>, runId: string,
    action: 'keep-awake' | 'renew' | 'release',
  ): void {
    if (status.cliProtocol !== 2 || status.screenProtocol !== 2 || status.owner !== runId) {
      throw new Error('OWNED_SCREEN_PROTOCOL_REQUIRED: Update the remote mobile-ui CLI and Android bridge before starting managed keep-awake.');
    }
    const ownerActive = typeof status.ownerRemainingMs === 'number' && status.ownerRemainingMs > 0;
    if (!status.ok || (action === 'release' ? status.ownerRemainingMs !== 0
      : (!status.keepAwake || status.locked !== false || status.interactive !== true || !ownerActive))) {
      throw new Error(status.error || 'Screen session is unavailable.');
    }
  }
}
