import fs from 'node:fs';
import path from 'node:path';
import type { DesktopConnectConfig } from '@cc/superai-contracts';
import { normalizeDesktopPlatformType } from '@cc/superai-contracts';
import { channelPlatformKey, normalizeChannelInstanceId } from '../shared/channel-keys.js';
import type { WeixinCredentials, WeixinWorkspaceBinding } from './types.js';

export const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
export const DEFAULT_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';
export const LONG_POLL_TIMEOUT_MS = 35_000;

export function getDefaultWeixinStateDir() {
  return path.join(process.cwd(), 'weixin-monitor');
}

export function safeFilePart(value: string): string {
  return String(value || 'default').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'default';
}

export function getWeixinBufPath(binding: WeixinWorkspaceBinding): string {
  return path.join(binding.stateDir, `${binding.accountId}.buf`);
}

export function getWeixinCredentialsPath(workspaceId: string, stateDir: string, instanceId = 'default'): string {
  const suffix = instanceId === 'default' ? '' : `.${safeFilePart(instanceId)}`;
  return path.join(stateDir, `${safeFilePart(workspaceId)}${suffix}.credentials.json`);
}

export function loadWeixinCredentials(workspaceId: string, stateDir: string, instanceId = 'default'): WeixinCredentials | null {
  try {
    const raw = fs.readFileSync(getWeixinCredentialsPath(workspaceId, stateDir, instanceId), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<WeixinCredentials>;
    const token = String(parsed.token || '').trim();
    if (!token) return null;
    return {
      token,
      baseUrl: parsed.baseUrl ? String(parsed.baseUrl) : undefined,
      botId: parsed.botId ? String(parsed.botId) : undefined,
      userId: parsed.userId ? String(parsed.userId) : undefined,
      savedAt: parsed.savedAt ? String(parsed.savedAt) : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function saveWeixinCredentials(binding: WeixinWorkspaceBinding, credentials: WeixinCredentials): void {
  fs.mkdirSync(binding.stateDir, { recursive: true });
  fs.writeFileSync(
    getWeixinCredentialsPath(binding.workspaceId, binding.stateDir, binding.instanceId),
    JSON.stringify(credentials, null, 2),
    'utf-8',
  );
}

export function loadWeixinBuf(binding: WeixinWorkspaceBinding): string {
  try {
    return fs.readFileSync(getWeixinBufPath(binding), 'utf-8');
  } catch {
    return '';
  }
}

export function saveWeixinBuf(binding: WeixinWorkspaceBinding, buf: string): void {
  const dir = binding.stateDir;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getWeixinBufPath(binding), buf, 'utf-8');
}

export function collectWeixinWorkspaceBindings(config: DesktopConnectConfig | null | undefined): WeixinWorkspaceBinding[] {
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
      .filter((p) => p.platformType === 'weixin')
      .map((p, index) => {
        const instanceId = normalizeChannelInstanceId(p.options.instance_id || p.options.id, index === 0 ? 'default' : `weixin-${index + 1}`);
        const stateDir = String(p.options.state_dir || getDefaultWeixinStateDir()).trim();
        const credentials = loadWeixinCredentials(project.name, stateDir, instanceId);
        const configuredToken = String(p.options.token || '').trim();
        const configuredBaseUrl = String(p.options.base_url || '').trim();
        const accountId = String(p.options.account_id || credentials?.botId || 'qr-login').trim();
        return {
          workspaceId: project.name,
          instanceId,
          displayName: String(p.options.name || p.options.display_name || `WeChat ${index + 1}`).trim(),
          platformKey: channelPlatformKey('weixin', instanceId),
          token: configuredToken || credentials?.token || '',
          accountId,
          baseUrl: configuredBaseUrl || credentials?.baseUrl || DEFAULT_BASE_URL,
          cdnBaseUrl: String(p.options.cdn_base_url || DEFAULT_CDN_BASE_URL).trim(),
          allowFrom: String(p.options.allow_from || '*').trim(),
          routeTag: String(p.options.route_tag || '').trim(),
          longPollTimeoutMs: Number(p.options.long_poll_timeout_ms || LONG_POLL_TIMEOUT_MS) || LONG_POLL_TIMEOUT_MS,
          stateDir,
          proxy: String(p.options.proxy || '').trim(),
          proxyUsername: String(p.options.proxy_username || '').trim(),
          proxyPassword: String(p.options.proxy_password || '').trim(),
          enabled: true,
          project,
        };
      });
  });
}
