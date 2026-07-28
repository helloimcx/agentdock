import type { PluginContext, PluginManifest, RuntimePlugin } from './runtime-types.js';

export interface SchedulerCapability {
  id: string;
  triggerTypes: string[];
  deliveryTargets: string[];
  deliveryPlatforms?: string[];
  enabled?: boolean;
  displayName?: string;
}

export interface SchedulerExecutionContext {
  job: import('@cc/superai-contracts').ScheduledJob;
  triggeredAt: string;
}

export interface SchedulerExecutionResult {
  threadId?: string;
  runId?: string;
  replyText?: string;
  platformMessageId?: string;
  platformMessageIds?: string[];
  deliveryMode?: import('@cc/superai-contracts').ScheduledJobRun['deliveryMode'];
  deliveryStatus?: import('@cc/superai-contracts').ScheduledJobRun['deliveryStatus'];
  deliveryError?: string;
  lastBridgeEventAt?: string;
}

export interface SchedulerExecutionTarget {
  kind: string;
  threadId: string;
  workspaceId: string;
  platform: string;
  route: import('@cc/superai-contracts').ScheduledJobRoute;
  metadata?: Record<string, unknown>;
}

export interface SchedulerTriggerRuntime {
  readonly triggerTypes: string[];
  supports(job: import('@cc/superai-contracts').ScheduledJob): boolean;
  isDue(job: import('@cc/superai-contracts').ScheduledJob, now: Date): boolean;
}

export interface SchedulerExecutorRuntime {
  readonly deliveryTargets: string[];
  supports(job: import('@cc/superai-contracts').ScheduledJob): boolean;
  execute(context: SchedulerExecutionContext): Promise<SchedulerExecutionResult>;
}

export interface SchedulerRuntimeRegistration {
  triggers?: SchedulerTriggerRuntime[];
  executors?: SchedulerExecutorRuntime[];
}

export interface SchedulerPlugin extends RuntimePlugin {
  manifest: PluginManifest & { kind: 'scheduler' | 'composite' };
  createRuntime?(ctx: PluginContext): Promise<SchedulerRuntimeRegistration> | SchedulerRuntimeRegistration;
}
