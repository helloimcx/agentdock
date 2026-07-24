import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  ScheduledJob,
  ScheduledJobCreateInput,
  ScheduledJobRun,
  ScheduledJobUpdateInput,
} from '@cc/superai-contracts';
import {
  normalizeChannelPlatform,
  normalizeScheduledJobExecutionMode,
  normalizeScheduledJobRunStatus,
  normalizeScheduledJobTriggerType,
} from '@cc/superai-contracts';
import { createScheduledJobId } from '../../scheduler/job-id.js';
import type {
  LocalScheduledJobRow,
  LocalScheduledJobRunRow,
} from '../../router/workspace-router-types.js';
import { parseJson } from './utils.js';

export class LocalSchedulerStore {
  constructor(private readonly db: DatabaseSync) {}

  listJobs(workspaceId?: string): ScheduledJob[] {
    const query = workspaceId
      ? `
        SELECT id, workspace_id, platform, route_type, route_config, trigger_type, cron_expr, run_at, prompt_template, description,
               enabled, concurrency_policy, created_at, updated_at, last_run_at, last_status, last_error, execution_mode
        FROM scheduled_jobs
        WHERE workspace_id = ?
        ORDER BY updated_at DESC
      `
      : `
        SELECT id, workspace_id, platform, route_type, route_config, trigger_type, cron_expr, run_at, prompt_template, description,
               enabled, concurrency_policy, created_at, updated_at, last_run_at, last_status, last_error, execution_mode
        FROM scheduled_jobs
        ORDER BY updated_at DESC
      `;
    const rows = this.db.prepare(query).all(...(workspaceId ? [workspaceId] : [])) as LocalScheduledJobRow[];
    return rows.map((row) => this.toScheduledJob(row));
  }

  getJob(jobId: string): ScheduledJob | undefined {
    const row = this.db.prepare(`
      SELECT id, workspace_id, platform, route_type, route_config, trigger_type, cron_expr, run_at, prompt_template, description,
             enabled, concurrency_policy, created_at, updated_at, last_run_at, last_status, last_error, execution_mode
      FROM scheduled_jobs
      WHERE id = ?
    `).get(jobId) as LocalScheduledJobRow | undefined;
    return row ? this.toScheduledJob(row) : undefined;
  }

