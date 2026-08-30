import {
  normalizeContractEnumValue,
  resolveContractEnum,
  ScheduledJobExecutionMode,
  ScheduledJobRoute,
} from './scheduler.js';
import type { AutomationMonitorSchedule } from './automations.js';

export type ScheduledJobTriggerType = 'cron' | 'once' | (string & {});

export function normalizeScheduledJobTriggerType(value: unknown, fallback: ScheduledJobTriggerType = 'cron'): ScheduledJobTriggerType {
  const normalized = normalizeContractEnumValue(value || fallback);
  if (normalized === 'cron' || normalized === 'once' || normalized === 'one-time') {
    return normalized === 'one-time' ? 'once' : normalized;
  }
  throw new Error('Scheduled job trigger type must be cron or once.');
}

export interface ScheduledJobExecutionTarget {
  kind: string;
  threadId: string;
  workspaceId: string;
  platform: string;
  route: ScheduledJobRoute;
  metadata?: Record<string, unknown>;
}

export interface ScheduledJob {
  id: string;
  workspaceId: string;
  platform: 'local' | 'lark' | (string & {});
  route: ScheduledJobRoute;
  executionMode: ScheduledJobExecutionMode;
  triggerType: ScheduledJobTriggerType;
  cronExpr?: string;
  runAt?: string;
  promptTemplate: string;
  description: string;
  enabled: boolean;
  concurrencyPolicy: 'skip_if_running';
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastStatus?: ScheduledJobRun['status'];
  lastError?: string;
}

export interface ScheduledJobRun {
  id: string;
  jobId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';
  triggeredAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  threadId?: string;
  runId?: string;
  platformMessageId?: string;
  platformMessageIds?: string[];
  deliveryMode?: 'thread-only' | 'bridge-stream' | 'final-message' | (string & {});
  deliveryStatus?: 'pending' | 'streaming' | 'succeeded' | 'failed' | 'skipped' | (string & {});
  deliveryError?: string;
  lastBridgeEventAt?: string;
}

export function normalizeScheduledJobRunStatus(value: unknown, fallback: ScheduledJobRun['status'] = 'queued'): ScheduledJobRun['status'] {
  return resolveContractEnum({
    value,
    fallback,
    valid: ['queued', 'running', 'succeeded', 'failed', 'skipped'],
    aliases: {
      complete: 'succeeded',
      completed: 'succeeded',
      success: 'succeeded',
      cancelled: 'skipped',
      canceled: 'skipped',
    },
    errorMessage: 'Scheduled job run status must be queued, running, succeeded, failed, or skipped.',
  });
}

export interface ScheduledJobCreateInput {
  workspaceId: string;
  platform?: 'local' | 'lark' | (string & {});
  route?: ScheduledJobRoute;
  channelId?: string;
  threadId?: string;
  executionMode?: ScheduledJobExecutionMode;
  triggerType: ScheduledJobTriggerType;
  cronExpr?: string;
  runAt?: string;
  promptTemplate: string;
  description?: string;
  enabled?: boolean;
}

export interface ScheduledJobUpdateInput {
  platform?: 'local' | 'lark' | (string & {});
  route?: ScheduledJobRoute;
  channelId?: string;
  executionMode?: ScheduledJobExecutionMode;
  triggerType?: ScheduledJobTriggerType;
  cronExpr?: string;
  runAt?: string;
  promptTemplate?: string;
  description?: string;
  enabled?: boolean;
}

export type AutomationMonitorStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';

export type AutomationMonitorConditionOperator = '>' | '>=' | '<' | '<=' | '==' | '!=';

export interface AutomationMonitorCondition {
  metric: string;
  operator: AutomationMonitorConditionOperator;
  value: number | string | boolean;
  expression?: string;
}

export interface AutomationMonitorEventSnapshot {
  id: string;
  sourceType: string;
  occurredAt: string;
  subject: string;
  summary?: string;
  payload: Record<string, unknown>;
}

export interface AutomationMonitor {
  id: string;
  workspaceId: string;
  title: string;
  sourceType: string;
  sourceConfig: Record<string, unknown>;
  condition: AutomationMonitorCondition;
  promptTemplate: string;
  platform: 'local' | 'lark' | (string & {});
  route: ScheduledJobRoute;
  executionMode: ScheduledJobExecutionMode;
  enabled: boolean;
  cooldownMs: number;
  concurrencyPolicy: 'skip_if_running';
  schedule?: AutomationMonitorSchedule;
  lastState?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastTriggeredAt?: string;
  lastStatus?: AutomationMonitorStatus;
  lastError?: string;
}

export interface AutomationMonitorRun {
  id: string;
  monitorId: string;
  status: AutomationMonitorStatus;
  triggeredAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  eventSnapshot?: AutomationMonitorEventSnapshot;
  threadId?: string;
  runId?: string;
  deliveryMode?: ScheduledJobRun['deliveryMode'];
  deliveryStatus?: ScheduledJobRun['deliveryStatus'];
  deliveryError?: string;
  lastBridgeEventAt?: string;
}

export interface AutomationMonitorCreateInput {
  workspaceId: string;
  title: string;
  sourceType: string;
  sourceConfig?: Record<string, unknown>;
  condition: AutomationMonitorCondition;
  promptTemplate: string;
  platform?: 'local' | 'lark' | (string & {});
  route?: ScheduledJobRoute;
  threadId?: string;
  executionMode?: ScheduledJobExecutionMode;
  enabled?: boolean;
  cooldownMs?: number;
  schedule?: AutomationMonitorSchedule;
}

export interface AutomationMonitorUpdateInput {
  title?: string;
  sourceConfig?: Record<string, unknown>;
  condition?: AutomationMonitorCondition;
  promptTemplate?: string;
  route?: ScheduledJobRoute;
  executionMode?: ScheduledJobExecutionMode;
  enabled?: boolean;
  cooldownMs?: number;
  schedule?: AutomationMonitorSchedule | null;
}

export function normalizeAutomationMonitorStatus(value: unknown, fallback: AutomationMonitorStatus = 'queued'): AutomationMonitorStatus {
  return resolveContractEnum({
    value,
    fallback,
    valid: ['queued', 'running', 'succeeded', 'failed', 'skipped'],
    aliases: { complete: 'succeeded', completed: 'succeeded', success: 'succeeded' },
    errorMessage: 'Automation monitor status must be queued, running, succeeded, failed, or skipped.',
  });
}

export function normalizeAutomationMonitorConditionOperator(value: unknown): AutomationMonitorConditionOperator {
  const normalized = String(value || '').trim();
  if (
    normalized === '>' ||
    normalized === '>=' ||
    normalized === '<' ||
    normalized === '<=' ||
    normalized === '==' ||
    normalized === '!='
  ) {
    return normalized;
  }
  throw new Error('Automation monitor condition operator must be >, >=, <, <=, ==, or !=.');
}
