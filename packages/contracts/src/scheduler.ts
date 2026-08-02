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

export function resolveContractEnum<T extends string>(input: {
  value: unknown;
  fallback: T;
  valid: readonly T[];
  aliases?: Record<string, T>;
  errorMessage: string;
}): T {
  const normalized = normalizeContractEnumValue(input.value || input.fallback).replace(/-/g, '_');
  const direct = input.valid.find((candidate) => candidate === normalized);
  if (direct) return direct;
  if (input.aliases && normalized in input.aliases) {
    return input.aliases[normalized];
  }
  throw new Error(input.errorMessage);
}

export function normalizeScheduledJobExecutionMode(value: unknown, fallback: ScheduledJobExecutionMode = 'same-thread'): ScheduledJobExecutionMode {
  const normalized = normalizeContractEnumValue(value || fallback);
  if (normalized === 'same-thread' || normalized === 'side-thread') {
    return normalized;
  }
  throw new Error('Scheduled job execution mode must be same-thread or side-thread.');
}
