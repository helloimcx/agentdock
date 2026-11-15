import type { IncomingMessage } from 'node:http';
import type { TailscaleConnectionInput } from '@cc/superai-contracts';
import { readJsonBody } from '../runtime/server-helpers.js';
import { record, text } from './mesh-validation.js';
import type { MeshStore } from './mesh-store.js';
import type { TailscaleOnboardingManager } from './tailscale-onboarding.js';
import { OnboardingError } from './tailscale-transport.js';

async function readInput(req: IncomingMessage, peerId?: string): Promise<TailscaleConnectionInput> {
  const body = record(await readJsonBody(req, 8192));
  const sshUser = text(body.sshUser, 64);
  const approvedRoot = text(body.approvedRoot, 4096);
  if (!/^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/.test(sshUser)) throw new OnboardingError('INVALID_USER', 'Enter a valid remote SSH user.');
  if (/[\x00-\x1f\x7f]/.test(approvedRoot) || (!approvedRoot.startsWith('/') && !approvedRoot.startsWith('~/'))) throw new OnboardingError('INVALID_ROOT', 'Choose an absolute remote directory or a path beginning with ~/ .');
  if (typeof body.allowShell !== 'boolean') throw new OnboardingError('INVALID_POLICY', 'Command execution requires an explicit boolean permission.');
  return { peerId: peerId || text(body.peerId, 200), sshUser, approvedRoot, allowShell: body.allowShell, idempotencyKey: text(body.idempotencyKey, 100) };
}

/** Called only after the Mesh administrator authorization boundary. */
export async function handleOnboardingRequest(req: IncomingMessage, path: string, store: MeshStore, manager: TailscaleOnboardingManager): Promise<unknown | undefined> {
  if (path === '/tailscale/connections' && req.method === 'GET') return { connections: store.onboarding.listConnections() };
  if (path === '/tailscale/connections' && req.method === 'POST') return manager.start(await readInput(req));
  const operation = /^\/tailscale\/operations\/([^/]+)(?:\/(cancel))?$/.exec(path);
  if (operation) {
    const id = decodeURIComponent(operation[1]);
    if (!operation[2] && req.method === 'GET') return store.onboarding.getResult(id);
    if (operation[2] === 'cancel' && req.method === 'POST') return manager.cancel(id);
  }
  const action = /^\/tailscale\/connections\/([^/]+)\/(disconnect|reauthorize)$/.exec(path);
  if (action && req.method === 'POST') {
    const connection = store.onboarding.getConnection(decodeURIComponent(action[1]));
    if (action[2] === 'disconnect') return manager.disconnect(connection.id);
    return manager.start(await readInput(req, connection.peerId), true);
  }
  return undefined;
}
