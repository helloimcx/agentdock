export interface ChannelRoute {
  type: string;
  channelId: string;
  instanceId?: string;
  participantId?: string;
  threadId?: string;
  metadata?: Record<string, unknown>;
}

export type ScheduledJobDeliveryTarget = ChannelRoute;

export type ScheduledJobRoute = ScheduledJobDeliveryTarget;

export type ScheduledJobExecutionMode = 'same-thread' | 'side-thread' | (string & {});

export function normalizeContractEnumValue(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
}

export function normalizeScheduledJobExecutionMode(value: unknown, fallback: ScheduledJobExecutionMode = 'same-thread'): ScheduledJobExecutionMode {
  const normalized = normalizeContractEnumValue(value || fallback);
  if (normalized === 'same-thread' || normalized === 'side-thread') {
    return normalized;
  }
  throw new Error('Scheduled job execution mode must be same-thread or side-thread.');
}
