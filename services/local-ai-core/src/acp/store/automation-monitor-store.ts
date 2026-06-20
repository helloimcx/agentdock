import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  AutomationMonitor,
  AutomationMonitorCreateInput,
  AutomationMonitorEventSnapshot,
  AutomationMonitorRun,
  AutomationMonitorStatus,
  AutomationMonitorUpdateInput,
} from '@cc/superai-contracts';
import {
  normalizeAutomationMonitorConditionOperator,
  normalizeAutomationMonitorStatus,
  normalizeChannelPlatform,
  normalizeScheduledJobExecutionMode,
} from '@cc/superai-contracts';
import type {
  LocalAutomationMonitorRow,
  LocalAutomationMonitorRunRow,
} from '../../router/workspace-router-types.js';

export type ResolvedAutomationMonitorCreateInput = AutomationMonitorCreateInput & {
  platform: NonNullable<AutomationMonitorCreateInput['platform']>;
  route: NonNullable<AutomationMonitorCreateInput['route']>;
};

export class LocalAutomationMonitorStore {
  constructor(private readonly db: DatabaseSync) {}

  list(workspaceId?: string): AutomationMonitor[] {
    const query = workspaceId
      ? `
        SELECT id, workspace_id, title, source_type, source_config_json, condition_json, prompt_template, platform, route_type, route_config,
               execution_mode, enabled, cooldown_ms, concurrency_policy, last_state_json, created_at, updated_at, last_triggered_at, last_status, last_error
        FROM automation_monitors
        WHERE workspace_id = ?
        ORDER BY updated_at DESC
      `
      : `
        SELECT id, workspace_id, title, source_type, source_config_json, condition_json, prompt_template, platform, route_type, route_config,
               execution_mode, enabled, cooldown_ms, concurrency_policy, last_state_json, created_at, updated_at, last_triggered_at, last_status, last_error
        FROM automation_monitors
        ORDER BY updated_at DESC
      `;
    const rows = this.db.prepare(query).all(...(workspaceId ? [workspaceId] : [])) as LocalAutomationMonitorRow[];
    return rows.map((row) => this.toMonitor(row));
  }

  get(monitorId: string): AutomationMonitor | undefined {
    const row = this.db.prepare(`
      SELECT id, workspace_id, title, source_type, source_config_json, condition_json, prompt_template, platform, route_type, route_config,
             execution_mode, enabled, cooldown_ms, concurrency_policy, last_state_json, created_at, updated_at, last_triggered_at, last_status, last_error
      FROM automation_monitors
      WHERE id = ?
    `).get(monitorId) as LocalAutomationMonitorRow | undefined;
    return row ? this.toMonitor(row) : undefined;
  }

