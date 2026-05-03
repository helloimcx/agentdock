import { randomUUID } from 'node:crypto';

export function createScheduledJobId() {
  return randomUUID().split('-')[0] || randomUUID();
}

export function toPublicScheduledJobId(jobId: string) {
  const normalized = jobId.startsWith('job:') ? jobId.slice(4) : jobId;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized)) {
    return normalized.split('-')[0] || normalized;
  }
  return normalized;
}
