import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type {
  AutomationCreateInput,
  AutomationDefinition,
  AutomationEvaluation,
  AutomationEvaluationCreateInput,
  AutomationEvaluationFinishInput,
  AutomationRun,
  AutomationUpdateInput,
} from '@cc/superai-contracts';
import { normalizeAutomationDefinition } from '@cc/superai-contracts';
import type {
  LocalAutomationEvaluationRow,
  LocalAutomationMonitorRow,
  LocalAutomationRow,
  LocalAutomationRunRow,
  LocalScheduledJobRow,
} from '../../router/workspace-router-types.js';

export type AutomationStateUpdateInput = {
  health?: AutomationDefinition['health'];
  blockedReason?: string | null;
  lastSuccessfulMatch?: boolean | null;
  lastEvaluationAt?: string | null;
  lastTriggeredAt?: string | null;
  consecutiveEvaluationFailures?: number;
  nextCheckAt?: string | null;
};

export type AutomationRunCreateInput = Partial<
  Omit<AutomationRun, 'id' | 'automationId' | 'evaluationId' | 'executionMode' | 'createdAt'>
>;
export type AutomationRunUpdateInput = Partial<
  Omit<AutomationRun, 'id' | 'automationId' | 'evaluationId' | 'executionMode' | 'createdAt'>
>;
export type TrustedAutomationCreateInput = AutomationCreateInput & {
  originKind: Exclude<NonNullable<AutomationDefinition['originKind']>, 'native'>;
  legacyMetadata?: AutomationDefinition['legacyMetadata'];
};
export type TrustedAutomationUpdateInput = AutomationUpdateInput & {
  legacyMetadata?: AutomationDefinition['legacyMetadata'];
};

const AUTOMATION_COLUMNS = `
  id, workspace_id, title, enabled, health, blocked_reason, activation_json, condition_json, action_json,
  delivery_json, policies_json, last_successful_match, last_evaluation_at, last_triggered_at,
  consecutive_evaluation_failures, next_check_at, origin_kind, created_at, updated_at, legacy_metadata_json
`;
const EVALUATION_COLUMNS = `
  id, automation_id, status, activation_kind, script_version_id, started_at, finished_at, evaluation_json
`;
const RUN_COLUMNS = 'id, automation_id, evaluation_id, status, created_at, run_json';

export class LocalAutomationStore {
  constructor(private readonly db: DatabaseSync) {}

  list(workspaceId?: string): AutomationDefinition[] {
    const rows = this.db.prepare(`
      SELECT ${AUTOMATION_COLUMNS}
      FROM automations
      ${workspaceId ? 'WHERE workspace_id = ?' : ''}
      ORDER BY updated_at DESC
    `).all(...(workspaceId ? [workspaceId] : [])) as LocalAutomationRow[];
    return rows.map((row) => this.toDefinition(row));
  }

  get(id: string): AutomationDefinition | undefined {
    const row = this.db.prepare(`SELECT ${AUTOMATION_COLUMNS} FROM automations WHERE id = ?`)
      .get(id) as LocalAutomationRow | undefined;
    return row ? this.toDefinition(row) : undefined;
  }

  create(input: AutomationCreateInput): AutomationDefinition {
    return this.createWithOrigin(input, 'native');
  }

  createTrusted(input: TrustedAutomationCreateInput): AutomationDefinition {
    return this.createWithOrigin(input, input.originKind, input.legacyMetadata);
  }

  private createWithOrigin(
    input: AutomationCreateInput,
    originKind: NonNullable<AutomationDefinition['originKind']>,
    legacyMetadata?: AutomationDefinition['legacyMetadata'],
  ): AutomationDefinition {
    const now = new Date().toISOString();
    const uuid = randomUUID();
    const id = originKind === 'scheduled-job'
      ? uuid.split('-')[0] || uuid
      : originKind === 'automation-monitor'
        ? `monitor:${uuid}`
        : `automation:${uuid}`;
    const definition = normalizeDefinition({
      id,
      workspaceId: input.workspaceId,
      title: input.title,
      enabled: input.enabled,
      health: 'healthy',
      activation: input.activation,
      condition: input.condition,
      action: input.action,
      delivery: input.delivery,
      policies: input.policies,
      consecutiveEvaluationFailures: 0,
      originKind,
      ...(legacyMetadata ? { legacyMetadata } : {}),
      createdAt: now,
      updatedAt: now,
    });
    this.insertDefinition(definition);
    return this.get(definition.id)!;
  }

