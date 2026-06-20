import type { AutomationMonitorCondition, AutomationMonitorEventSnapshot } from '@cc/superai-contracts';

export function evaluateMonitorCondition(condition: AutomationMonitorCondition, event: AutomationMonitorEventSnapshot) {
  if (condition.expression) {
    return evaluateExpression(condition.expression, event);
  }
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

export function evaluateExpression(expression: string, event: AutomationMonitorEventSnapshot): boolean {
  const orParts = splitExpression(expression, '||');
  return orParts.some((orPart) =>
    splitExpression(orPart, '&&').every((andPart) => evaluateComparison(andPart.trim(), event))
  );
}

function evaluateComparison(expression: string, event: AutomationMonitorEventSnapshot) {
  const match = expression.match(/^([a-zA-Z0-9_.-]+)\s*(>=|<=|==|!=|>|<)\s*(.+)$/);
  if (!match) {
    throw new Error(`Unsupported monitor condition expression: ${expression}`);
  }
  const rawValue = String(match[3] || '').trim().replace(/^["']|["']$/g, '');
  const numeric = Number(rawValue);
  return evaluateMonitorCondition({
    metric: String(match[1] || '').trim(),
    operator: match[2] as AutomationMonitorCondition['operator'],
    value: Number.isFinite(numeric) && rawValue !== '' ? numeric : rawValue,
  }, event);
}

function splitExpression(expression: string, operator: '&&' | '||') {
  return expression
    .split(operator)
    .map((part) => part.trim())
    .filter(Boolean);
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
