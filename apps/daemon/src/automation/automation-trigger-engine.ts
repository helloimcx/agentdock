import type { AutomationActivation } from '@cc/superai-contracts';
import {
  assertSupportedTimezone,
  compileCronExpression,
  cronMatchesFields,
  extractFieldsInTimezone,
  findNextCronMatchInTimezone,
  findNextCronMatchUtc,
  findPreviousCronMatchInTimezone,
  findPreviousCronMatchUtc,
  type CompiledCronExpression,
} from '../scheduler/cron.js';

const MINUTE_MS = 60_000;

export function nextActivationAt(activation: AutomationActivation, after: Date): Date | null {
  const afterMs = validDateMs(after, 'after');
  const compiledCron = validateActivation(activation);
  switch (activation.kind) {
    case 'provider-event':
      return null;
    case 'once': {
      const runAt = parseIsoTimestamp(activation.runAt, 'once runAt');
      return runAt.getTime() > afterMs ? runAt : null;
    }
    case 'interval': {
      const nextMs = (Math.floor(afterMs / activation.intervalMs) + 1) * activation.intervalMs;
      return validResultDate(nextMs);
    }
    case 'cron': {
      const compiled = requireCompiledCron(compiledCron);
      const search = isUtcTimezone(activation.timezone)
        ? findNextCronMatchUtc(compiled, after)
        : findNextCronMatchInTimezone(compiled, after, activation.timezone);
      if (search.date) return search.date;
      throw new Error(`No cron activation exists for expression: ${activation.expression} (${activation.timezone})`);
    }
  }
}

export function isActivationDue(
  activation: AutomationActivation,
  now: Date,
  nextCheckAt?: string,
): boolean {
  const nowMs = validDateMs(now, 'now');
  const compiledCron = validateActivation(activation);
  if (activation.kind === 'provider-event') return false;
  if (nextCheckAt !== undefined) {
    return parseIsoTimestamp(nextCheckAt, 'nextCheckAt').getTime() <= nowMs;
  }
  switch (activation.kind) {
    case 'once':
      return parseIsoTimestamp(activation.runAt, 'once runAt').getTime() <= nowMs;
    case 'interval':
      return nowMs % activation.intervalMs === 0;
    case 'cron': {
      if (nowMs !== floorUtcMinute(nowMs)) return false;
      return cronMatchesFields(requireCompiledCron(compiledCron), extractFieldsInTimezone(now, activation.timezone));
    }
  }
}

export function missedActivationAt(
  activation: AutomationActivation,
  lastCheckedAt: string | undefined,
  now: Date,
): Date | null {
  const nowMs = validDateMs(now, 'now');
  const compiledCron = validateActivation(activation);
  if (activation.kind === 'provider-event' || lastCheckedAt === undefined) return null;
  const lastCheckedMs = parseIsoTimestamp(lastCheckedAt, 'lastCheckedAt').getTime();
  if (lastCheckedMs >= nowMs) return null;

  switch (activation.kind) {
    case 'once': {
      const runAt = parseIsoTimestamp(activation.runAt, 'once runAt');
      return runAt.getTime() > lastCheckedMs && runAt.getTime() <= nowMs ? runAt : null;
    }
    case 'interval': {
      const latestMs = Math.floor(nowMs / activation.intervalMs) * activation.intervalMs;
      return latestMs > lastCheckedMs ? validResultDate(latestMs) : null;
    }
    case 'cron': {
      const compiled = requireCompiledCron(compiledCron);
      return (isUtcTimezone(activation.timezone)
        ? findPreviousCronMatchUtc(compiled, now, new Date(lastCheckedMs))
        : findPreviousCronMatchInTimezone(compiled, now, activation.timezone, new Date(lastCheckedMs))).date;
    }
  }
}

function validateActivation(activation: AutomationActivation): CompiledCronExpression | undefined {
  switch (activation.kind) {
    case 'provider-event':
      return undefined;
    case 'once':
      parseIsoTimestamp(activation.runAt, 'once runAt');
      return undefined;
    case 'interval':
      assertInterval(activation.intervalMs);
      return undefined;
    case 'cron':
      assertSupportedTimezone(activation.timezone);
      return compileCronExpression(activation.expression);
  }
}

function isUtcTimezone(timezone: string): boolean {
  return timezone === 'UTC' || timezone === 'Etc/UTC' || timezone === 'Z';
}

function assertInterval(intervalMs: number): void {
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new Error('Automation intervalMs must be a positive safe integer.');
  }
}

function parseIsoTimestamp(value: string, label: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new Error(`Automation ${label} must be a valid ISO timestamp.`);
  const date = new Date(value);
  validDateMs(date, label);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const calendarDate = new Date(0);
  calendarDate.setUTCFullYear(year, month - 1, day);
  calendarDate.setUTCHours(0, 0, 0, 0);
  if (
    calendarDate.getUTCFullYear() !== year
    || calendarDate.getUTCMonth() !== month - 1
    || calendarDate.getUTCDate() !== day
    || Number(hourText) > 23
    || Number(minuteText) > 59
    || Number(secondText) > 59
  ) {
    throw new Error(`Automation ${label} must be a valid ISO timestamp.`);
  }
  return date;
}

function requireCompiledCron(compiled: CompiledCronExpression | undefined): CompiledCronExpression {
  if (!compiled) throw new Error('Automation cron expression was not compiled.');
  return compiled;
}

function validDateMs(date: Date, label: string): number {
  const value = date.getTime();
  if (!Number.isFinite(value)) throw new Error(`Automation ${label} must be a valid date.`);
  return value;
}

function validResultDate(value: number): Date {
  const result = new Date(value);
  validDateMs(result, 'activation result');
  return result;
}

function floorUtcMinute(value: number): number {
  return Math.floor(value / MINUTE_MS) * MINUTE_MS;
}
