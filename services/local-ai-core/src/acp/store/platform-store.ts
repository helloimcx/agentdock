import type { DatabaseSync } from 'node:sqlite';
import type {
  LocalCoreAuthorizedUser,
  LocalCorePairingRequest,
} from '@cc/superai-contracts';
import type {
  LocalPlatformPairingRow,
  LocalPlatformThreadBindingRow,
  LocalPlatformUserRow,
} from './acp-store-types.js';
import { SqlPredicateBuilder } from './utils.js';

function buildWorkspacePlatformWhere(workspaceId?: string, platform?: string): { where: string; params: Array<string | number> } {
  const builder = new SqlPredicateBuilder()
    .eq('workspace_id', workspaceId)
    .eq('platform', platform);
  return { where: builder.whereClause(), params: builder.params };
}

export class LocalPlatformStore {
  constructor(private readonly db: DatabaseSync) {}

  createPairingRequest(input: Omit<LocalPlatformPairingRow, 'platform'> & { platform?: string }) {
    this.db.prepare(`
      INSERT INTO platform_pairings (code, workspace_id, platform, platform_user_id, chat_id, display_name, requested_at, expires_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.code,
      input.workspace_id,
      input.platform || 'lark',
      input.platform_user_id,
      input.chat_id,
      input.display_name,
      input.requested_at,
      input.expires_at,
      input.status,
    );
  }

  listPendingPairings(workspaceId?: string) {
    const query = workspaceId
      ? `
        SELECT code, workspace_id, platform, platform_user_id, chat_id, display_name, requested_at, expires_at, status
        FROM platform_pairings
        WHERE workspace_id = ? AND status = 'pending'
        ORDER BY requested_at DESC
      `
      : `
        SELECT code, workspace_id, platform, platform_user_id, chat_id, display_name, requested_at, expires_at, status
        FROM platform_pairings
        WHERE status = 'pending'
        ORDER BY requested_at DESC
      `;
    return this.db.prepare(query).all(...(workspaceId ? [workspaceId] : [])) as LocalPlatformPairingRow[];
  }

  getPairingRequest(code: string) {
    return this.db.prepare(`
      SELECT code, workspace_id, platform, platform_user_id, chat_id, display_name, requested_at, expires_at, status
      FROM platform_pairings
      WHERE code = ?
    `).get(code) as LocalPlatformPairingRow | undefined;
  }

  updatePairingStatus(code: string, status: LocalPlatformPairingRow['status']) {
    this.db.prepare('UPDATE platform_pairings SET status = ? WHERE code = ?').run(status, code);
  }

  expirePendingPairings(nowIso = new Date().toISOString()) {
    this.db.prepare(`
      UPDATE platform_pairings
      SET status = 'expired'
      WHERE status = 'pending' AND expires_at < ?
    `).run(nowIso);
  }

  getAuthorizedUser(workspaceId: string, platformUserId: string, platform = 'lark') {
    return this.db.prepare(`
      SELECT id, workspace_id, platform, platform_user_id, chat_id, display_name, thread_id, authorized_at
      FROM platform_users
      WHERE workspace_id = ? AND platform = ? AND platform_user_id = ?
    `).get(workspaceId, platform, platformUserId) as LocalPlatformUserRow | undefined;
  }

  listAuthorizedUsers(workspaceId?: string, platform?: string): LocalCoreAuthorizedUser[] {
    const { where, params } = buildWorkspacePlatformWhere(workspaceId, platform);
    const query = `
        SELECT id, workspace_id, platform, platform_user_id, chat_id, display_name, thread_id, authorized_at
        FROM platform_users
        ${where}
        ORDER BY authorized_at DESC
      `;
    const rows = this.db.prepare(query).all(...params) as LocalPlatformUserRow[];
    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      platform: row.platform,
      participantId: row.platform_user_id,
      channelId: row.chat_id,
      platformUserId: row.platform_user_id,
      chatId: row.chat_id,
      displayName: row.display_name,
      threadId: row.thread_id || undefined,
      authorizedAt: row.authorized_at,
    }));
  }

  createAuthorizedUser(input: Omit<LocalPlatformUserRow, 'platform'> & { platform?: string }) {
    this.db.prepare(`
      INSERT INTO platform_users (id, workspace_id, platform, platform_user_id, chat_id, display_name, thread_id, authorized_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, platform, platform_user_id) DO UPDATE SET
        chat_id = excluded.chat_id,
        display_name = excluded.display_name,
        thread_id = COALESCE(excluded.thread_id, platform_users.thread_id),
        authorized_at = excluded.authorized_at
    `).run(
      input.id,
      input.workspace_id,
      input.platform || 'lark',
      input.platform_user_id,
      input.chat_id,
      input.display_name,
      input.thread_id,
      input.authorized_at,
    );
  }

  updateAuthorizedUserThread(workspaceId: string, platformUserId: string, threadId: string, platform = 'lark') {
    this.db.prepare(`
      UPDATE platform_users
      SET thread_id = ?
      WHERE workspace_id = ? AND platform = ? AND platform_user_id = ?
    `).run(threadId, workspaceId, platform, platformUserId);
  }

  clearAuthorizedUserThreadByThreadId(threadId: string) {
    this.db.prepare('UPDATE platform_users SET thread_id = NULL WHERE thread_id = ?').run(threadId);
  }

  getPlatformThreadBinding(workspaceId: string, chatId: string, platformUserId: string, platform = 'lark') {
    return this.db.prepare(`
      SELECT workspace_id, platform, chat_id, platform_user_id, thread_id, last_platform_message_id, preferred_agent_type, preferred_provider_id, created_at, updated_at
      FROM platform_thread_bindings
      WHERE workspace_id = ? AND platform = ? AND chat_id = ? AND platform_user_id = ?
    `).get(workspaceId, platform, chatId, platformUserId) as LocalPlatformThreadBindingRow | undefined;
  }

  getPlatformThreadBindingByThreadId(threadId: string) {
    return this.db.prepare(`
      SELECT workspace_id, platform, chat_id, platform_user_id, thread_id, last_platform_message_id, preferred_agent_type, preferred_provider_id, created_at, updated_at
      FROM platform_thread_bindings
      WHERE thread_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(threadId) as LocalPlatformThreadBindingRow | undefined;
  }

  deletePlatformThreadBindingsByThreadId(threadId: string) {
    this.db.prepare('DELETE FROM platform_thread_bindings WHERE thread_id = ?').run(threadId);
  }

  upsertPlatformThreadBinding(input: Omit<LocalPlatformThreadBindingRow, 'platform'> & { platform?: string }) {
    this.db.prepare(`
      INSERT INTO platform_thread_bindings
      (workspace_id, platform, chat_id, platform_user_id, thread_id, last_platform_message_id, preferred_agent_type, preferred_provider_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, platform, chat_id, platform_user_id) DO UPDATE SET
        thread_id = excluded.thread_id,
        last_platform_message_id = COALESCE(excluded.last_platform_message_id, platform_thread_bindings.last_platform_message_id),
        preferred_agent_type = COALESCE(excluded.preferred_agent_type, platform_thread_bindings.preferred_agent_type),
        preferred_provider_id = COALESCE(excluded.preferred_provider_id, platform_thread_bindings.preferred_provider_id),
        updated_at = excluded.updated_at
    `).run(
      input.workspace_id,
      input.platform || 'lark',
      input.chat_id,
      input.platform_user_id,
      input.thread_id,
      input.last_platform_message_id,
      input.preferred_agent_type ?? null,
      input.preferred_provider_id ?? null,
      input.created_at,
      input.updated_at,
    );
  }

  updatePlatformThreadPreferredAgent(
    workspaceId: string,
    chatId: string,
    platformUserId: string,
    agentType: string | null,
    platform = 'lark',
  ) {
    this.db.prepare(`
      UPDATE platform_thread_bindings
      SET preferred_agent_type = ?, updated_at = ?
      WHERE workspace_id = ? AND platform = ? AND chat_id = ? AND platform_user_id = ?
    `).run(agentType, new Date().toISOString(), workspaceId, platform, chatId, platformUserId);
  }

  updatePlatformThreadPreferredProvider(
    workspaceId: string,
    chatId: string,
    platformUserId: string,
    providerId: string | null,
    platform = 'lark',
  ) {
    this.db.prepare(`
      UPDATE platform_thread_bindings
      SET preferred_provider_id = ?, updated_at = ?
      WHERE workspace_id = ? AND platform = ? AND chat_id = ? AND platform_user_id = ?
    `).run(providerId, new Date().toISOString(), workspaceId, platform, chatId, platformUserId);
  }

  updatePlatformThreadMessageId(workspaceId: string, chatId: string, platformUserId: string, messageId: string, platform = 'lark') {
    this.db.prepare(`
      UPDATE platform_thread_bindings
      SET last_platform_message_id = ?, updated_at = ?
      WHERE workspace_id = ? AND platform = ? AND chat_id = ? AND platform_user_id = ?
    `).run(messageId, new Date().toISOString(), workspaceId, platform, chatId, platformUserId);
  }

  clearPlatformThreadMessageId(workspaceId: string, chatId: string, platformUserId: string, platform = 'lark') {
    this.db.prepare(`
      UPDATE platform_thread_bindings
      SET last_platform_message_id = NULL, updated_at = ?
      WHERE workspace_id = ? AND platform = ? AND chat_id = ? AND platform_user_id = ?
    `).run(new Date().toISOString(), workspaceId, platform, chatId, platformUserId);
  }

  listPairingRequests(workspaceId?: string, platform?: string): LocalCorePairingRequest[] {
    const { where, params } = buildWorkspacePlatformWhere(workspaceId, platform);
    const query = `
        SELECT code, workspace_id, platform, platform_user_id, chat_id, display_name, requested_at, expires_at, status
        FROM platform_pairings
        ${where}
        ORDER BY requested_at DESC
      `;
    const rows = this.db.prepare(query).all(...params) as LocalPlatformPairingRow[];
    return rows.map((row) => ({
      code: row.code,
      workspaceId: row.workspace_id,
      platform: row.platform,
      participantId: row.platform_user_id,
      channelId: row.chat_id,
      platformUserId: row.platform_user_id,
      chatId: row.chat_id,
      displayName: row.display_name,
      requestedAt: row.requested_at,
      expiresAt: row.expires_at,
      status: row.status,
    }));
  }
}