  create(input: ResolvedAutomationMonitorCreateInput): AutomationMonitor {
    const title = String(input.title || '').trim();
    if (!title) throw new Error('Automation monitor title is required.');
    const sourceType = String(input.sourceType || '').trim();
    if (!sourceType) throw new Error('Automation monitor source type is required.');
    const condition = {
      ...input.condition,
      metric: String(input.condition?.metric || '').trim(),
      operator: normalizeAutomationMonitorConditionOperator(input.condition?.operator),
    };
    if (!condition.metric) throw new Error('Automation monitor condition metric is required.');

    const id = this.createMonitorId();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO automation_monitors (
        id, workspace_id, title, source_type, source_config_json, condition_json, prompt_template, platform, route_type, route_config,
        execution_mode, enabled, cooldown_ms, concurrency_policy, last_state_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'skip_if_running', ?, ?, ?)
    `).run(
      id,
      input.workspaceId,
      title,
      sourceType,
      JSON.stringify(input.sourceConfig || {}),
      JSON.stringify(condition),
      input.promptTemplate,
      normalizeChannelPlatform(input.platform),
      input.route.type,
      JSON.stringify(input.route),
      normalizeScheduledJobExecutionMode(input.executionMode, 'side-thread'),
      input.enabled === false ? 0 : 1,
      Math.max(0, Number(input.cooldownMs ?? 15 * 60 * 1000)),
      null,
      now,
      now,
    );
    return this.get(id)!;
  }

  update(monitorId: string, input: AutomationMonitorUpdateInput): AutomationMonitor {
    const existing = this.get(monitorId);
    if (!existing) throw new Error(`Automation monitor not found: ${monitorId}`);
    const nextCondition = input.condition
      ? {
          ...input.condition,
          metric: String(input.condition.metric || '').trim(),
          operator: normalizeAutomationMonitorConditionOperator(input.condition.operator),
        }
      : existing.condition;
    const next = {
      ...existing,
      ...(typeof input.title === 'string' ? { title: input.title.trim() } : {}),
      ...(input.sourceConfig ? { sourceConfig: input.sourceConfig } : {}),
      condition: nextCondition,
      ...(typeof input.promptTemplate === 'string' ? { promptTemplate: input.promptTemplate } : {}),
      ...(input.route ? { route: input.route } : {}),
      ...(input.executionMode ? { executionMode: normalizeScheduledJobExecutionMode(input.executionMode, 'side-thread') } : {}),
      ...(typeof input.enabled === 'boolean' ? { enabled: input.enabled } : {}),
      ...(typeof input.cooldownMs === 'number' ? { cooldownMs: Math.max(0, input.cooldownMs) } : {}),
      updatedAt: new Date().toISOString(),
    };
    if (!next.title) throw new Error('Automation monitor title is required.');

    this.db.prepare(`
      UPDATE automation_monitors
      SET title = ?, source_config_json = ?, condition_json = ?, prompt_template = ?, route_type = ?, route_config = ?,
          execution_mode = ?, enabled = ?, cooldown_ms = ?, updated_at = ?
      WHERE id = ?
    `).run(
      next.title,
      JSON.stringify(next.sourceConfig || {}),
      JSON.stringify(next.condition),
      next.promptTemplate,
      next.route.type,
      JSON.stringify(next.route),
      next.executionMode,
      next.enabled ? 1 : 0,
      next.cooldownMs,
      next.updatedAt,
      monitorId,
    );
    return this.get(monitorId)!;
  }

  updateState(monitorId: string, input: {
    lastState?: Record<string, unknown>;
    lastTriggeredAt?: string;
    lastStatus?: AutomationMonitorStatus;
    lastError?: string;
    enabled?: boolean;
  }) {
    this.db.prepare(`
      UPDATE automation_monitors
      SET last_state_json = CASE WHEN ? IS NULL THEN last_state_json ELSE ? END,
          last_triggered_at = COALESCE(?, last_triggered_at),
          last_status = COALESCE(?, last_status),
          last_error = CASE WHEN ? IS NULL THEN last_error ELSE ? END,
          enabled = CASE WHEN ? IS NULL THEN enabled ELSE ? END,
          updated_at = ?
      WHERE id = ?
    `).run(
      input.lastState == null ? null : JSON.stringify(input.lastState),
      input.lastState == null ? null : JSON.stringify(input.lastState),
      input.lastTriggeredAt || null,
      input.lastStatus || null,
      input.lastError == null ? null : input.lastError,
      input.lastError == null ? null : input.lastError,
      typeof input.enabled === 'boolean' ? (input.enabled ? 1 : 0) : null,
      typeof input.enabled === 'boolean' ? (input.enabled ? 1 : 0) : null,
      new Date().toISOString(),
      monitorId,
    );
  }

  delete(monitorId: string) {
    const result = this.db.prepare('DELETE FROM automation_monitors WHERE id = ?').run(monitorId);
    if (result.changes === 0) throw new Error(`Automation monitor not found: ${monitorId}`);
    return { deleted: true };
  }

  listRuns(monitorId: string): AutomationMonitorRun[] {
    const rows = this.db.prepare(`
      SELECT id, monitor_id, status, triggered_at, started_at, finished_at, error, event_snapshot_json, thread_id, run_id, delivery_mode, delivery_status, delivery_error, last_bridge_event_at
      FROM automation_monitor_runs
      WHERE monitor_id = ?
      ORDER BY triggered_at DESC
    `).all(monitorId) as LocalAutomationMonitorRunRow[];
    return rows.map((row) => this.toRun(row));
  }

  createRun(monitorId: string, status: AutomationMonitorStatus, input: Partial<AutomationMonitorRun> = {}): AutomationMonitorRun {
    const id = `monitorrun:${randomUUID()}`;
    const triggeredAt = input.triggeredAt || new Date().toISOString();
    const normalizedStatus = normalizeAutomationMonitorStatus(status);
    this.db.prepare(`
      INSERT INTO automation_monitor_runs (id, monitor_id, status, triggered_at, started_at, finished_at, error, event_snapshot_json, thread_id, run_id, delivery_mode, delivery_status, delivery_error, last_bridge_event_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      monitorId,
      normalizedStatus,
      triggeredAt,
      input.startedAt || null,
      input.finishedAt || null,
      input.error || null,
      input.eventSnapshot ? JSON.stringify(input.eventSnapshot) : null,
      input.threadId || null,
      input.runId || null,
      input.deliveryMode || null,
      input.deliveryStatus || null,
      input.deliveryError || null,
      input.lastBridgeEventAt || null,
    );
    this.updateState(monitorId, {
      lastTriggeredAt: triggeredAt,
      lastStatus: normalizedStatus,
      lastError: input.error || '',
    });
    return this.getRun(id)!;
  }

