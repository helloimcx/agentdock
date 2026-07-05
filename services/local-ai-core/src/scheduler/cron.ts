const DAY_MS = 24 * 60 * 60 * 1000;
const GREGORIAN_CYCLE_DAYS = 146_097;
const MIN_DATE_MS = -8_640_000_000_000_000;
const MAX_DATE_MS = 8_640_000_000_000_000;

export interface CompiledCronExpression {
  readonly expression: string;
  readonly minutes: readonly number[];
  readonly hours: readonly number[];
  readonly daysOfMonth: readonly number[];
  readonly months: readonly number[];
  readonly daysOfWeek: readonly number[];
}

export interface CronDateFields {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
}

export interface CronSearchResult {
  date: Date | null;
  inspectedDays: number;
}

export function compileCronExpression(expression: string): CompiledCronExpression {
  const normalized = String(expression ?? '').trim();
  const fields = normalized ? normalized.split(/\s+/) : [];
  if (fields.length !== 5) {
    throw invalidCron(normalized, 'expected exactly 5 fields');
  }
  return Object.freeze({
    expression: normalized,
    minutes: compileField(normalized, 'minute', fields[0], 0, 59),
    hours: compileField(normalized, 'hour', fields[1], 0, 23),
    daysOfMonth: compileField(normalized, 'day-of-month', fields[2], 1, 31),
    months: compileField(normalized, 'month', fields[3], 1, 12),
    daysOfWeek: compileField(normalized, 'day-of-week', fields[4], 0, 6),
  });
}

export function cronMatchesFields(compiled: CompiledCronExpression, fields: CronDateFields): boolean {
  // Preserve the legacy scheduler's DOM+DOW AND behavior.
  return compiled.minutes.includes(fields.minute)
    && compiled.hours.includes(fields.hour)
    && compiled.daysOfMonth.includes(fields.dayOfMonth)
    && compiled.months.includes(fields.month)
    && compiled.daysOfWeek.includes(fields.dayOfWeek);
}

export function cronMatchesDate(cronExpr: string, date: Date): boolean {
  let compiled: CompiledCronExpression;
  try {
    compiled = compileCronExpression(cronExpr);
  } catch {
    return false;
  }
  return cronMatchesFields(compiled, {
    minute: date.getMinutes(),
    hour: date.getHours(),
    dayOfMonth: date.getDate(),
    month: date.getMonth() + 1,
    dayOfWeek: date.getDay(),
  });
}

export function findNextCronMatchUtc(compiled: CompiledCronExpression, after: Date): CronSearchResult {
  const afterMs = validDateMs(after, 'cron search date');
  let dayMs = startOfUtcDay(afterMs);
  for (let inspectedDays = 1; inspectedDays <= GREGORIAN_CYCLE_DAYS + 1; inspectedDays += 1) {
    if (dayMs > MAX_DATE_MS) return { date: null, inspectedDays };
    const day = new Date(dayMs);
    if (cronMatchesUtcDay(compiled, day)) {
      for (const hour of compiled.hours) {
        for (const minute of compiled.minutes) {
          const candidateMs = dayMs + hour * 60 * 60 * 1000 + minute * 60 * 1000;
          if (candidateMs > afterMs && candidateMs <= MAX_DATE_MS) {
            return { date: new Date(candidateMs), inspectedDays };
          }
        }
      }
    }
    dayMs += DAY_MS;
  }
  return { date: null, inspectedDays: GREGORIAN_CYCLE_DAYS + 1 };
}

export function findPreviousCronMatchUtc(
  compiled: CompiledCronExpression,
  atOrBefore: Date,
  afterExclusive?: Date,
): CronSearchResult {
  const atOrBeforeMs = validDateMs(atOrBefore, 'cron search date');
  const afterExclusiveMs = afterExclusive
    ? validDateMs(afterExclusive, 'cron search lower bound')
    : undefined;
  if (afterExclusiveMs !== undefined && afterExclusiveMs >= atOrBeforeMs) {
    return { date: null, inspectedDays: 0 };
  }
  const lowerBoundDayMs = afterExclusiveMs === undefined ? undefined : startOfUtcDay(afterExclusiveMs);
  let dayMs = startOfUtcDay(atOrBeforeMs);
  for (let inspectedDays = 1; inspectedDays <= GREGORIAN_CYCLE_DAYS + 1; inspectedDays += 1) {
    if (dayMs < MIN_DATE_MS) return { date: null, inspectedDays };
    if (lowerBoundDayMs !== undefined && dayMs < lowerBoundDayMs) {
      return { date: null, inspectedDays: inspectedDays - 1 };
    }
    const day = new Date(dayMs);
    if (cronMatchesUtcDay(compiled, day)) {
      for (let hourIndex = compiled.hours.length - 1; hourIndex >= 0; hourIndex -= 1) {
        for (let minuteIndex = compiled.minutes.length - 1; minuteIndex >= 0; minuteIndex -= 1) {
          const candidateMs = dayMs
            + compiled.hours[hourIndex] * 60 * 60 * 1000
            + compiled.minutes[minuteIndex] * 60 * 1000;
          if (
            candidateMs <= atOrBeforeMs
            && candidateMs >= MIN_DATE_MS
            && (afterExclusiveMs === undefined || candidateMs > afterExclusiveMs)
          ) {
            return { date: new Date(candidateMs), inspectedDays };
          }
        }
      }
    }
    if (dayMs === lowerBoundDayMs) return { date: null, inspectedDays };
    dayMs -= DAY_MS;
  }
  return { date: null, inspectedDays: GREGORIAN_CYCLE_DAYS + 1 };
}

export function floorToMinute(date: Date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    0,
    0,
  );
}

function compileField(
  expression: string,
  fieldName: string,
  field: string | undefined,
  min: number,
  max: number,
): readonly number[] {
  if (!field) throw invalidCron(expression, `${fieldName} field is empty`);
  const values = new Set<number>();
  const tokens = field.split(',');
  if (tokens.some((token) => token === '')) {
    throw invalidCron(expression, `${fieldName} contains an empty list item`);
  }
  for (const token of tokens) {
    const match = /^(\*|\d+|\d+-\d+)(?:\/(\d+))?$/.exec(token);
    if (!match) throw invalidCron(expression, `${fieldName} contains invalid token "${token}"`);
    const step = match[2] === undefined ? 1 : Number(match[2]);
    if (!Number.isSafeInteger(step) || step <= 0) {
      throw invalidCron(expression, `${fieldName} step must be a positive integer`);
    }
    const range = match[1];
    let start = min;
    let end = max;
    if (range !== '*') {
      const rangeParts = range.split('-');
      start = Number(rangeParts[0]);
      end = Number(rangeParts[1] ?? rangeParts[0]);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < min || end > max) {
        throw invalidCron(expression, `${fieldName} values must be between ${min} and ${max}`);
      }
      if (start > end) throw invalidCron(expression, `${fieldName} range start must not exceed its end`);
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return Object.freeze([...values].sort((left, right) => left - right));
}

function cronMatchesUtcDay(compiled: CompiledCronExpression, day: Date): boolean {
  return compiled.daysOfMonth.includes(day.getUTCDate())
    && compiled.months.includes(day.getUTCMonth() + 1)
    && compiled.daysOfWeek.includes(day.getUTCDay());
}

function startOfUtcDay(value: number): number {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function validDateMs(date: Date, label: string): number {
  const value = date.getTime();
  if (!Number.isFinite(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

function invalidCron(expression: string, reason: string): Error {
  return new Error(`Invalid cron expression "${expression}": ${reason}.`);
}
