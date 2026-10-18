import { randomBytes } from 'node:crypto';
import type { AutomationMonitorCreateInput, AutomationMonitorSchedule } from '@cc/superai-contracts';
import { assertSupportedTimezone, compileCronExpression } from '../scheduler/cron.js';

export function prepareMonitorInput(input: AutomationMonitorCreateInput): AutomationMonitorCreateInput {
  if (input.sourceType === 'webhook') {
    const sourceConfig = { ...(input.sourceConfig || {}) };
    if (!sourceConfig.hookId || typeof sourceConfig.hookId !== 'string' || !sourceConfig.hookId.trim()) {
      sourceConfig.hookId = `wh_${randomBytes(6).toString('hex')}`;
    }
    if (!sourceConfig.token || typeof sourceConfig.token !== 'string' || !sourceConfig.token.trim()) {
      sourceConfig.token = `whsec_${randomBytes(16).toString('hex')}`;
    }
    return { ...input, sourceConfig };
  }
  return input;
}

export function assertValidMonitorSchedule(schedule: AutomationMonitorSchedule | undefined): void {
  if (!schedule) return;
  try {
    compileCronExpression(schedule.cron);
    assertSupportedTimezone(schedule.timezone);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Monitor schedule is invalid: ${message}`);
  }
}
