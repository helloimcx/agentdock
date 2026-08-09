import type { DesktopConnectConfig } from '@cc/superai-contracts';
import { collectPlatformOptions } from '../shared/collect-platform-options.js';
import type { LarkWorkspaceBinding } from './types.js';

export function collectLarkWorkspaceBindings(
  config: DesktopConnectConfig | null | undefined,
  options: { defaultCardActionsEnabled: boolean },
): LarkWorkspaceBinding[] {
  return collectPlatformOptions(config, 'lark').map((entry) => {
    const { project, options: platformOptions, instanceId, workspaceId, platformKey, displayName } = entry;
    return {
      workspaceId,
      instanceId,
      displayName,
      platformKey,
      appId: String(platformOptions.app_id || '').trim(),
      appSecret: String(platformOptions.app_secret || '').trim(),
      encryptKey: String(platformOptions.encrypt_key || '').trim(),
      verificationToken: String(platformOptions.verification_token || '').trim(),
      autoApprove: String(platformOptions.auto_approve || '').trim().toLowerCase() === 'true'
        || platformOptions.auto_approve === true,
      cardActionsEnabled: String(platformOptions.card_actions || platformOptions.enable_card_actions || '').trim().toLowerCase() === 'true'
        || platformOptions.card_actions === true
        || platformOptions.enable_card_actions === true
        || options.defaultCardActionsEnabled,
      groupReplyAll: String(platformOptions.group_reply_all || '').trim().toLowerCase() === 'true'
        || platformOptions.group_reply_all === true,
      downloadsDir: String(platformOptions.downloads_dir || '').trim(),
      brand: String(platformOptions.brand || platformOptions.lark_brand || '').trim().toLowerCase() === 'lark' ? 'lark' : 'feishu',
      enabled: Boolean(String(platformOptions.app_id || '').trim() && String(platformOptions.app_secret || '').trim()),
      project,
    };
  });
}
