export function normalizeChannelInstanceId(value: unknown, fallback: string) {
  const raw = String(value || '').trim();
  const normalized = raw.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').slice(0, 80);
  return normalized || fallback;
}

export function channelPlatformKey(platform: string, instanceId: string) {
  return instanceId === 'default' ? platform : `${platform}:${instanceId}`;
}

export function runtimeKey(workspaceId: string, instanceId: string) {
  return `${workspaceId}::${instanceId}`;
}