  update(id: string, input: AutomationUpdateInput): AutomationDefinition {
    return this.updateWithMetadata(id, input);
  }

  updateTrusted(id: string, input: TrustedAutomationUpdateInput): AutomationDefinition {
    return this.updateWithMetadata(id, input, input.legacyMetadata);
  }

  private updateWithMetadata(
    id: string,
    input: AutomationUpdateInput,
    legacyMetadata?: AutomationDefinition['legacyMetadata'],
  ): AutomationDefinition {
    const existing = this.requireDefinition(id);
    const candidate = { ...existing };
    if (input.title !== undefined) candidate.title = input.title;
    if (input.enabled !== undefined) candidate.enabled = input.enabled;
    if (input.activation !== undefined) candidate.activation = input.activation;
    if (input.condition !== undefined) candidate.condition = input.condition;
    if (input.action !== undefined) candidate.action = input.action;
    if (input.delivery !== undefined) candidate.delivery = input.delivery;
    if (input.policies !== undefined) candidate.policies = input.policies;
    if (legacyMetadata !== undefined) candidate.legacyMetadata = legacyMetadata;
    candidate.updatedAt = new Date().toISOString();
    const definition = normalizeDefinition(candidate);
    this.writeDefinition(definition);
    return this.get(id)!;
  }

  updateState(id: string, input: AutomationStateUpdateInput): AutomationDefinition {
    const existing = this.requireDefinition(id);
    const candidate: Record<string, unknown> = { ...existing, updatedAt: new Date().toISOString() };
    this.applyNullable(candidate, input, 'blockedReason');
    this.applyNullable(candidate, input, 'lastSuccessfulMatch');
    this.applyNullable(candidate, input, 'lastEvaluationAt');
    this.applyNullable(candidate, input, 'lastTriggeredAt');
    if (input.health !== undefined) candidate.health = input.health;
    if (input.consecutiveEvaluationFailures !== undefined) {
      candidate.consecutiveEvaluationFailures = input.consecutiveEvaluationFailures;
    }
    if (candidate.health === 'healthy') {
      delete candidate.blockedReason;
    } else if (
      candidate.health === 'blocked' &&
      (typeof candidate.blockedReason !== 'string' || !candidate.blockedReason.trim())
    ) {
      throw new Error('Blocked automation health requires a non-empty blocked reason.');
    }
    const definition = normalizeDefinition(candidate);
    const nextCheckAt = Object.prototype.hasOwnProperty.call(input, 'nextCheckAt')
      ? input.nextCheckAt ?? null
      : this.getNextCheckAt(id);
    const canonicalNextCheckAt = nextCheckAt === null
      ? null
      : assertIsoTimestamp(nextCheckAt, 'Automation nextCheckAt');
    this.writeDefinition(definition, canonicalNextCheckAt);
    return this.get(id)!;
  }

  delete(id: string) {
    const result = this.db.prepare('DELETE FROM automations WHERE id = ?').run(id);
    if (result.changes === 0) throw new Error(`Automation not found: ${id}`);
    return { deleted: true };
  }

  createEvaluation(automationId: string, input: AutomationEvaluationCreateInput): AutomationEvaluation {
    this.requireDefinition(automationId);
    const evaluation = validateEvaluation({
      id: `automation-evaluation:${randomUUID()}`,
      automationId,
      status: 'running',
      activationKind: input.activationKind,
      ...(input.scriptVersionId === undefined ? {} : { scriptVersionId: input.scriptVersionId }),
      startedAt: input.startedAt,
    });
    this.insertEvaluation(evaluation);
    return this.getEvaluation(evaluation.id)!;
  }

