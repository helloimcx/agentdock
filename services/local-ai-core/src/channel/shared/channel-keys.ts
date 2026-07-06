export function normalizeChannelInstanceId(value: unknown, fallback: string) {
  const raw = String(value || '').trim();
  const normalized = raw.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').slice(0, 80);
  return normalized || fallback;
}

export function channelPlatformKey(platform: string, instanceId: string) {
  return instanceId === 'default' ? platform : `${platform}:${instanceId}`;
}

export function extractChannelInstanceId(platform: string, prefix: string): string {
  const normalized = String(platform || '').trim();
  const tag = `${prefix}:`;
  return normalized.startsWith(tag) ? normalized.slice(tag.length).trim() : '';
}

export function runtimeKey(workspaceId: string, instanceId: string) {
  return `${workspaceId}::${instanceId}`;
}
