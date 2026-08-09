import fs from 'node:fs';
import path from 'node:path';
import type { DesktopConnectConfig } from '@cc/superai-contracts';
import { collectPlatformOptions } from '../shared/collect-platform-options.js';
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
  return collectPlatformOptions(config, 'weixin').map((entry) => {
    const { project, options: p, instanceId, workspaceId, platformKey, displayName } = entry;
    const stateDir = String(p.state_dir || getDefaultWeixinStateDir()).trim();
    const credentials = loadWeixinCredentials(project.name, stateDir, instanceId);
    const configuredToken = String(p.token || '').trim();
    const configuredBaseUrl = String(p.base_url || '').trim();
    const accountId = String(p.account_id || credentials?.botId || 'qr-login').trim();
    return {
      workspaceId,
      instanceId,
      displayName,
      platformKey,
      token: configuredToken || credentials?.token || '',
      accountId,
      baseUrl: configuredBaseUrl || credentials?.baseUrl || DEFAULT_BASE_URL,
      cdnBaseUrl: String(p.cdn_base_url || DEFAULT_CDN_BASE_URL).trim(),
      allowFrom: String(p.allow_from || '*').trim(),
      routeTag: String(p.route_tag || '').trim(),
      longPollTimeoutMs: Number(p.long_poll_timeout_ms || LONG_POLL_TIMEOUT_MS) || LONG_POLL_TIMEOUT_MS,
      stateDir,
      proxy: String(p.proxy || '').trim(),
      proxyUsername: String(p.proxy_username || '').trim(),
      proxyPassword: String(p.proxy_password || '').trim(),
      enabled: true,
      project,
    };
  });
}
