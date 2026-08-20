import {
  asRecord,
  isoTimestamp,
  normalizeAutomationDefinition,
  optionalString,
  requiredString,
  type AutomationDefinition,
  type AutomationEvaluation,
  type AutomationRun,
} from '@cc/superai-contracts';
import type {
  LocalAutomationEvaluationRow,
  LocalAutomationRow,
  LocalAutomationRunRow,
} from './acp-store-types.js';

export function rowToDefinition(row: LocalAutomationRow): AutomationDefinition {
  try {
    return normalizeDefinition({
      id: row.id,
      workspaceId: row.workspace_id,
      title: row.title,
      enabled: row.enabled === 1,
      health: row.health,
      ...(row.blocked_reason ? { blockedReason: row.blocked_reason } : {}),
      activation: parseStoredJson(row.activation_json, `Automation ${row.id} activation`),
      condition: parseStoredJson(row.condition_json, `Automation ${row.id} condition`),
      action: parseStoredJson(row.action_json, `Automation ${row.id} action`),
      delivery: parseStoredJson(row.delivery_json, `Automation ${row.id} delivery`),
      policies: parseStoredJson(row.policies_json, `Automation ${row.id} policies`),
      ...(row.last_successful_match === null ? {} : { lastSuccessfulMatch: row.last_successful_match === 1 }),
      ...(row.last_evaluation_at ? { lastEvaluationAt: row.last_evaluation_at } : {}),
      ...(row.last_triggered_at ? { lastTriggeredAt: row.last_triggered_at } : {}),
      consecutiveEvaluationFailures: row.consecutive_evaluation_failures,
      originKind: row.origin_kind,
      ...(row.legacy_metadata_json
        ? { legacyMetadata: parseStoredJson(row.legacy_metadata_json, `Automation ${row.id} legacy metadata`) }
        : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } catch (error) {
    throw withContext(`Automation ${row.id} contains invalid persisted data`, error);
  }
}

export function rowToEvaluation(row: LocalAutomationEvaluationRow): AutomationEvaluation {
  try {
    const evaluation = validateEvaluation(parseStoredJson(row.evaluation_json, `Automation evaluation ${row.id}`));
    const finishedAt = evaluation.status === 'finished' ? evaluation.finishedAt : null;
    assertDuplicatedField('id', row.id, evaluation.id);
    assertDuplicatedField('automationId', row.automation_id, evaluation.automationId);
    assertDuplicatedField('status', row.status, evaluation.status);
    assertDuplicatedField('activationKind', row.activation_kind, evaluation.activationKind);
    assertDuplicatedField('scriptVersionId', row.script_version_id, evaluation.scriptVersionId ?? null);
    assertDuplicatedField('startedAt', row.started_at, evaluation.startedAt);
    assertDuplicatedField('finishedAt', row.finished_at, finishedAt);
    return evaluation;
  } catch (error) {
    throw withContext(`Automation evaluation ${row.id} contains invalid persisted data`, error);
  }
}

export function rowToRun(row: LocalAutomationRunRow): AutomationRun {
  try {
    const run = validateRun(parseStoredJson(row.run_json, `Automation run ${row.id}`));
    assertDuplicatedField('id', row.id, run.id);
    assertDuplicatedField('automationId', row.automation_id, run.automationId);
    assertDuplicatedField('evaluationId', row.evaluation_id, run.evaluationId);
    assertDuplicatedField('status', row.status, run.status);
    assertDuplicatedField('createdAt', row.created_at, run.createdAt);
    return run;
  } catch (error) {
    throw withContext(`Automation run ${row.id} contains invalid persisted data`, error);
  }
}

export function normalizeDefinition(value: unknown): AutomationDefinition {
  const definition = { ...normalizeAutomationDefinition(value) };
  definition.createdAt = assertIsoTimestamp(definition.createdAt, 'Automation createdAt');
  definition.updatedAt = assertIsoTimestamp(definition.updatedAt, 'Automation updatedAt');
  if (definition.lastEvaluationAt !== undefined) {
    definition.lastEvaluationAt = assertIsoTimestamp(definition.lastEvaluationAt, 'Automation lastEvaluationAt');
  }
  if (definition.lastTriggeredAt !== undefined) {
    definition.lastTriggeredAt = assertIsoTimestamp(definition.lastTriggeredAt, 'Automation lastTriggeredAt');
  }
  if (definition.activation.kind === 'once') {
    definition.activation = {
      ...definition.activation,
      runAt: assertIsoTimestamp(definition.activation.runAt, 'Automation runAt'),
    };
  }
  return definition;
}

function assertDuplicatedField(label: string, indexedValue: unknown, jsonValue: unknown) {
  if (!Object.is(indexedValue, jsonValue)) {
    throw new Error(`stored ${label} does not match its indexed column.`);
  }
}

export function validateEvaluation(value: unknown): AutomationEvaluation {
  const input = asRecord(value, 'Automation evaluation');
  const id = requiredString(input.id, 'Automation evaluation id');
  const automationId = requiredString(input.automationId, 'Automation evaluation automationId');
  const activationKind = input.activationKind;
  if (activationKind !== 'cron' && activationKind !== 'once' && activationKind !== 'interval' && activationKind !== 'provider-event') {
    throw new Error('Automation evaluation activationKind is invalid.');
  }
  const startedAt = assertIsoTimestamp(input.startedAt, 'Automation evaluation startedAt');
  const scriptVersionId = optionalString(input.scriptVersionId, 'Automation evaluation scriptVersionId');
  if (input.status === 'running') {
    if (input.conditionOutcome !== undefined || input.triggerDecision !== undefined || input.finishedAt !== undefined) {
      throw new Error('Running automation evaluations cannot contain finish fields.');
    }
    return { id, automationId, status: 'running', activationKind, ...(scriptVersionId ? { scriptVersionId } : {}), startedAt };
  }
  if (input.status !== 'finished') throw new Error('Automation evaluation status must be running or finished.');
  const conditionOutcome = input.conditionOutcome;
  const triggerDecision = input.triggerDecision;
  const allowed =
    (conditionOutcome === 'matched' && ['triggered', 'not_rising', 'skipped_cooldown', 'skipped_action_running'].includes(String(triggerDecision))) ||
    (conditionOutcome === 'not_matched' && triggerDecision === 'not_rising') ||
    (conditionOutcome === 'error' && triggerDecision === 'not_evaluated') ||
    (conditionOutcome === 'skipped' && ['not_evaluated', 'skipped_concurrent', 'skipped_cooldown', 'skipped_action_running'].includes(String(triggerDecision)));
  if (!allowed) throw new Error('Automation evaluation condition outcome and trigger decision are incompatible.');
  const result: Record<string, unknown> = {
    id,
    automationId,
    status: 'finished',
    activationKind,
    ...(scriptVersionId ? { scriptVersionId } : {}),
    startedAt,
    conditionOutcome,
    triggerDecision,
    finishedAt: assertIsoTimestamp(input.finishedAt, 'Automation evaluation finishedAt'),
  };
  for (const key of ['triggeredAt'] as const) {
    if (input[key] !== undefined) result[key] = assertIsoTimestamp(input[key], `Automation evaluation ${key}`);
  }
  for (const key of ['durationMs', 'exitCode'] as const) {
    if (input[key] !== undefined) result[key] = assertInteger(input[key], `Automation evaluation ${key}`, key === 'durationMs');
  }
  for (const key of ['errorCategory', 'stdout', 'stderr', 'resultSummary'] as const) {
    if (input[key] !== undefined) result[key] = assertString(input[key], `Automation evaluation ${key}`);
  }
  if (input.outputTruncated !== undefined) {
    if (typeof input.outputTruncated !== 'boolean') throw new Error('Automation evaluation outputTruncated must be a boolean.');
    result.outputTruncated = input.outputTruncated;
  }
  for (const key of ['payload', 'nextState'] as const) {
    if (input[key] !== undefined) result[key] = asRecord(input[key], `Automation evaluation ${key}`);
  }
  for (const key of ['sandboxViolations'] as const) {
    if (input[key] !== undefined) result[key] = stringArray(input[key], `Automation evaluation ${key}`);
  }
  if (input.networkAudit !== undefined) {
    if (!Array.isArray(input.networkAudit)) throw new Error('Automation evaluation networkAudit must be an array.');
    result.networkAudit = input.networkAudit.map((entry, index) => {
      const record = asRecord(entry, `Automation evaluation networkAudit[${index}]`);
      if (typeof record.allowed !== 'boolean') throw new Error('Automation evaluation networkAudit allowed must be a boolean.');
      if (record.host === undefined) {
        const legacy = requiredString(record.target, 'Automation evaluation networkAudit target');
        const parsed = safeLegacyNetworkTarget(legacy);
        return { host: parsed.host, ...(parsed.port === undefined ? {} : { port: parsed.port }), allowed: record.allowed };
      }
      const port = record.port === undefined ? undefined : assertInteger(record.port, 'Automation evaluation networkAudit port', true);
      return {
        host: requiredString(record.host, 'Automation evaluation networkAudit host').toLowerCase(),
        ...(port === undefined ? {} : { port }), allowed: record.allowed,
        ...(record.timestamp === undefined ? {} : { timestamp: requiredString(record.timestamp, 'Automation evaluation networkAudit timestamp') }),
      };
    });
  }
  return result as unknown as AutomationEvaluation;
}

function safeLegacyNetworkTarget(target: string): { host: string; port?: number } {
  try {
    const url = new URL(target.includes('://') ? target : `https://${target}`);
    const port = url.port ? Number(url.port) : undefined;
    return { host: url.hostname.toLowerCase(), ...(Number.isSafeInteger(port) && port! >= 0 ? { port } : {}) };
  } catch { return { host: 'legacy-invalid-target' }; }
}

export function validateRun(value: unknown): AutomationRun {
  const input = asRecord(value, 'Automation run');
  const status = input.status;
  if (status !== 'queued' && status !== 'running' && status !== 'succeeded' && status !== 'failed' && status !== 'skipped') {
    throw new Error('Automation run status is invalid.');
  }
  const executionMode = input.executionMode;
  if (executionMode !== 'same-thread' && executionMode !== 'side-thread') {
    throw new Error('Automation run executionMode is invalid.');
  }
  const run: AutomationRun = {
    id: requiredString(input.id, 'Automation run id'),
    automationId: requiredString(input.automationId, 'Automation run automationId'),
    evaluationId: requiredString(input.evaluationId, 'Automation run evaluationId'),
    status,
    executionMode,
    createdAt: assertIsoTimestamp(input.createdAt, 'Automation run createdAt'),
  };
  for (const key of ['threadId', 'acpRunId', 'error'] as const) {
    if (input[key] !== undefined) run[key] = assertString(input[key], `Automation run ${key}`);
  }
  for (const key of ['startedAt', 'finishedAt'] as const) {
    if (input[key] !== undefined) run[key] = assertIsoTimestamp(input[key], `Automation run ${key}`);
  }
  if (input.deliveryStatus !== undefined) {
    if (!['pending', 'delivering', 'delivered', 'failed'].includes(String(input.deliveryStatus))) {
      throw new Error('Automation run deliveryStatus is invalid.');
    }
    run.deliveryStatus = input.deliveryStatus as AutomationRun['deliveryStatus'];
  }
  if (input.bridgeActivity !== undefined) run.bridgeActivity = asRecord(input.bridgeActivity, 'Automation run bridgeActivity');
  return run;
}

export function parseStoredJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw withContext(`${label} is malformed JSON`, error);
  }
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  return value;
}

export function assertIsoTimestamp(value: unknown, label: string): string {
  const timestamp = isoTimestamp(value, label);
  return new Date(timestamp).toISOString();
}

function assertInteger(value: unknown, label: string, nonNegative = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || (nonNegative && value < 0)) {
    throw new Error(`${label} must be ${nonNegative ? 'a non-negative ' : 'an '}integer.`);
  }
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label} must be an array of strings.`);
  }
  return [...value];
}

export function withContext(label: string, error: unknown): Error {
  return new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
}
