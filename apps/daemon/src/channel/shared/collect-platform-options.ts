import type { DesktopConnectConfig, DesktopProjectConfig } from '@cc/superai-contracts';
import { normalizeDesktopPlatformType } from '@cc/superai-contracts';
import { channelPlatformKey, normalizeChannelInstanceId } from './channel-keys.js';

const PLATFORM_LABELS: Record<'lark' | 'weixin', string> = {
  lark: 'Lark',
  weixin: 'WeChat',
};

export type PreparedPlatformOption = {
  project: DesktopProjectConfig;
  options: Record<string, unknown>;
  instanceId: string;
  workspaceId: string;
  platformKey: string;
  displayName: string;
};

export function collectPlatformOptions(
  config: DesktopConnectConfig | null | undefined,
  platformType: 'lark' | 'weixin',
): PreparedPlatformOption[] {
  const projects = Array.isArray(config?.projects) ? config!.projects! : [];
  return projects.flatMap((project) => {
    const platforms = Array.isArray(project.platforms) ? project.platforms : [];
    return platforms
      .map((platform) => ({
        platformType: normalizeDesktopPlatformType(platform?.type),
        options: platform?.options ?? {},
      }))
      .filter((p) => p.platformType === platformType)
      .map((p, index) => {
        const instanceId = normalizeChannelInstanceId(
          p.options.instance_id || p.options.id,
          index === 0 ? 'default' : `${platformType}-${index + 1}`,
        );
        return {
          project,
          options: p.options,
          instanceId,
          workspaceId: project.name,
          platformKey: channelPlatformKey(platformType, instanceId),
          displayName: String(p.options.name || p.options.display_name || `${PLATFORM_LABELS[platformType]} ${index + 1}`).trim(),
        };
      });
  });
}
