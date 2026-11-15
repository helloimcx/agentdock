import type { Readable } from 'node:stream';
import type { MeshBootstrapInput, MeshBootstrapInspection } from '@cc/superai-contracts/mesh-onboarding';
import { NodeAgent, meshUrl } from './node-agent.js';
import { inspectForward } from './bootstrap-forward.js';
import { acquireInstance, BootstrapFailure, isControllerId, isNodeId, persistCredentials, prepareController, readCredentials } from './bootstrap-private.js';

const MAX_FRAME_BYTES = 16 * 1024;
const emit = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);

function readFrame(input: Readable) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let buffered = Buffer.alloc(0), done = false;
    const timer = setTimeout(() => finish(new BootstrapFailure('BOOTSTRAP_INPUT_TIMEOUT')), 10_000);
    const finish = (error?: Error, value?: Record<string, unknown>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      input.removeListener('data', data);
      input.removeListener('end', ended);
      input.removeListener('error', failed);
      if (error) reject(error); else resolve(value!);
    };
    const data = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length > MAX_FRAME_BYTES) return finish(new BootstrapFailure('BOOTSTRAP_INVALID_INPUT'));
      const newline = buffered.indexOf(10);
      if (newline < 0) return;
      try {
        if (buffered.subarray(newline + 1).toString().trim()) throw new Error('extra input');
        const value = JSON.parse(buffered.subarray(0, newline).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
        finish(undefined, value);
      } catch { finish(new BootstrapFailure('BOOTSTRAP_INVALID_INPUT')); }
    };
    const ended = () => finish(new BootstrapFailure('BOOTSTRAP_INVALID_INPUT'));
    const failed = () => finish(new BootstrapFailure('BOOTSTRAP_INVALID_INPUT'));
    input.on('data', data);
    input.once('end', ended);
    input.once('error', failed);
  });
}

function validateInput(value: Record<string, unknown>): MeshBootstrapInput {
  if (!isControllerId(value.controllerId) || !isNodeId(value.expectedNodeId) || typeof value.root !== 'string' || typeof value.allowShell !== 'boolean' || typeof value.server !== 'string') {
    throw new BootstrapFailure('BOOTSTRAP_INVALID_INPUT');
  }
  if (value.pairingToken !== undefined && (typeof value.pairingToken !== 'string' || !value.pairingToken || value.pairingToken.length > 128)) throw new BootstrapFailure('BOOTSTRAP_INVALID_INPUT');
  if (value.replaceCredentials !== undefined && typeof value.replaceCredentials !== 'boolean') throw new BootstrapFailure('BOOTSTRAP_INVALID_INPUT');
  return value as MeshBootstrapInput;
}

function transportPort(server: string) {
  let url: URL;
  try { url = new URL(server); } catch { throw new BootstrapFailure('BOOTSTRAP_TRANSPORT_INVALID'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || !url.port || url.username || url.password || url.search || url.hash || !['/', '', '/api/local/v1'].includes(url.pathname)) {
    throw new BootstrapFailure('BOOTSTRAP_TRANSPORT_INVALID');
  }
  return Number(url.port);
}

async function enroll(input: MeshBootstrapInput, signal: AbortSignal) {
  if (!input.pairingToken) throw new BootstrapFailure('BOOTSTRAP_CREDENTIAL_MISSING');
  const url = meshUrl(input.server);
  url.pathname += '/enroll';
  try {
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingToken: input.pairingToken }), redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
    const body = await response.json() as { ok?: boolean; data?: { nodeId?: unknown; token?: unknown } };
    if (!response.ok || !body.ok || body.data?.nodeId !== input.expectedNodeId || typeof body.data?.token !== 'string' || !body.data.token || body.data.token.length > 128) {
      throw new Error('registration rejected');
    }
    return { controllerId: input.controllerId, nodeId: input.expectedNodeId, token: body.data.token };
  } catch (error) {
    if (signal.aborted) throw error;
    throw new BootstrapFailure('BOOTSTRAP_ENROLL_FAILED');
  }
}

async function inspect(value: Record<string, unknown>) {
  if (!isControllerId(value.controllerId) || typeof value.root !== 'string') throw new BootstrapFailure('BOOTSTRAP_INVALID_INPUT');
  const { directory, root } = await prepareController(value.controllerId, value.root);
  const credentials = await readCredentials(directory, value.controllerId);
  const result: MeshBootstrapInspection = { controllerId: value.controllerId, root, credentialsPresent: Boolean(credentials) };
  if (credentials) result.nodeId = credentials.nodeId;
  emit(result);
}

async function run(input: MeshBootstrapInput, lifecycle: AbortController) {
  const { directory, root } = await prepareController(input.controllerId, input.root);
  const release = await acquireInstance(directory);
  let agent: NodeAgent | undefined;
  try {
    await inspectForward(transportPort(input.server));
    lifecycle.signal.throwIfAborted();
    const credentials = await persistCredentials(directory, input.controllerId, input.expectedNodeId, input.replaceCredentials === true, () => enroll(input, lifecycle.signal));
    lifecycle.signal.throwIfAborted();
    agent = new NodeAgent({
      server: input.server, credentials, root, allowShell: input.allowShell,
      onStatus: status => {
        if (lifecycle.signal.aborted) return;
        emit({ status });
        if (status === 'rejected') lifecycle.abort(new BootstrapFailure('BOOTSTRAP_AUTH_REJECTED'));
      },
    });
    agent.start();
    await new Promise<void>(done => {
      if (lifecycle.signal.aborted) done(); else lifecycle.signal.addEventListener('abort', () => done(), { once: true });
    });
    if (lifecycle.signal.reason instanceof BootstrapFailure) throw lifecycle.signal.reason;
  } catch (error) {
    if (!lifecycle.signal.aborted || lifecycle.signal.reason instanceof BootstrapFailure) throw error;
  } finally {
    agent?.stop();
    await release();
  }
  emit({ status: 'stopped' });
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new BootstrapFailure('BOOTSTRAP_NODE_VERSION');
  if (!['darwin', 'linux'].includes(process.platform)) throw new BootstrapFailure('BOOTSTRAP_PLATFORM_UNSUPPORTED');
  const command = process.argv[2];
  const lifecycle = new AbortController();
  const stop = () => lifecycle.abort();
  if (command === 'run') {
    process.stdin.once('end', stop);
    process.stdin.once('error', stop);
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  }
  try {
    const frame = await readFrame(process.stdin);
    if (command === 'inspect') return await inspect(frame);
    if (command === 'inspect-forward') { emit(await inspectForward(frame.port)); return; }
    if (command !== 'run') throw new BootstrapFailure('BOOTSTRAP_INVALID_INPUT');
    await run(validateInput(frame), lifecycle);
  } finally {
    process.stdin.removeListener('end', stop);
    process.stdin.removeListener('error', stop);
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
  }
}

if (require.main === module) {
  void main().catch(error => {
    emit({ errorCode: error instanceof BootstrapFailure ? error.code : 'BOOTSTRAP_FAILED' });
    process.exitCode = 1;
  }).then(() => {
    // Do not leave a WebSocket close timer or SSH stdin keeping a completed bootstrap alive.
    process.stdout.write('', () => process.exit(process.exitCode || 0));
  });
}