  finishEvaluation(evaluationId: string, input: AutomationEvaluationFinishInput): AutomationEvaluation {
    const existing = this.requireEvaluation(evaluationId);
    if (existing.status !== 'running') throw new Error(`Automation evaluation already finished: ${evaluationId}`);
    const evaluation = validateEvaluation({
      id: existing.id,
      automationId: existing.automationId,
      activationKind: existing.activationKind,
      ...(existing.scriptVersionId === undefined ? {} : { scriptVersionId: existing.scriptVersionId }),
      startedAt: existing.startedAt,
      status: 'finished',
      ...pickEvaluationFinishFields(input),
    });
    if (evaluation.status !== 'finished') throw new Error('Finished automation evaluation validation failed.');
    this.db.prepare(`
      UPDATE automation_evaluations
      SET status = ?, finished_at = ?, evaluation_json = ?
      WHERE id = ?
    `).run(evaluation.status, evaluation.finishedAt, JSON.stringify(evaluation), evaluationId);
    return this.getEvaluation(evaluationId)!;
  }

  listEvaluations(automationId: string): AutomationEvaluation[] {
    const rows = this.db.prepare(`
      SELECT ${EVALUATION_COLUMNS}
      FROM automation_evaluations
      WHERE automation_id = ?
      ORDER BY started_at DESC, id DESC
    `).all(automationId) as LocalAutomationEvaluationRow[];
    return rows.map((row) => this.toEvaluation(row));
  }

  getLatestEvaluationWithState(automationId: string): AutomationEvaluation | undefined {
    const row = this.db.prepare(`
      SELECT ${EVALUATION_COLUMNS}
      FROM automation_evaluations
      WHERE automation_id = ?
        AND status = 'finished'
        AND json_type(evaluation_json, '$.nextState') = 'object'
      ORDER BY started_at DESC, id DESC
      LIMIT 1
    `).get(automationId) as LocalAutomationEvaluationRow | undefined;
    return row ? this.toEvaluation(row) : undefined;
  }

