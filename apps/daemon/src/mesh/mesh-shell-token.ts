import { createHmac, timingSafeEqual } from 'node:crypto';

const TOKEN_DOMAIN = 'agentdock-mesh-shell-v1';
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

type MeshShellClaims = {
  version: 1;
  nodeId: string;
  workspaceId: string;
  threadId: string;
  expiresAt: number;
};

function signingKey(adminToken: string): Buffer {
  return createHmac('sha256', adminToken).update(TOKEN_DOMAIN).digest();
}

function hasValidSignature(payload: string, supplied: string, adminToken: string): boolean {
  const expected = createHmac('sha256', signingKey(adminToken)).update(payload).digest();
  let actual: Buffer;
  try { actual = Buffer.from(supplied, 'base64url'); } catch { return false; }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function parseValidClaims(payload: string, now: number): MeshShellClaims | null {
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<MeshShellClaims>;
    if (claims.version !== 1 || typeof claims.nodeId !== 'string' || !claims.nodeId.startsWith('node:')) return null;
    if (typeof claims.workspaceId !== 'string' || !claims.workspaceId || typeof claims.expiresAt !== 'number' || claims.expiresAt <= now) return null;
    return {
      version: 1,
      nodeId: claims.nodeId,
      workspaceId: claims.workspaceId,
      threadId: typeof claims.threadId === 'string' ? claims.threadId : '',
      expiresAt: claims.expiresAt,
    };
  } catch {
    return null;
  }
}

export function createMeshShellToken(input: {
  adminToken: string;
  nodeId: string;
  workspaceId: string;
  threadId?: string;
  now?: number;
  ttlMs?: number;
}): string {
  if (!input.adminToken || !input.nodeId || !input.workspaceId) return '';
  const now = input.now ?? Date.now();
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return '';
  const claims: MeshShellClaims = {
    version: 1,
    nodeId: input.nodeId,
    workspaceId: input.workspaceId,
    threadId: input.threadId || '',
    // Keep credentials stable across route resolutions within one time window.
    // A new token is minted at the next window, which also refreshes long-lived
    // ACP sessions through their normal launch-config comparison.
    expiresAt: Math.floor(now / ttlMs) * ttlMs + (2 * ttlMs),
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', signingKey(input.adminToken)).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyMeshShellToken(token: string, adminToken: string, now = Date.now()): MeshShellClaims | null {
  if (!token || !adminToken) return null;
  const [payload, suppliedSignature, extra] = token.split('.');
  if (!payload || !suppliedSignature || extra !== undefined) return null;
  if (!hasValidSignature(payload, suppliedSignature, adminToken)) return null;
  return parseValidClaims(payload, now);
}
