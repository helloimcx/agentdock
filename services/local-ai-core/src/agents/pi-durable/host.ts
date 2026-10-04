import { createHash } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createServer, type Server } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { checkDurableExecutor, type DurableExecutorCapability } from './capability.js';
import type { DurableBinding, DurableConfig, DurableRequest, DurableResponse, DurableResult, DurableSubmit, DurableWriteDecision, DurableWriteRequest } from './protocol.js';

type PendingResponse = { resolve(value: unknown): void; reject(error: Error): void };
type HostOptions = { userDataPath: string; nodeExecutable?: string; log?: (message: string) => void; onView?: (view: import('./protocol.js').DurableView) => void; onWriteRequest?: (request: DurableWriteRequest) => void };

/** One child worker, one Harness, and one SQLite file for this Core user-data directory. */
export class PiDurableHost {
  private child?: ChildProcessWithoutNullStreams;
  private lock?: Server;
  private nextId = 1;
  private readonly pending = new Map<number, PendingResponse>();
  private startPromise?: Promise<void>;
  readonly databasePath: string;
  readonly nodeExecutable: string;
  private activeNodeExecutable: string;

  constructor(private readonly options: HostOptions) {
    this.databasePath = join(options.userDataPath, 'runtime', 'pi-durable.sqlite');
    this.nodeExecutable = options.nodeExecutable || process.env.AGENTDOCK_DURABLE_NODE || process.execPath;
    this.activeNodeExecutable = this.nodeExecutable;
  }

  async capability(): Promise<DurableExecutorCapability> {
    const primary = await checkDurableExecutor(this.nodeExecutable);
    if (primary.available || this.options.nodeExecutable || process.env.AGENTDOCK_DURABLE_NODE) return primary;
    const systemNode = process.platform === 'win32' ? 'node.exe' : 'node';
    const fallback = await checkDurableExecutor(systemNode);
    if (fallback.available) this.activeNodeExecutable = systemNode;
    return fallback.available ? fallback : primary;
  }

  async start(): Promise<void> {
    if (this.child) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startWorker().finally(() => { this.startPromise = undefined; });
    return this.startPromise;
  }

  async bindings(): Promise<DurableBinding[]> {
    await this.start();
    return this.request<DurableBinding[]>('bindings', {});
  }

  async configure(threadId: string, config: DurableConfig): Promise<void> {
    await this.start();
    await this.request('configure', { threadId, config });
  }

  async resume(): Promise<void> {
    await this.start();
    await this.request('resume', {});
  }

  async submit(input: DurableSubmit): Promise<DurableResult> {
    await this.start();
    return this.request<DurableResult>('submit', input);
  }

  async resolveWrite(requestId: string, decision: DurableWriteDecision): Promise<void> {
    if (!this.child) return;
    await this.request('resolveWrite', { requestId, decision });
  }

  async cancel(threadId: string): Promise<void> {
    if (!this.child) return;
    await this.request('cancel', { threadId });
  }

  async close(): Promise<void> {
    const child = this.child;
    if (child) {
      try { await this.request('close', {}); } catch { /* The child may already be exiting. */ }
      child.stdin.end();
      await new Promise<void>((resolveExit) => {
        if (child.exitCode !== null) return resolveExit();
        const timer = setTimeout(() => { child.kill(); resolveExit(); }, 2000);
        child.once('exit', () => { clearTimeout(timer); resolveExit(); });
      });
    }
    this.child = undefined;
    if (this.lock) await new Promise<void>((resolveClose) => this.lock?.close(() => resolveClose()));
    this.lock = undefined;
  }

  private async startWorker(): Promise<void> {
    const capability = await this.capability();
    if (!capability.available) throw new Error(capability.error || `Pi Durable requires a compatible Node runtime; found ${capability.version || 'unknown'}.`);
    await this.acquireOwnerLock();
    const workerPath = resolve(dirname(__filename), 'worker', 'worker.mjs');
    const child = spawn(this.activeNodeExecutable, [workerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    this.child = child;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => this.acceptResponse(line));
    child.stderr.on('data', (chunk: Buffer) => this.options.log?.(`Pi Durable worker: ${chunk.toString('utf8').trim()}`));
    child.once('error', (error) => this.failPending(error));
    child.once('exit', (code, signal) => {
      if (this.child === child) this.child = undefined;
      this.failPending(new Error(`Pi Durable worker exited (${code ?? signal ?? 'unknown'}).`));
    });
    try { await this.request('open', { file: this.databasePath }); }
    catch (error) { await this.close(); throw error; }
  }

  private async acquireOwnerLock(): Promise<void> {
    const identity = await import('node:fs/promises').then(({ realpath }) => realpath(this.options.userDataPath));
    const digest = createHash('sha256').update(identity).digest();
    const port = 30000 + digest.readUInt32BE(0) % 25000;
    const server = createServer();
    await new Promise<void>((resolveListen, rejectListen) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.removeListener('listening', onListening);
        rejectListen(error.code === 'EADDRINUSE'
          ? new Error('The Pi Durable database already has a live owner for this Core data directory.')
          : error);
      };
      const onListening = () => { server.removeListener('error', onError); resolveListen(); };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '127.0.0.1');
    });
    this.lock = server;
  }

  private request<T = unknown>(method: string, params: unknown): Promise<T> {
    const child = this.child;
    if (!child || child.killed || child.stdin.destroyed) return Promise.reject(new Error('Pi Durable worker is not running.'));
    const id = this.nextId++;
    const request: DurableRequest = { id, method, params };
    return new Promise<T>((resolveResponse, rejectResponse) => {
      this.pending.set(id, { resolve: resolveResponse, reject: rejectResponse });
      child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
        if (!error) return;
        this.pending.delete(id);
        rejectResponse(error);
      });
    });
  }

  private acceptResponse(line: string): void {
    let response: DurableResponse;
    try { response = JSON.parse(line) as DurableResponse; }
    catch { this.failPending(new Error('Pi Durable worker returned an invalid response.')); return; }
    if ('event' in (response as unknown as Record<string, unknown>)) {
      const event = response as unknown as { event?: string; value?: import('./protocol.js').DurableView | DurableWriteRequest };
      if (event.event === 'view' && event.value) this.options.onView?.(event.value as import('./protocol.js').DurableView);
      if (event.event === 'write-request' && event.value) {
        try { this.options.onWriteRequest?.(event.value as DurableWriteRequest); }
        catch { void this.resolveWrite((event.value as DurableWriteRequest).requestId, { ok: false, error: 'Core rejected the workspace write request.' }); }
      }
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.ok) pending.resolve(response.result);
    else pending.reject(new Error(response.error || 'Pi Durable operation failed.'));
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
