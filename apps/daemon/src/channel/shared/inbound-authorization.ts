import { randomUUID } from 'node:crypto';
import type {
  LocalPlatformPairingRow,
  LocalPlatformUserRow,
} from '../../router/workspace-router-types.js';

export type InboundChannelIdentity = {
  workspaceId: string;
  platformKey: string;
  platformUserId: string;
  chatId: string;
  displayName: string;
};

export type InboundAuthorizationStore = {
  expirePendingPairings(): void;
  getAuthorizedUser(workspaceId: string, platformUserId: string, platform: string): LocalPlatformUserRow | undefined;
  createAuthorizedUser(input: Omit<LocalPlatformUserRow, 'platform'> & { platform?: string }): void;
  listPendingPairings(workspaceId?: string): LocalPlatformPairingRow[];
  createPairingRequest(input: Omit<LocalPlatformPairingRow, 'platform'> & { platform?: string }): void;
};

export type InboundChannelAuthorizationResult =
  | { status: 'authorized'; authorized: LocalPlatformUserRow; autoApproved: boolean }
  | { status: 'pending'; pairingCode: string };

const DEFAULT_PAIRING_EXPIRY_MS = 10 * 60 * 1000;

export function resolveInboundChannelAuthorization(input: {
  store: InboundAuthorizationStore;
  identity: InboundChannelIdentity;
  autoApprove: boolean;
  authorizedUserIdPrefix: string;
  generatePairingCode: () => string;
  pairingExpiryMs?: number;
  now?: () => Date;
  onStateChanged?: () => void;
}): InboundChannelAuthorizationResult {
  const { store, identity } = input;
  store.expirePendingPairings();
  let authorized = store.getAuthorizedUser(
    identity.workspaceId,
    identity.platformUserId,
    identity.platformKey,
  );
  let autoApproved = false;

  if (!authorized && input.autoApprove) {
    const authorizedAt = (input.now?.() || new Date()).toISOString();
    store.createAuthorizedUser({
      id: `${input.authorizedUserIdPrefix}-${randomUUID()}`,
      workspace_id: identity.workspaceId,
      platform: identity.platformKey,
      platform_user_id: identity.platformUserId,
      chat_id: identity.chatId,
      display_name: identity.displayName,
      thread_id: null,
      authorized_at: authorizedAt,
    });
    authorized = store.getAuthorizedUser(
      identity.workspaceId,
      identity.platformUserId,
      identity.platformKey,
    );
    autoApproved = Boolean(authorized);
    if (autoApproved) {
      input.onStateChanged?.();
    }
  }

  if (authorized) {
    return { status: 'authorized', authorized, autoApproved };
  }

  const existingPending = store.listPendingPairings(identity.workspaceId).find((item) =>
    item.platform === identity.platformKey &&
    item.platform_user_id === identity.platformUserId &&
    item.chat_id === identity.chatId &&
    item.status === 'pending'
  );
  if (existingPending) {
    return { status: 'pending', pairingCode: existingPending.code };
  }

  const now = input.now?.() || new Date();
  const pairingCode = input.generatePairingCode();
  store.createPairingRequest({
    code: pairingCode,
    workspace_id: identity.workspaceId,
    platform: identity.platformKey,
    platform_user_id: identity.platformUserId,
    chat_id: identity.chatId,
    display_name: identity.displayName,
    requested_at: now.toISOString(),
    expires_at: new Date(now.getTime() + (input.pairingExpiryMs || DEFAULT_PAIRING_EXPIRY_MS)).toISOString(),
    status: 'pending',
  });
  input.onStateChanged?.();
  return { status: 'pending', pairingCode };
}
