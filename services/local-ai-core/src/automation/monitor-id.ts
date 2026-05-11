export function toPublicAutomationMonitorId(monitorId: string) {
  const normalized = monitorId.startsWith('monitor:') ? monitorId.slice('monitor:'.length) : monitorId;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized)) {
    return normalized.split('-')[0] || normalized;
  }
  return normalized;
}

