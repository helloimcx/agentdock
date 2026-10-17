import { createHash, timingSafeEqual } from 'node:crypto';
import type { AutomationMonitorSchedule } from '@cc/superai-contracts';
import {
  compileCronExpression,
  cronMatchesFields,
  extractFieldsInTimezone,
} from '../scheduler/cron.js';

export class WebhookTriggerError extends Error {
  constructor(message: string, readonly status: 400 | 401 | 404) {
    super(message);
    this.name = 'WebhookTriggerError';
  }
}

// Hashing both sides first keeps the comparison constant-time regardless of
// token length, so a wrong-length guess cannot short-circuit or throw.
export function webhookTokenEquals(provided: string, expected: string): boolean {
  const providedDigest = createHash('sha256').update(provided).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

// A monitor with a schedule only polls when the current wall clock (in the schedule's
// timezone) matches the cron expression. Stored schedules are validated on create/update,
// so fail-open here would only trigger on corrupted state — degrading to always-poll is
// safer for a monitoring tool than silently dropping evaluations.
export function isMonitorWithinSchedule(schedule: AutomationMonitorSchedule | undefined, now: Date): boolean {
  if (!schedule) return true;
  try {
    const compiled = compileCronExpression(schedule.cron);
    return cronMatchesFields(compiled, extractFieldsInTimezone(now, schedule.timezone));
  } catch {
    return true;
  }
}
