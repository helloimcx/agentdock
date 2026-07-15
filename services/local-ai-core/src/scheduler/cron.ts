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

interface WallClockFields extends CronDateFields {
  year: number;
}

export function extractFieldsInTimezone(date: Date, timezone: string): CronDateFields {
  return stripYear(extractWallClock(date, timezone));
}

function extractWallClock(date: Date, timezone: string): WallClockFields {
  const parts = getFormatter(timezone).formatToParts(date);
  const map: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  const weekday = String(map.weekday ?? '').toLowerCase();
  const dayOfWeek = WEEKDAY_SHORT_TO_NUMBER[weekday];
  return {
    year: Number(map.year ?? '1970'),
    minute: Number(map.minute ?? '0'),
    hour: Number(map.hour ?? '0'),
    dayOfMonth: Number(map.day ?? '1'),
    month: Number(map.month ?? '1'),
    dayOfWeek: dayOfWeek ?? 0,
  };
}

function stripYear(fields: WallClockFields): CronDateFields {
  return {
    minute: fields.minute,
    hour: fields.hour,
    dayOfMonth: fields.dayOfMonth,
    month: fields.month,
    dayOfWeek: fields.dayOfWeek,
  };
}

// Convert a wall-clock time (Y/M/D h:m) in `timezone` to the matching UTC instant.
// Returns null when that wall clock never exists on that day (DST spring-forward gap),
// so callers can treat the slot as non-matching.
function wallClockToUtc(year: number, month: number, dayOfMonth: number, hour: number, minute: number, timezone: string): number | null {
  const targetWallMs = Date.UTC(year, month - 1, dayOfMonth, hour, minute, 0, 0);
  let utc = targetWallMs;
  for (let i = 0; i < 5; i += 1) {
    const f = extractWallClock(new Date(utc), timezone);
    const wallAsUtc = Date.UTC(f.year, f.month - 1, f.dayOfMonth, f.hour, f.minute, 0, 0);
    if (wallAsUtc === targetWallMs) {
      // Round-trip verified — this instant really is the requested wall clock in `timezone`.
      return utc;
    }
    // Fixed-point step: shift utc by the gap between where its wall clock lands and the target.
    utc = utc - wallAsUtc + targetWallMs;
  }
  // Did not converge to a self-consistent wall clock: the requested time is in a DST gap.
  return null;
}