  getRun(runId: string): AutomationMonitorRun | undefined {
    const row = this.db.prepare(`
      SELECT id, monitor_id, status, triggered_at, started_at, finished_at, error, event_snapshot_json, thread_id, run_id, delivery_mode, delivery_status, delivery_error, last_bridge_event_at
      FROM automation_monitor_runs
      WHERE id = ?
    `).get(runId) as LocalAutomationMonitorRunRow | undefined;
    return row ? this.toRun(row) : undefined;
  }

  updateRun(runId: string, input: Partial<AutomationMonitorRun>): AutomationMonitorRun {
    const existing = this.getRun(runId);
    if (!existing) throw new Error(`Automation monitor run not found: ${runId}`);
    const next = {
      ...existing,
      ...input,
      ...(input.status ? { status: normalizeAutomationMonitorStatus(input.status) } : {}),
    };
    this.db.prepare(`
      UPDATE automation_monitor_runs
      SET status = ?, triggered_at = ?, started_at = ?, finished_at = ?, error = ?, event_snapshot_json = ?, thread_id = ?, run_id = ?, delivery_mode = ?, delivery_status = ?, delivery_error = ?, last_bridge_event_at = ?
      WHERE id = ?
    `).run(
      next.status,
      next.triggeredAt,
      next.startedAt || null,
      next.finishedAt || null,
      next.error || null,
      next.eventSnapshot ? JSON.stringify(next.eventSnapshot) : null,
      next.threadId || null,
      next.runId || null,
      next.deliveryMode || null,
      next.deliveryStatus || null,
      next.deliveryError || null,
      next.lastBridgeEventAt || null,
      runId,
    );
    if (input.status || Object.prototype.hasOwnProperty.call(input, 'error') || input.finishedAt || input.triggeredAt) {
      this.updateState(existing.monitorId, {
        lastTriggeredAt: next.triggeredAt,
        lastStatus: next.status,
        lastError: next.error || '',
      });
    }
    return this.getRun(runId)!;
  }

  private toMonitor(row: LocalAutomationMonitorRow): AutomationMonitor {
    const condition = parseJson(row.condition_json, {}) as AutomationMonitor['condition'];
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      title: row.title,
      sourceType: row.source_type,
      sourceConfig: parseJson(row.source_config_json || '{}', {}),
      condition: {
        ...condition,
        operator: normalizeAutomationMonitorConditionOperator(condition.operator),
      },
      promptTemplate: row.prompt_template,
      platform: normalizeChannelPlatform(row.platform),
      route: JSON.parse(row.route_config) as AutomationMonitor['route'],
      executionMode: normalizeScheduledJobExecutionMode(row.execution_mode, 'side-thread'),
      enabled: Boolean(row.enabled),
      cooldownMs: Number(row.cooldown_ms || 0),
      concurrencyPolicy: row.concurrency_policy,
      lastState: row.last_state_json ? parseJson(row.last_state_json, {}) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastTriggeredAt: row.last_triggered_at || undefined,
      lastStatus: row.last_status ? normalizeAutomationMonitorStatus(row.last_status) : undefined,
      lastError: row.last_error || undefined,
    };
  }

  private toRun(row: LocalAutomationMonitorRunRow): AutomationMonitorRun {
    return {
      id: row.id,
      monitorId: row.monitor_id,
      status: normalizeAutomationMonitorStatus(row.status),
      triggeredAt: row.triggered_at,
      startedAt: row.started_at || undefined,
      finishedAt: row.finished_at || undefined,
      error: row.error || undefined,
      eventSnapshot: row.event_snapshot_json ? parseJson(row.event_snapshot_json, {} as AutomationMonitorEventSnapshot) : undefined,
      threadId: row.thread_id || undefined,
      runId: row.run_id || undefined,
      deliveryMode: row.delivery_mode || undefined,
      deliveryStatus: row.delivery_status || undefined,
      deliveryError: row.delivery_error || undefined,
      lastBridgeEventAt: row.last_bridge_event_at || undefined,
    };
  }

  private createMonitorId() {
    let id = `monitor:${randomUUID()}`;
    for (let attempt = 0; attempt < 5 && this.get(id); attempt += 1) {
      id = `monitor:${randomUUID()}`;
    }
    if (this.get(id)) throw new Error('Unable to allocate a unique automation monitor id.');
    return id;
  }
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

