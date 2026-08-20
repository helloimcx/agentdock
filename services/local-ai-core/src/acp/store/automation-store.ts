import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import {
  asRecord,
  type AutomationCreateInput,
  type AutomationDefinition,
  type AutomationEvaluation,
  type AutomationEvaluationCreateInput,
  type AutomationEvaluationFinishInput,
  type AutomationRun,
  type AutomationUpdateInput,
} from '@cc/superai-contracts';
import type {
  LocalAutomationEvaluationRow,
  LocalAutomationMonitorRow,
  LocalAutomationRow,
  LocalAutomationRunRow,
  LocalScheduledJobRow,
} from './acp-store-types.js';
import { SqlPredicateBuilder } from './utils.js';
import {
  assertIsoTimestamp,
  normalizeDefinition,
  parseStoredJson,
  rowToDefinition,
  rowToEvaluation,
  rowToRun,
  validateEvaluation,
  validateRun,
  withContext,
} from './automation-store-mappers.js';

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
  Omit<AutomationRun, 'id' | 'automationId' | 'evaluationId' | 'executionMode'>
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

  list(
    workspaceId?: string,
    originKind?: NonNullable<AutomationDefinition['originKind']>,
    channelId?: string,
    platform?: string,
  ): AutomationDefinition[] {
    const filter = new SqlPredicateBuilder()
      .eq('workspace_id', workspaceId)
      .eq('origin_kind', originKind);
    const rows = this.db.prepare(`
      SELECT ${AUTOMATION_COLUMNS}
      FROM automations
      ${filter.whereClause()}
      ORDER BY updated_at DESC
    `).all(...filter.params) as LocalAutomationRow[];
    let definitions = rows.map((row) => rowToDefinition(row));
    if (channelId) {
      definitions = definitions.filter((def) => def.delivery?.route?.channelId === channelId);
    }
    if (platform) {
      const norm = platform.trim().toLowerCase();
      definitions = definitions.filter((def) => {
        const p = (def.delivery?.platform || '').toLowerCase();
        return p === norm || p.startsWith(`${norm}:`);
      });
    }
    return definitions;
  }

  get(id: string): AutomationDefinition | undefined {
    const row = this.db.prepare(`SELECT ${AUTOMATION_COLUMNS} FROM automations WHERE id = ?`)
      .get(id) as LocalAutomationRow | undefined;
    return row ? rowToDefinition(row) : undefined;
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
    let id = '';
    if (originKind === 'scheduled-job') {
      for (let i = 0; i < 5; i++) {
        const candidate = randomUUID().split('-')[0];
        const existing = this.db.prepare('SELECT id FROM automations WHERE id = ?').get(candidate);
        if (!existing) {
          id = candidate;
          break;
        }
      }
      if (!id) id = randomUUID();
    } else if (originKind === 'automation-monitor') {
      id = `monitor:${randomUUID()}`;
    } else {
      id = `automation:${randomUUID()}`;
    }
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
    return definition;
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
    return definition;
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
    return definition;
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
    return evaluation;
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
    return evaluation;
  }

  listEvaluations(automationId: string): AutomationEvaluation[] {
    const rows = this.db.prepare(`
      SELECT ${EVALUATION_COLUMNS}
      FROM automation_evaluations
      WHERE automation_id = ?
      ORDER BY started_at DESC, id DESC
    `).all(automationId) as LocalAutomationEvaluationRow[];
    return rows.map((row) => rowToEvaluation(row));
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
    return row ? rowToEvaluation(row) : undefined;
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
    return run;
  }

  updateRun(runId: string, input: AutomationRunUpdateInput): AutomationRun {
    const existing = this.requireRun(runId);
    const run = validateRun({ ...existing, ...pickRunMutableFields(input) });
    this.db.prepare('UPDATE automation_runs SET status = ?, run_json = ? WHERE id = ?')
      .run(run.status, JSON.stringify(run), runId);
    return run;
  }

  listRuns(automationId: string): AutomationRun[] {
    const rows = this.db.prepare(`
      SELECT ${RUN_COLUMNS}
      FROM automation_runs
      WHERE automation_id = ?
      ORDER BY created_at DESC, id DESC
    `).all(automationId) as LocalAutomationRunRow[];
    return rows.map((row) => rowToRun(row));
  }

  listLatestFinishedEvaluationByOrigin(
    originKind: Exclude<NonNullable<AutomationDefinition['originKind']>, 'native'>,
    workspaceId?: string,
  ): Map<string, AutomationEvaluation> {
    return this.listLatestEvaluationByOrigin(originKind, workspaceId, '');
  }

  listLatestEvaluationWithStateByOrigin(
    originKind: Exclude<NonNullable<AutomationDefinition['originKind']>, 'native'>,
    workspaceId?: string,
  ): Map<string, AutomationEvaluation> {
    return this.listLatestEvaluationByOrigin(
      originKind,
      workspaceId,
      "AND json_type(e.evaluation_json, '$.nextState') = 'object'",
    );
  }

  private listLatestEvaluationByOrigin(
    originKind: Exclude<NonNullable<AutomationDefinition['originKind']>, 'native'>,
    workspaceId: string | undefined,
    extraPredicate: string,
  ): Map<string, AutomationEvaluation> {
    const rows = this.db.prepare(`
      WITH ranked AS (
        SELECT
          e.id, e.automation_id, e.status, e.activation_kind, e.script_version_id,
          e.started_at, e.finished_at, e.evaluation_json,
          ROW_NUMBER() OVER (PARTITION BY e.automation_id ORDER BY e.started_at DESC, e.id DESC) AS position
        FROM automation_evaluations e
        JOIN automations a ON a.id = e.automation_id
        WHERE e.status = 'finished'
          ${extraPredicate}
          AND a.origin_kind = ?${workspaceId ? ' AND a.workspace_id = ?' : ''}
      )
      SELECT ${EVALUATION_COLUMNS}
      FROM ranked
      WHERE position = 1
    `).all(...(workspaceId ? [originKind, workspaceId] : [originKind])) as LocalAutomationEvaluationRow[];
    const result = new Map<string, AutomationEvaluation>();
    for (const row of rows) {
      const evaluation = rowToEvaluation(row);
      result.set(evaluation.automationId, evaluation);
    }
    return result;
  }

  listLatestRunByOrigin(
    originKind: Exclude<NonNullable<AutomationDefinition['originKind']>, 'native'>,
    workspaceId?: string,
  ): Map<string, AutomationRun> {
    const rows = this.db.prepare(`
      WITH ranked AS (
        SELECT
          r.id, r.automation_id, r.evaluation_id, r.status, r.created_at, r.run_json,
          ROW_NUMBER() OVER (PARTITION BY r.automation_id ORDER BY r.created_at DESC, r.id DESC) AS position
        FROM automation_runs r
        JOIN automations a ON a.id = r.automation_id
        WHERE a.origin_kind = ?${workspaceId ? ' AND a.workspace_id = ?' : ''}
      )
      SELECT ${RUN_COLUMNS}
      FROM ranked
      WHERE position = 1
    `).all(...(workspaceId ? [originKind, workspaceId] : [originKind])) as LocalAutomationRunRow[];
    const result = new Map<string, AutomationRun>();
    for (const row of rows) {
      const run = rowToRun(row);
      result.set(run.automationId, run);
    }
    return result;
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
    return row ? rowToEvaluation(row) : undefined;
  }

  private getRun(id: string): AutomationRun | undefined {
    const row = this.db.prepare(`SELECT ${RUN_COLUMNS} FROM automation_runs WHERE id = ?`)
      .get(id) as LocalAutomationRunRow | undefined;
    return row ? rowToRun(row) : undefined;
  }

  private getRunByEvaluation(evaluationId: string): AutomationRun | undefined {
    const row = this.db.prepare(`SELECT ${RUN_COLUMNS} FROM automation_runs WHERE evaluation_id = ?`)
      .get(evaluationId) as LocalAutomationRunRow | undefined;
    return row ? rowToRun(row) : undefined;
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

  // Single scan replaces a per-automation getNextCheckAt() call inside the startup loop.
  listIdsMissingNextCheckAt(): Set<string> {
    const rows = this.db.prepare('SELECT id FROM automations WHERE next_check_at IS NULL').all() as { id: string }[];
    return new Set(rows.map((row) => row.id));
  }

  listDueAutomationIds(now: Date): Set<string> {
    const rows = this.db.prepare(
      `SELECT id FROM automations
       WHERE enabled = 1 AND health = 'healthy' AND next_check_at IS NOT NULL AND next_check_at <= ?`,
    ).all(now.toISOString()) as { id: string }[];
    return new Set(rows.map((row) => row.id));
  }

  private importScheduledJob(row: LocalScheduledJobRow): number {
    const consumedOnce = row.trigger_type === 'once' && Boolean(row.last_run_at || row.last_status);
    const activation = row.trigger_type === 'once'
      ? { kind: 'once' as const, runAt: row.run_at }
      : { kind: 'cron' as const, expression: row.cron_expr, timezone: 'UTC' };
    const route = scheduledJobRouteFromRow(row);
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
        route,
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

function scheduledJobRouteFromRow(row: LocalScheduledJobRow): { type: string; channelId: string } & Record<string, unknown> {
  const rawRoute = (parseStoredJson(row.route_config, `Scheduled job ${row.id} route`) || {}) as Record<string, unknown>;
  const rawType = typeof rawRoute.type === 'string' ? rawRoute.type : '';
  return {
    ...rawRoute,
    type: rawType || (row.platform === 'local' ? 'local.thread' : 'channel.chat'),
    channelId: String(rawRoute.channelId || row.workspace_id || 'local').trim(),
  };
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

function pickRunMutableFields(input: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const key of [
    'status',
    'createdAt',
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