// Day-level match: day-of-month AND month AND day-of-week (cron DOM+DOW AND semantics).
// Hour and minute are matched separately once a wall-clock day qualifies.
export function cronMatchesFieldsDay(compiled: CompiledCronExpression, fields: CronDateFields): boolean {
  return compiled.daysOfMonth.includes(fields.dayOfMonth)
    && compiled.months.includes(fields.month)
    && compiled.daysOfWeek.includes(fields.dayOfWeek);
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

// Timezone-aware variants: iterate in the target timezone's wall clock rather than UTC.
// These replace the UTC-only search used by the activation engine when timezone !== 'UTC'.
export function findNextCronMatchInTimezone(
  compiled: CompiledCronExpression,
  after: Date,
  timezone: string,
): CronSearchResult {
  assertSupportedTimezone(timezone);
  const afterMs = validDateMs(after, 'cron search date');
  const startFields = extractWallClock(after, timezone);
  // Begin at the start of the current wall-clock day so a later match on the same day is found.
  const startDay = wallClockToUtc(startFields.year, startFields.month, startFields.dayOfMonth, 0, 0, timezone);
  let dayMs = startDay ?? startOfUtcDay(Date.UTC(startFields.year, startFields.month - 1, startFields.dayOfMonth, 0, 0, 0, 0));
  for (let inspectedDays = 1; inspectedDays <= GREGORIAN_CYCLE_DAYS + 1; inspectedDays += 1) {
    if (dayMs > MAX_DATE_MS) return { date: null, inspectedDays };
    const dayFields = extractWallClock(new Date(dayMs), timezone);
    if (cronMatchesFieldsDay(compiled, stripYear(dayFields))) {
      for (const hour of compiled.hours) {
        for (const minute of compiled.minutes) {
          const candidateMs = wallClockToUtc(dayFields.year, dayFields.month, dayFields.dayOfMonth, hour, minute, timezone);
          if (candidateMs !== null && candidateMs > afterMs && candidateMs <= MAX_DATE_MS) {
            return { date: new Date(candidateMs), inspectedDays };
          }
        }
      }
    }
    const nextDay = wallClockToUtc(dayFields.year, dayFields.month, dayFields.dayOfMonth + 1, 0, 0, timezone);
    // A null here only means the next wall-clock midnight is in a DST gap (a handful of
    // zones transition at midnight). Fall back to 24 h later — the loop extracts the wall-clock
    // day from dayMs itself, so a one-day-probe offset cannot drop or duplicate a match.
    if (nextDay === null) {
      dayMs += DAY_MS;
    } else {
      dayMs = nextDay;
    }
  }
  return { date: null, inspectedDays: GREGORIAN_CYCLE_DAYS + 1 };
}

export function findPreviousCronMatchInTimezone(
  compiled: CompiledCronExpression,
  atOrBefore: Date,
  timezone: string,
  afterExclusive?: Date,
): CronSearchResult {
  assertSupportedTimezone(timezone);
  const atOrBeforeMs = validDateMs(atOrBefore, 'cron search date');
  const afterExclusiveMs = afterExclusive ? validDateMs(afterExclusive, 'cron search lower bound') : undefined;
  if (afterExclusiveMs !== undefined && afterExclusiveMs >= atOrBeforeMs) {
    return { date: null, inspectedDays: 0 };
  }
  const upperFields = extractWallClock(atOrBefore, timezone);
  const upperDay = wallClockToUtc(upperFields.year, upperFields.month, upperFields.dayOfMonth, 0, 0, timezone);
  let dayMs = upperDay ?? startOfUtcDay(Date.UTC(upperFields.year, upperFields.month - 1, upperFields.dayOfMonth, 0, 0, 0, 0));
  for (let inspectedDays = 1; inspectedDays <= GREGORIAN_CYCLE_DAYS + 1; inspectedDays += 1) {
    if (dayMs < MIN_DATE_MS) return { date: null, inspectedDays };
    if (afterExclusiveMs !== undefined && dayMs <= afterExclusiveMs) {
      return { date: null, inspectedDays: inspectedDays - 1 };
    }
    const dayFields = extractWallClock(new Date(dayMs), timezone);
    if (cronMatchesFieldsDay(compiled, stripYear(dayFields))) {
      for (let hourIndex = compiled.hours.length - 1; hourIndex >= 0; hourIndex -= 1) {
        for (let minuteIndex = compiled.minutes.length - 1; minuteIndex >= 0; minuteIndex -= 1) {
          const candidateMs = wallClockToUtc(
            dayFields.year,
            dayFields.month,
            dayFields.dayOfMonth,
            compiled.hours[hourIndex],
            compiled.minutes[minuteIndex],
            timezone,
          );
          if (
            candidateMs !== null
            && candidateMs <= atOrBeforeMs
            && candidateMs >= MIN_DATE_MS
            && (afterExclusiveMs === undefined || candidateMs > afterExclusiveMs)
          ) {
            return { date: new Date(candidateMs), inspectedDays };
          }
        }
      }
    }
    const prevDay = wallClockToUtc(dayFields.year, dayFields.month, dayFields.dayOfMonth - 1, 0, 0, timezone);
    // See findNextCronMatchInTimezone: a null only marks a DST-at-midnight quirk, not the end
    // of schedulable time. Step back 24 h and let the loop read the wall-clock day from dayMs.
    if (prevDay === null) {
      dayMs -= DAY_MS;
    } else {
      dayMs = prevDay;
    }
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

const WEEKDAY_SHORT_TO_NUMBER: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

// formatToParts is dramatically faster when the formatter is reused; cache one per zone.
const formatterCache = new Map<string, Intl.DateTimeFormat>();
function getFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    minute: '2-digit',
    hour: '2-digit',
    day: '2-digit',
    month: '2-digit',
    weekday: 'short',
    year: 'numeric',
  });
  formatterCache.set(timezone, formatter);
  return formatter;
}

// Intl.supportedValuesOf('timeZone') builds a full IANA list on first call; cache it per runtime.
let supportedTimezones: Set<string> | null = null;
function getSupportedTimezones(): Set<string> | null {
  if (supportedTimezones) return supportedTimezones;
  supportedTimezones = Intl.supportedValuesOf ? new Set(Intl.supportedValuesOf('timeZone')) : null;
  return supportedTimezones;
}

export function isValidTimezone(timezone: string): boolean {
  // "UTC"/"Z" are valid cron timezones but may be missing from Intl's list (which uses "Etc/UTC").
  if (timezone === 'UTC' || timezone === 'Z' || timezone === 'Etc/UTC') return true;
  const supported = getSupportedTimezones();
  if (supported) return supported.has(timezone);
  // Fallback for old runtimes: let the formatter constructor throw on bad zones.
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function assertSupportedTimezone(timezone: string): void {
  if (!isValidTimezone(timezone)) {
    throw new Error(`Automation scheduling received an unsupported timezone: ${timezone}`);
  }
}