  createRun(
    automationId: string,
    evaluationId: string,
    input: AutomationRunCreateInput = {},
  ): AutomationRun {
    const automation = this.requireDefinition(automationId);
    const evaluation = this.requireEvaluation(evaluationId);
    if (evaluation.automationId !== automationId) {
      throw new Error(`Automation evaluation ${evaluationId} does not belong to automation ${automationId}.`);
    }
    if (
      evaluation.status !== 'finished' ||
      evaluation.conditionOutcome !== 'matched' ||
      evaluation.triggerDecision !== 'triggered'
    ) {
      throw new Error('Automation action runs require a finished evaluation with matched outcome and triggered decision.');
    }
    if (this.getRunByEvaluation(evaluationId)) {
      throw new Error(`Automation evaluation already has an action run: ${evaluationId}`);
    }
    const mutableFields = pickRunMutableFields(input);
    const run = validateRun({
      id: `automation-run:${randomUUID()}`,
      automationId,
      evaluationId,
      executionMode: automation.action.executionMode,
      createdAt: new Date().toISOString(),
      status: 'queued',
      ...mutableFields,
    });
    this.db.prepare(`
      INSERT INTO automation_runs (id, automation_id, evaluation_id, status, created_at, run_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(run.id, run.automationId, run.evaluationId, run.status, run.createdAt, JSON.stringify(run));
    return this.getRun(run.id)!;
  }

  updateRun(runId: string, input: AutomationRunUpdateInput): AutomationRun {
    const existing = this.requireRun(runId);
    const run = validateRun({ ...existing, ...pickRunMutableFields(input) });
    this.db.prepare('UPDATE automation_runs SET status = ?, run_json = ? WHERE id = ?')
      .run(run.status, JSON.stringify(run), runId);
    return this.getRun(runId)!;
  }

  listRuns(automationId: string): AutomationRun[] {
    const rows = this.db.prepare(`
      SELECT ${RUN_COLUMNS}
      FROM automation_runs
      WHERE automation_id = ?
      ORDER BY created_at DESC, id DESC
    `).all(automationId) as LocalAutomationRunRow[];
    return rows.map((row) => this.toRun(row));
  }

  reconcileInterruptedRuns(reason: string, finishedAt: string): AutomationRun[] {
    const interruptedAt = assertIsoTimestamp(finishedAt, 'Automation interrupted run finishedAt');
    const rows = this.db.prepare(`
      SELECT ${RUN_COLUMNS}
      FROM automation_runs
      WHERE status IN ('queued', 'running')
      ORDER BY created_at, id
    `).all() as LocalAutomationRunRow[];
    return rows.map((row) => this.updateRun(row.id, {
      status: 'failed',
      deliveryStatus: 'failed',
      error: reason,
      finishedAt: interruptedAt,
    }));
  }

  importLegacyRecords(): { scheduled: number; monitors: number } {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      let scheduled = 0;
      let monitors = 0;
      const jobs = this.db.prepare(`
        SELECT id, workspace_id, platform, route_type, route_config, execution_mode, trigger_type, cron_expr, run_at,
               prompt_template, description, enabled, concurrency_policy, created_at, updated_at, last_run_at,
               last_status, last_error
        FROM scheduled_jobs
      `).all() as LocalScheduledJobRow[];
      for (const row of jobs) {
        try {
          scheduled += this.importScheduledJob(row);
        } catch (error) {
          throw withContext(`Scheduled job ${row.id} failed legacy import`, error);
        }
      }

      const legacyMonitors = this.db.prepare(`
        SELECT id, workspace_id, title, source_type, source_config_json, condition_json, prompt_template, platform,
               route_type, route_config, execution_mode, enabled, cooldown_ms, concurrency_policy, last_state_json,
               created_at, updated_at, last_triggered_at, last_status, last_error
        FROM automation_monitors
      `).all() as LocalAutomationMonitorRow[];
      for (const row of legacyMonitors) {
        try {
          monitors += this.importMonitor(row);
        } catch (error) {
          throw withContext(`Automation monitor ${row.id} failed legacy import`, error);
        }
      }
      this.db.exec('COMMIT');
      return { scheduled, monitors };
    } catch (error) {
      // Legacy migration is intentionally atomic and fail-fast; Task 4 reports this as degraded startup.
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  pruneEvaluations(now: Date): number {
    if (Number.isNaN(now.getTime())) throw new Error('Evaluation retention time must be a valid date.');
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000).toISOString();
    const result = this.db.prepare(`
      WITH ranked AS (
        SELECT id, automation_id, started_at,
               ROW_NUMBER() OVER (PARTITION BY automation_id ORDER BY started_at DESC, id DESC) AS position
        FROM automation_evaluations
      ), state_ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY automation_id ORDER BY started_at DESC, id DESC) AS position
        FROM automation_evaluations
        WHERE json_type(evaluation_json, '$.nextState') IS NOT NULL
      ), latest_state AS (
        SELECT id FROM state_ranked WHERE position = 1
      )
      DELETE FROM automation_evaluations
      WHERE id IN (SELECT id FROM ranked WHERE started_at < ? OR position > 1000)
        AND id NOT IN (SELECT id FROM latest_state)
        AND NOT EXISTS (
          SELECT 1 FROM automation_runs WHERE automation_runs.evaluation_id = automation_evaluations.id
        )
    `).run(cutoff);
    return Number(result.changes);
  }

  private getEvaluation(id: string): AutomationEvaluation | undefined {
    const row = this.db.prepare(`SELECT ${EVALUATION_COLUMNS} FROM automation_evaluations WHERE id = ?`)
      .get(id) as LocalAutomationEvaluationRow | undefined;
    return row ? this.toEvaluation(row) : undefined;
  }

  private getRun(id: string): AutomationRun | undefined {
    const row = this.db.prepare(`SELECT ${RUN_COLUMNS} FROM automation_runs WHERE id = ?`)
      .get(id) as LocalAutomationRunRow | undefined;
    return row ? this.toRun(row) : undefined;
  }

  private getRunByEvaluation(evaluationId: string): AutomationRun | undefined {
    const row = this.db.prepare(`SELECT ${RUN_COLUMNS} FROM automation_runs WHERE evaluation_id = ?`)
      .get(evaluationId) as LocalAutomationRunRow | undefined;
    return row ? this.toRun(row) : undefined;
  }

  private requireDefinition(id: string): AutomationDefinition {
    const definition = this.get(id);
    if (!definition) throw new Error(`Automation not found: ${id}`);
    return definition;
  }

  private requireEvaluation(id: string): AutomationEvaluation {
    const evaluation = this.getEvaluation(id);
    if (!evaluation) throw new Error(`Automation evaluation not found: ${id}`);
    return evaluation;
  }

  private requireRun(id: string): AutomationRun {
    const run = this.getRun(id);
    if (!run) throw new Error(`Automation run not found: ${id}`);
    return run;
  }

  private insertDefinition(definition: AutomationDefinition, nextCheckAt: string | null = null, ignoreConflict = false) {
    const canonicalDefinition = normalizeDefinition(definition);
    const canonicalNextCheckAt = nextCheckAt === null
      ? null
      : assertIsoTimestamp(nextCheckAt, 'Automation nextCheckAt');
    const result = this.db.prepare(`
      INSERT INTO automations (
        id, workspace_id, title, enabled, health, blocked_reason, activation_json, condition_json, action_json,
        delivery_json, policies_json, last_successful_match, last_evaluation_at, last_triggered_at,
        consecutive_evaluation_failures, next_check_at, origin_kind, created_at, updated_at, legacy_metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ${ignoreConflict ? 'ON CONFLICT(id) DO NOTHING' : ''}
    `).run(...this.definitionValues(canonicalDefinition, canonicalNextCheckAt));
    return Number(result.changes);
  }

  private insertEvaluation(evaluation: AutomationEvaluation, ignoreConflict = false) {
    const finishedAt = evaluation.status === 'finished' ? evaluation.finishedAt : null;
    const result = this.db.prepare(`
      INSERT INTO automation_evaluations (
        id, automation_id, status, activation_kind, script_version_id, started_at, finished_at, evaluation_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ${ignoreConflict ? 'ON CONFLICT(id) DO NOTHING' : ''}
    `).run(
      evaluation.id,
      evaluation.automationId,
      evaluation.status,
      evaluation.activationKind,
      evaluation.scriptVersionId ?? null,
      evaluation.startedAt,
      finishedAt,
      JSON.stringify(evaluation),
    );
    return Number(result.changes);
  }

  private writeDefinition(definition: AutomationDefinition, nextCheckAt = this.getNextCheckAt(definition.id)) {
    const canonicalDefinition = normalizeDefinition(definition);
    const canonicalNextCheckAt = nextCheckAt === null
      ? null
      : assertIsoTimestamp(nextCheckAt, 'Automation nextCheckAt');
    this.db.prepare(`
      UPDATE automations SET
        workspace_id = ?, title = ?, enabled = ?, health = ?, blocked_reason = ?, activation_json = ?,
        condition_json = ?, action_json = ?, delivery_json = ?, policies_json = ?, last_successful_match = ?,
        last_evaluation_at = ?, last_triggered_at = ?, consecutive_evaluation_failures = ?, next_check_at = ?,
        origin_kind = ?, created_at = ?, updated_at = ?, legacy_metadata_json = ?
      WHERE id = ?
    `).run(...this.definitionValues(canonicalDefinition, canonicalNextCheckAt).slice(1), canonicalDefinition.id);
  }

  private definitionValues(definition: AutomationDefinition, nextCheckAt: string | null): SQLInputValue[] {
    return [
      definition.id,
      definition.workspaceId,
      definition.title,
      definition.enabled ? 1 : 0,
      definition.health,
      definition.blockedReason ?? null,
      JSON.stringify(definition.activation),
      JSON.stringify(definition.condition),
      JSON.stringify(definition.action),
      JSON.stringify(definition.delivery),
      JSON.stringify(definition.policies),
      definition.lastSuccessfulMatch === undefined ? null : definition.lastSuccessfulMatch ? 1 : 0,
      definition.lastEvaluationAt ?? null,
      definition.lastTriggeredAt ?? null,
      definition.consecutiveEvaluationFailures,
      nextCheckAt,
      definition.originKind ?? 'native',
      definition.createdAt,
      definition.updatedAt,
      definition.legacyMetadata ? JSON.stringify(definition.legacyMetadata) : null,
    ];
  }

  getNextCheckAt(id: string): string | null {
    const row = this.db.prepare('SELECT next_check_at FROM automations WHERE id = ?').get(id) as
      | { next_check_at: string | null }
      | undefined;
    return row?.next_check_at ?? null;
  }

  private toDefinition(row: LocalAutomationRow): AutomationDefinition {
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

  private toEvaluation(row: LocalAutomationEvaluationRow): AutomationEvaluation {
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

  private toRun(row: LocalAutomationRunRow): AutomationRun {
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

  private importScheduledJob(row: LocalScheduledJobRow): number {
    const consumedOnce = row.trigger_type === 'once' && Boolean(row.last_run_at || row.last_status);
    const activation = row.trigger_type === 'once'
      ? { kind: 'once' as const, runAt: row.run_at }
      : { kind: 'cron' as const, expression: row.cron_expr, timezone: 'UTC' };
    const definition = normalizeDefinition({
      id: row.id,
      workspaceId: row.workspace_id,
      title: row.description.trim() || row.prompt_template.trim(),
      enabled: consumedOnce ? false : row.enabled === 1,
      health: 'healthy',
      activation,
      condition: { kind: 'always' },
      action: { kind: 'agent-prompt', promptTemplate: row.prompt_template, executionMode: row.execution_mode },
      delivery: {
        platform: row.platform,
        route: parseStoredJson(row.route_config, `Scheduled job ${row.id} route`),
      },
      policies: { concurrency: 'skip-if-running', cooldownMs: 0 },
      ...(row.last_status ? { lastSuccessfulMatch: row.last_status === 'succeeded' } : {}),
      ...(row.last_run_at || row.last_status
        ? { lastEvaluationAt: row.last_run_at || row.updated_at }
        : {}),
      ...(row.last_run_at ? { lastTriggeredAt: row.last_run_at } : {}),
      consecutiveEvaluationFailures: row.last_status === 'failed' ? 1 : 0,
      originKind: 'scheduled-job',
      legacyMetadata: { scheduledDescription: row.description },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
    return this.insertDefinition(
      definition,
      row.trigger_type === 'once' && !consumedOnce ? row.run_at : null,
      true,
    );
  }

  private importMonitor(row: LocalAutomationMonitorRow): number {
    const sourceConfig = parseStoredJson(row.source_config_json, `Automation monitor ${row.id} source config`);
    const legacyCondition = asRecord(
      parseStoredJson(row.condition_json, `Automation monitor ${row.id} condition`),
      `Automation monitor ${row.id} condition`,
    );
    const lastState = row.last_state_json
      ? asRecord(parseStoredJson(row.last_state_json, `Automation monitor ${row.id} state`), `Automation monitor ${row.id} state`)
      : undefined;
    const expression = typeof legacyCondition.expression === 'string' && legacyCondition.expression.trim()
      ? legacyCondition.expression.trim()
      : `${String(legacyCondition.metric || '').trim()} ${String(legacyCondition.operator || '').trim()} ${JSON.stringify(legacyCondition.value)}`;
    const definition = normalizeDefinition({
      id: row.id,
      workspaceId: row.workspace_id,
      title: row.title,
      enabled: row.enabled === 1,
      health: 'healthy',
      activation: { kind: 'provider-event', sourceType: row.source_type, sourceConfig },
      condition: { kind: 'expression', expression },
      action: { kind: 'agent-prompt', promptTemplate: row.prompt_template, executionMode: row.execution_mode },
      delivery: {
        platform: row.platform,
        route: parseStoredJson(row.route_config, `Automation monitor ${row.id} route`),
      },
      policies: { concurrency: 'skip-if-running', cooldownMs: row.cooldown_ms },
      ...(typeof lastState?.lastSuccessfulMatch === 'boolean'
        ? { lastSuccessfulMatch: lastState.lastSuccessfulMatch }
        : {}),
      ...(row.last_triggered_at ? { lastEvaluationAt: row.last_triggered_at, lastTriggeredAt: row.last_triggered_at } : {}),
      consecutiveEvaluationFailures: row.last_status === 'failed' ? 1 : 0,
      originKind: 'automation-monitor',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
    const imported = this.insertDefinition(definition, null, true);
    if (lastState && this.get(row.id)?.originKind === 'automation-monitor') {
      const stateTimestamp = row.last_triggered_at ?? row.updated_at;
      const stateEvaluation = validateEvaluation({
        id: `automation-evaluation:legacy-monitor-state:${row.id}`,
        automationId: row.id,
        status: 'finished',
        activationKind: 'provider-event',
        startedAt: stateTimestamp,
        conditionOutcome: 'skipped',
        triggerDecision: 'not_evaluated',
        finishedAt: stateTimestamp,
        resultSummary: 'Imported legacy monitor state.',
        nextState: lastState,
      });
      this.insertEvaluation(stateEvaluation, true);
    }
    return imported;
  }

  private applyNullable(
    candidate: Record<string, unknown>,
    input: AutomationStateUpdateInput,
    key: keyof AutomationStateUpdateInput,
  ) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) return;
    const value = input[key];
    if (value === null || value === undefined) delete candidate[key];
    else candidate[key] = value;
  }
}

function pickEvaluationFinishFields(input: AutomationEvaluationFinishInput): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    conditionOutcome: input.conditionOutcome,
    triggerDecision: input.triggerDecision,
    finishedAt: input.finishedAt,
  };
  for (const key of [
    'triggeredAt',
    'durationMs',
    'exitCode',
    'errorCategory',
    'stdout',
    'stderr',
    'outputTruncated',
    'resultSummary',
    'payload',
    'nextState',
    'sandboxViolations',
    'networkAudit',
  ] as const) {
    if (input[key] !== undefined) fields[key] = input[key];
  }
  return fields;
}

function pickRunMutableFields(input: AutomationRunCreateInput | AutomationRunUpdateInput): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const key of [
    'status',
    'threadId',
    'acpRunId',
    'deliveryStatus',
    'bridgeActivity',
    'error',
    'startedAt',
    'finishedAt',
  ] as const) {
    if (input[key] !== undefined) fields[key] = input[key];
  }
  return fields;
}

function normalizeDefinition(value: unknown): AutomationDefinition {
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

function validateEvaluation(value: unknown): AutomationEvaluation {
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
      const port = record.port === undefined ? undefined : assertInteger(record.port, 'Automation evaluation networkAudit port', true);
      return {
        host: requiredString(record.host, 'Automation evaluation networkAudit host').toLowerCase(),
        ...(port === undefined ? {} : { port }),
        allowed: record.allowed,
        timestamp: requiredString(record.timestamp, 'Automation evaluation networkAudit timestamp'),
      };
    });
  }
  return result as unknown as AutomationEvaluation;
}

function validateRun(value: unknown): AutomationRun {
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

function parseStoredJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw withContext(`${label} is malformed JSON`, error);
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requiredString(value, label);
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  return value;
}

function assertIsoTimestamp(value: unknown, label: string): string {
  const timestamp = requiredString(value, label);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(timestamp);
  if (!match || Number.isNaN(Date.parse(timestamp))) {
    throw new Error(`${label} must be a valid ISO timestamp.`);
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day ||
    Number(hourText) > 23 ||
    Number(minuteText) > 59 ||
    Number(secondText) > 59
  ) {
    throw new Error(`${label} must be a valid ISO timestamp.`);
  }
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

function withContext(label: string, error: unknown): Error {
  return new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
}
