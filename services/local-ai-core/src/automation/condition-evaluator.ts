import type { AutomationMonitorCondition, AutomationMonitorEventSnapshot } from '@cc/superai-contracts';

export function evaluateMonitorCondition(condition: AutomationMonitorCondition, event: AutomationMonitorEventSnapshot) {
  if (condition.expression) {
    return evaluateExpression(condition.expression, event);
  }
  const actual = readMetric(event, condition.metric);
  return evaluateOperatorComparison(condition.operator, actual, condition.value);
}

export function evaluateOperatorComparison(
  operator: AutomationMonitorCondition['operator'],
  actual: unknown,
  expected: unknown,
): boolean {
  switch (operator) {
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
  return evaluateRestrictedExpression(expression, (metric) => readMetric(event, metric));
}

export function evaluateRestrictedExpression(
  expression: string,
  contextOrResolver: Record<string, unknown> | ((metric: string) => unknown),
): boolean {
  const compiled = compileRestrictedExpression(expression);
  const resolveMetric = typeof contextOrResolver === 'function'
    ? contextOrResolver
    : (metric: string) => readContextMetric(contextOrResolver, metric);
  return compiled.some((orPart) =>
    orPart.every((comparison) => evaluateRestrictedComparison(comparison, resolveMetric))
  );
}

export type RestrictedExpressionComparison = {
  metric: string;
  operator: AutomationMonitorCondition['operator'];
  rawValue: string;
};

export type CompiledRestrictedExpression = RestrictedExpressionComparison[][];

export function validateRestrictedExpression(expression: string): void {
  compileRestrictedExpression(expression);
}

export function compileRestrictedExpression(expression: string): CompiledRestrictedExpression {
  const source = String(expression || '').trim();
  if (!source) throw new Error(`Unsupported monitor condition expression: ${expression}`);
  return source.split('||').map((orPart) => {
    if (!orPart.trim()) throw new Error(`Unsupported monitor condition expression: ${expression}`);
    return orPart.split('&&').map((andPart) => compileRestrictedComparison(andPart.trim(), expression));
  });
}

function compileRestrictedComparison(expression: string, original: string): RestrictedExpressionComparison {
  const match = expression.match(/^([a-zA-Z0-9_.-]+)\s*(>=|<=|==|!=|>|<)\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s&|<>=!]+)$/);
  if (!match) throw new Error(`Unsupported monitor condition expression: ${original}`);
  return {
    metric: String(match[1]),
    operator: match[2] as AutomationMonitorCondition['operator'],
    rawValue: String(match[3]),
  };
}

function evaluateRestrictedComparison(
  comparison: RestrictedExpressionComparison,
  resolveMetric: (metric: string) => unknown,
) {
  const rawValue = comparison.rawValue.replace(/^["']|["']$/g, '');
  const numeric = Number(rawValue);
  const actual = resolveMetric(comparison.metric);
  const expected = Number.isFinite(numeric) && rawValue !== '' ? numeric : rawValue;
  return evaluateOperatorComparison(comparison.operator, actual, expected);
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

function readContextMetric(context: Record<string, unknown>, metric: string): unknown {
  if (metric === 'abs_change_percent') {
    return Math.abs(Number(context.change_percent ?? context.changePercent ?? 0));
  }
  const normalizedKey = metric.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
  if (Object.prototype.hasOwnProperty.call(context, metric)) return context[metric];
  if (Object.prototype.hasOwnProperty.call(context, normalizedKey)) return context[normalizedKey];
  return metric.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[part];
  }, context);
}
