import type { ScheduledJob } from '../../../../packages/contracts/src/index.js';
import type { ChannelRuntime } from '../../../../packages/plugin-sdk/src/index.js';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { WorkspaceRouter } from '../router/workspace-router.js';
import type { ScheduledExecutionTarget } from './adapters.js';
import type { ScheduledExecutionPolicy } from './execution-policy.js';
import { ScheduledBridgeSession, type ScheduledBridgeSessionHandle } from './scheduled-bridge-session.js';

export type ChannelExecutionPolicyOptions = {
  store: LocalCoreAcpStore;
  workspaceRouter: WorkspaceRouter;
  getChannelRuntime: () => ChannelRuntime;
};

type ChannelExecutionPolicyConfig = {
  platformBase: string;
  resolveSameThread: (job: ScheduledJob) => Promise<string>;
  sideThreadTitle: (job: ScheduledJob) => string;
  legacySideThreadTitles?: (job: ScheduledJob) => string[];
  preferredAgentType?: (job: ScheduledJob) => string;
};

export function createChannelExecutionPolicy(
  job: ScheduledJob,
  options: ChannelExecutionPolicyOptions,
  config: ChannelExecutionPolicyConfig,
): ScheduledExecutionPolicy {
  if (job.executionMode === 'side-thread') {
    return new SideThreadChannelExecutionPolicy(options, config);
  }
  return new SameThreadChannelExecutionPolicy(options, config);
}

class SameThreadChannelExecutionPolicy implements ScheduledExecutionPolicy {
  private bridgeSession?: ScheduledBridgeSessionHandle;

  constructor(
    private readonly options: ChannelExecutionPolicyOptions,
    private readonly config: ChannelExecutionPolicyConfig,
  ) {}

  async resolveTarget(job: ScheduledJob): Promise<ScheduledExecutionTarget> {
    const threadId = await this.config.resolveSameThread(job);
    return {
      kind: `${this.config.platformBase}:same-thread`,
      threadId,
      workspaceId: job.workspaceId,
      platform: job.platform,
      route: job.route,
    };
  }

  async beforeExecute(target: ScheduledExecutionTarget, job: ScheduledJob) {
    this.bridgeSession = await ScheduledBridgeSession.open({
      job,
      threadId: target.threadId,
      workspaceRouter: this.options.workspaceRouter,
      getChannelRuntime: this.options.getChannelRuntime,
    });
  }

  async afterExecute() {
    await this.bridgeSession?.close();
    this.bridgeSession = undefined;
  }
}

class SideThreadChannelExecutionPolicy implements ScheduledExecutionPolicy {
  private bridgeSession?: ScheduledBridgeSessionHandle;

  constructor(
    private readonly options: ChannelExecutionPolicyOptions,
    private readonly config: ChannelExecutionPolicyConfig,
  ) {}

  async resolveTarget(job: ScheduledJob): Promise<ScheduledExecutionTarget> {
    const title = this.config.sideThreadTitle(job);
    const reusableTitles = new Set([
      title,
      ...(this.config.legacySideThreadTitles?.(job) || []),
    ]);
    const targetAgent = await this.resolveTargetAgent(job);
    const existing = (await this.options.workspaceRouter.listThreads(job.workspaceId))
      .find((thread) => reusableTitles.has(thread.title) && this.threadMatchesTargetAgent(thread, targetAgent));
    const threadId = existing?.id
      || (await this.options.workspaceRouter.createThread(job.workspaceId, title, targetAgent || undefined)).id;
    return {
      kind: `${this.config.platformBase}:side-thread`,
      threadId,
      workspaceId: job.workspaceId,
      platform: job.platform,
      route: job.route,
    };
  }

  async beforeExecute(target: ScheduledExecutionTarget, job: ScheduledJob) {
    this.bridgeSession = await ScheduledBridgeSession.open({
      job,
      threadId: target.threadId,
      workspaceRouter: this.options.workspaceRouter,
      getChannelRuntime: this.options.getChannelRuntime,
    });
  }

  async afterExecute() {
    await this.bridgeSession?.close();
    this.bridgeSession = undefined;
  }

  private async resolveTargetAgent(job: ScheduledJob) {
    const preferredAgent = normalizeAgentType(this.config.preferredAgentType?.(job));
    if (preferredAgent) {
      return preferredAgent;
    }
    return normalizeAgentType(await this.options.workspaceRouter.getWorkspaceDefaultAgentType(job.workspaceId));
  }

  private threadMatchesTargetAgent(thread: { agentType?: string | null }, targetAgent: string) {
    return normalizeAgentType(thread.agentType) === targetAgent;
  }
}

function normalizeAgentType(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}