  createJob(input: ScheduledJobCreateInput): ScheduledJob {
    if (!input.platform || !input.route) {
      throw new Error('Scheduled job creation requires a resolved platform and route.');
    }
    let id = createScheduledJobId();
    for (let attempt = 0; attempt < 5 && this.getJob(id); attempt += 1) {
      id = createScheduledJobId();
    }
    if (this.getJob(id)) {
      throw new Error('Unable to allocate a unique scheduled job id.');
    }
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO scheduled_jobs (
        id, workspace_id, platform, route_type, route_config, execution_mode, trigger_type, cron_expr, run_at,
        prompt_template, description, enabled, concurrency_policy, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'skip_if_running', ?, ?)
    `).run(
      id,
      input.workspaceId,
      normalizeChannelPlatform(input.platform),
      input.route.type,
      JSON.stringify(input.route),
      normalizeScheduledJobExecutionMode(input.executionMode),
      normalizeScheduledJobTriggerType(input.triggerType),
      input.cronExpr || null,
      input.runAt || null,
      input.promptTemplate,
      input.description || '',
      input.enabled === false ? 0 : 1,
      now,
      now,
    );
    return this.getJob(id)!;
  }

  updateJob(jobId: string, input: ScheduledJobUpdateInput): ScheduledJob {
    const existing = this.getJob(jobId);
    if (!existing) {
      throw new Error(`Scheduled job not found: ${jobId}`);
    }
    const next = {
      ...existing,
      ...(input.route ? { route: input.route } : {}),
      ...(input.executionMode ? { executionMode: normalizeScheduledJobExecutionMode(input.executionMode) } : {}),
      ...(input.triggerType ? { triggerType: normalizeScheduledJobTriggerType(input.triggerType) } : {}),
      ...(Object.prototype.hasOwnProperty.call(input, 'cronExpr') ? { cronExpr: input.cronExpr || undefined } : {}),
      ...(Object.prototype.hasOwnProperty.call(input, 'runAt') ? { runAt: input.runAt || undefined } : {}),
      ...(typeof input.promptTemplate === 'string' ? { promptTemplate: input.promptTemplate } : {}),
      ...(typeof input.description === 'string' ? { description: input.description } : {}),
      ...(typeof input.enabled === 'boolean' ? { enabled: input.enabled } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.db.prepare(`
      UPDATE scheduled_jobs
      SET route_type = ?, route_config = ?, execution_mode = ?, trigger_type = ?, cron_expr = ?, run_at = ?, prompt_template = ?,
          description = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `).run(
      next.route.type,
      JSON.stringify(next.route),
      next.executionMode,
      next.triggerType,
      next.cronExpr || null,
      next.runAt || null,
      next.promptTemplate,
      next.description,
      next.enabled ? 1 : 0,
      next.updatedAt,
      jobId,
    );
    return this.getJob(jobId)!;
  }

  deleteJob(jobId: string) {
    const result = this.db.prepare('DELETE FROM scheduled_jobs WHERE id = ?').run(jobId);
    if (result.changes === 0) {
      throw new Error(`Scheduled job not found: ${jobId}`);
    }
    return { deleted: true };
  }

  listRuns(jobId: string): ScheduledJobRun[] {
    const rows = this.db.prepare(`
      SELECT id, job_id, status, triggered_at, started_at, finished_at, error, thread_id, run_id, platform_message_id, platform_message_ids_json, delivery_mode, delivery_status, delivery_error, last_bridge_event_at
      FROM scheduled_job_runs
      WHERE job_id = ?
      ORDER BY triggered_at DESC
    `).all(jobId) as LocalScheduledJobRunRow[];
    return rows.map((row) => this.toScheduledJobRun(row));
  }

  createRun(jobId: string, status: ScheduledJobRun['status'], input: Partial<ScheduledJobRun> = {}): ScheduledJobRun {
    const id = `jobrun:${randomUUID()}`;
    const triggeredAt = input.triggeredAt || new Date().toISOString();
    const normalizedStatus = normalizeScheduledJobRunStatus(status);
    this.db.prepare(`
      INSERT INTO scheduled_job_runs (id, job_id, status, triggered_at, started_at, finished_at, error, thread_id, run_id, platform_message_id, platform_message_ids_json, delivery_mode, delivery_status, delivery_error, last_bridge_event_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      jobId,
      normalizedStatus,
      triggeredAt,
      input.startedAt || null,
      input.finishedAt || null,
      input.error || null,
      input.threadId || null,
      input.runId || null,
      input.platformMessageId || null,
      JSON.stringify(input.platformMessageIds || []),
      input.deliveryMode || null,
      input.deliveryStatus || null,
      input.deliveryError || null,
      input.lastBridgeEventAt || null,
    );
    this.updateJobStatus(jobId, {
      lastRunAt: triggeredAt,
      lastStatus: normalizedStatus,
      lastError: input.error || '',
    });
    return {
      id,
      jobId,
      status: normalizedStatus,
      triggeredAt,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      error: input.error,
      threadId: input.threadId,
      runId: input.runId,
      platformMessageId: input.platformMessageId,
      platformMessageIds: input.platformMessageIds || [],
      deliveryMode: input.deliveryMode,
      deliveryStatus: input.deliveryStatus,
      deliveryError: input.deliveryError,
      lastBridgeEventAt: input.lastBridgeEventAt,
    };
  }

  getRun(runId: string): ScheduledJobRun | undefined {
    const row = this.db.prepare(`
      SELECT id, job_id, status, triggered_at, started_at, finished_at, error, thread_id, run_id, platform_message_id, platform_message_ids_json, delivery_mode, delivery_status, delivery_error, last_bridge_event_at
      FROM scheduled_job_runs
      WHERE id = ?
    `).get(runId) as LocalScheduledJobRunRow | undefined;
    return row ? this.toScheduledJobRun(row) : undefined;
  }

