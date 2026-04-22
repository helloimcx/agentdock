function expandSegment(segment: string, min: number, max: number) {
  const values = new Set<number>();
  const normalized = segment.trim();
  if (!normalized || normalized === '*') {
    for (let value = min; value <= max; value += 1) {
      values.add(value);
    }
    return values;
  }
  for (const part of normalized.split(',')) {
    const token = part.trim();
    if (!token) {
      continue;
    }
    const [rangePart, stepPart] = token.split('/');
    const step = Math.max(1, Number(stepPart || '1'));
    let rangeStart = min;
    let rangeEnd = max;
    if (rangePart && rangePart !== '*') {
      const [startPart, endPart] = rangePart.split('-');
      rangeStart = Math.max(min, Number(startPart));
      rangeEnd = Math.min(max, Number(endPart || startPart));
    }
    for (let value = rangeStart; value <= rangeEnd; value += step) {
      if (value >= min && value <= max) {
        values.add(value);
      }
    }
  }
  return values;
}

export function cronMatchesDate(cronExpr: string, date: Date) {
  const fields = String(cronExpr || '').trim().split(/\s+/);
  if (fields.length !== 5) {
    return false;
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const checks: Array<[string, number, number, number]> = [
    [minute, 0, 59, date.getMinutes()],
    [hour, 0, 23, date.getHours()],
    [dayOfMonth, 1, 31, date.getDate()],
    [month, 1, 12, date.getMonth() + 1],
    [dayOfWeek, 0, 6, date.getDay()],
  ];
  return checks.every(([segment, min, max, current]) => expandSegment(segment, min, max).has(current));
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
