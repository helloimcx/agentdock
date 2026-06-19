import type { DesktopConnectConfig } from '../../../../../packages/contracts/src/index.js';
import { normalizeDesktopPlatformType } from '../../../../../shared/desktop.js';
import { channelPlatformKey, normalizeChannelInstanceId } from '../shared/channel-keys.js';
import type { LarkWorkspaceBinding } from './types.js';

export function collectLarkWorkspaceBindings(
  config: DesktopConnectConfig | null | undefined,
  options: { defaultCardActionsEnabled: boolean },
): LarkWorkspaceBinding[] {
  const projects = Array.isArray(config?.projects) ? config!.projects! : [];
  return projects.flatMap((project) => {
    const platforms = Array.isArray(project.platforms) ? project.platforms : [];
    return platforms
      .map((platform) => ({
        platformType: normalizeDesktopPlatformType(platform?.type),
        options: platform?.options && typeof platform.options === 'object'
          ? platform.options as Record<string, unknown>
          : {},
      }))
      .filter((platform) => platform.platformType === 'lark')
      .map((platform, index) => {
        const instanceId = normalizeChannelInstanceId(platform.options.instance_id || platform.options.id, index === 0 ? 'default' : `lark-${index + 1}`);
        return {
          workspaceId: project.name,
          instanceId,
          displayName: String(platform.options.name || platform.options.display_name || `Lark ${index + 1}`).trim(),
          platformKey: channelPlatformKey('lark', instanceId),
          appId: String(platform.options.app_id || '').trim(),
          appSecret: String(platform.options.app_secret || '').trim(),
          encryptKey: String(platform.options.encrypt_key || '').trim(),
          verificationToken: String(platform.options.verification_token || '').trim(),
          autoApprove: String(platform.options.auto_approve || '').trim().toLowerCase() === 'true'
            || platform.options.auto_approve === true,
          cardActionsEnabled: String(platform.options.card_actions || platform.options.enable_card_actions || '').trim().toLowerCase() === 'true'
            || platform.options.card_actions === true
            || platform.options.enable_card_actions === true
            || options.defaultCardActionsEnabled,
          groupReplyAll: String(platform.options.group_reply_all || '').trim().toLowerCase() === 'true'
            || platform.options.group_reply_all === true,
          downloadsDir: String(platform.options.downloads_dir || '').trim(),
          brand: String(platform.options.brand || platform.options.lark_brand || '').trim().toLowerCase() === 'lark' ? 'lark' : 'feishu',
          enabled: Boolean(String(platform.options.app_id || '').trim() && String(platform.options.app_secret || '').trim()),
          project,
        };
      });
  });
}