  updateRun(runId: string, input: Partial<ScheduledJobRun>) {
    const existing = this.getRun(runId);
    if (!existing) {
      throw new Error(`Scheduled job run not found: ${runId}`);
    }
    const next = {
      ...existing,
      ...input,
      ...(input.status ? { status: normalizeScheduledJobRunStatus(input.status) } : {}),
    };
    this.db.prepare(`
      UPDATE scheduled_job_runs
      SET status = ?, triggered_at = ?, started_at = ?, finished_at = ?, error = ?, thread_id = ?, run_id = ?, platform_message_id = ?, platform_message_ids_json = ?, delivery_mode = ?, delivery_status = ?, delivery_error = ?, last_bridge_event_at = ?
      WHERE id = ?
    `).run(
      next.status,
      next.triggeredAt,
      next.startedAt || null,
      next.finishedAt || null,
      next.error || null,
      next.threadId || null,
      next.runId || null,
      next.platformMessageId || null,
      JSON.stringify(next.platformMessageIds || []),
      next.deliveryMode || null,
      next.deliveryStatus || null,
      next.deliveryError || null,
      next.lastBridgeEventAt || null,
      runId,
    );
    if (input.status || Object.prototype.hasOwnProperty.call(input, 'error') || input.finishedAt || input.triggeredAt) {
      this.updateJobStatus(existing.jobId, {
        lastRunAt: next.triggeredAt,
        lastStatus: next.status,
        lastError: next.error || '',
      });
    }
    return next;
  }

  updateJobStatus(jobId: string, input: {
    lastRunAt?: string;
    lastStatus?: ScheduledJobRun['status'];
    lastError?: string;
    enabled?: boolean;
  }) {
    this.db.prepare(`
      UPDATE scheduled_jobs
      SET last_run_at = COALESCE(?, last_run_at),
          last_status = COALESCE(?, last_status),
          last_error = CASE WHEN ? IS NULL THEN last_error ELSE ? END,
          enabled = CASE WHEN ? IS NULL THEN enabled ELSE ? END,
          updated_at = ?
      WHERE id = ?
    `).run(
      input.lastRunAt || null,
      input.lastStatus || null,
      input.lastError == null ? null : input.lastError,
      input.lastError == null ? null : input.lastError,
      typeof input.enabled === 'boolean' ? (input.enabled ? 1 : 0) : null,
      typeof input.enabled === 'boolean' ? (input.enabled ? 1 : 0) : null,
      new Date().toISOString(),
      jobId,
    );
  }

  private toScheduledJob(row: LocalScheduledJobRow): ScheduledJob {
    const route = JSON.parse(row.route_config) as ScheduledJob['route'];
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      platform: normalizeChannelPlatform(row.platform),
      route,
      executionMode: normalizeScheduledJobExecutionMode(row.execution_mode),
      triggerType: normalizeScheduledJobTriggerType(row.trigger_type),
      cronExpr: row.cron_expr || undefined,
      runAt: row.run_at || undefined,
      promptTemplate: row.prompt_template,
      description: row.description,
      enabled: Boolean(row.enabled),
      concurrencyPolicy: row.concurrency_policy,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastRunAt: row.last_run_at || undefined,
      lastStatus: row.last_status ? normalizeScheduledJobRunStatus(row.last_status) : undefined,
      lastError: row.last_error || undefined,
    };
  }

  private toScheduledJobRun(row: LocalScheduledJobRunRow): ScheduledJobRun {
    return {
      id: row.id,
      jobId: row.job_id,
      status: normalizeScheduledJobRunStatus(row.status),
      triggeredAt: row.triggered_at,
      startedAt: row.started_at || undefined,
      finishedAt: row.finished_at || undefined,
      error: row.error || undefined,
      threadId: row.thread_id || undefined,
      runId: row.run_id || undefined,
      platformMessageId: row.platform_message_id || undefined,
      platformMessageIds: parseJson(row.platform_message_ids_json || '[]', []),
      deliveryMode: row.delivery_mode || undefined,
      deliveryStatus: row.delivery_status || undefined,
      deliveryError: row.delivery_error || undefined,
      lastBridgeEventAt: row.last_bridge_event_at || undefined,
    };
  }
}
