import type { AutomationMonitorCondition, AutomationMonitorEventSnapshot } from '../../../../packages/contracts/src/index.js';

export function evaluateMonitorCondition(condition: AutomationMonitorCondition, event: AutomationMonitorEventSnapshot) {
  const actual = readMetric(event, condition.metric);
  const expected = condition.value;
  switch (condition.operator) {
    case '>':
      return Number(actual) > Number(expected);
    case '>=':
      return Number(actual) >= Number(expected);
    case '<':
      return Number(actual) < Number(expected);
    case '<=':
      return Number(actual) <= Number(expected);
    case '==':
      return String(actual) === String(expected);
    case '!=':
      return String(actual) !== String(expected);
    default:
      return false;
  }
}

export function readMetric(event: AutomationMonitorEventSnapshot, metric: string): unknown {
  const key = String(metric || '').trim();
  if (!key) {
    return undefined;
  }
  if (key === 'subject') return event.subject;
  if (key === 'sourceType') return event.sourceType;
  const payload = event.payload || {};
  if (key === 'abs_change_percent') {
    return Math.abs(Number(payload.change_percent ?? payload.changePercent ?? 0));
  }
  const normalizedKey = key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
  if (Object.prototype.hasOwnProperty.call(payload, key)) {
    return payload[key];
  }
  if (Object.prototype.hasOwnProperty.call(payload, normalizedKey)) {
    return payload[normalizedKey];
  }
  return key.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[part];
  }, payload);
}

