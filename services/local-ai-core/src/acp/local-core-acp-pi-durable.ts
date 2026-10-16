import type { DesktopBridgeEvent } from '@cc/superai-contracts';
import type { EventBus } from '@cc/plugin-sdk';
import type { LocalCoreAcpStore } from './local-core-acp-store.js';
import type { SendThreadMessageOptions } from './thread-submission-dispatcher.js';
import type { LocalCoreProjectConfig } from '../router/workspace-router-types.js';
import type { CostService } from '../cost/cost-service.js';
import type { DurableConfig, DurableView } from '../agents/pi-durable/protocol.js';
import { PiDurableHost } from '../agents/pi-durable/host.js';
import { sumDurableUsage, toDurableConfig } from '../agents/pi-durable/config.js';
import { AssistantPartialPersistence } from './assistant-partial-persistence.js';
import { LocalCorePiDurableWriteApprovals } from './local-core-pi-durable-write-approvals.js';

type LocalCoreAcpPiDurableDeps = {
  store: LocalCoreAcpStore;
  eventBus: EventBus;
  emitBridge: (event: DesktopBridgeEvent) => void;
  costService?: CostService;
  endRun: (runId: string, status?: 'completed' | 'failed') => void;
  log?: (message: string) => void;
};

/**
 * Pi Durable runtime seam for the ACP backend: owns the worker host, the
 * per-thread durable configs, write approvals, and partial persistence, and
 * adapts worker views/submissions onto the Core thread, bridge, and cost
 * surfaces.
 */
export class LocalCoreAcpPiDurableRuntime {
  readonly host: PiDurableHost;
  private readonly configs = new Map<string, DurableConfig>();
  private readonly writeApprovals: LocalCorePiDurableWriteApprovals;
  private readonly partials: AssistantPartialPersistence;

  constructor(private readonly deps: LocalCoreAcpPiDurableDeps) {
    this.partials = new AssistantPartialPersistence((error) => deps.log?.(`Pi Durable partial persistence failed: ${String(error)}`));
    this.host = new PiDurableHost({
      userDataPath: deps.store.userDataPath,
      log: deps.log,
      onView: (view) => this.handleView(view),
      onWriteRequest: (request) => this.writeApprovals.request(request),
    });
    this.writeApprovals = new LocalCorePiDurableWriteApprovals({
      store: deps.store, host: this.host, configs: this.configs,
      emit: (event) => deps.emitBridge(event), log: deps.log,
    });
  }

  resolveWriteApproval(input: { threadId: string; approvalId: string; runId?: string; decision: string }) {
    return this.writeApprovals.resolve(input);
  }

  cancelThread(threadId: string): Promise<void> {
    return this.host.cancel(threadId);
  }

  /** Rebind live worker conversations and resume interrupted durable submissions before the dispatcher drains its queue. */
  async prepareForResume(resolveConfig: (threadId: string) => Promise<LocalCoreProjectConfig>): Promise<void> {
    const interruptedDurable = this.deps.store.submissions.listInterruptedDurable();
    const durableActive = interruptedDurable.length > 0
      || this.deps.store.submissions.listPending().some((submission) => submission.runtimeType === 'pi-durable')
      || this.deps.store.submissions.listActive().some((submission) => submission.runtimeType === 'pi-durable');
    if (!durableActive) return;
    await this.prepareBindings(async (threadId) => toDurableConfig(await resolveConfig(threadId)),
      [...new Set(interruptedDurable.map((submission) => submission.threadId))]);
  }

  async close(): Promise<void> {
    this.writeApprovals.close();
    this.partials.close();
    await this.host.close();
  }

  private handleView(view: DurableView) {
    const submission = view.coreSubmissionId ? this.deps.store.submissions.get(view.coreSubmissionId) : undefined;
    if (!submission || submission.threadId !== view.threadId || !['dispatching', 'running', 'pending'].includes(submission.status)) return;
    const thread = this.deps.store.getThreadRow(view.threadId);
    if (!thread) return;
    const messageId = `${submission.runId}-assistant`;
    if (view.partial) {
      this.partials.schedule(view.threadId, () =>
        this.deps.store.threadRuntime.savePartial(view.threadId, submission.runId, messageId, view.partial));
      const event: DesktopBridgeEvent = {
        type: 'update_message', sessionKey: thread.bridge_session_key,
        replyCtx: submission.runId, previewHandle: submission.runId, bridgeKind: 'assistant', content: view.partial,
      };
      this.deps.eventBus.emit({ type: 'run.progress', payload: {
        runId: submission.runId, threadId: view.threadId,
        workspaceId: thread.workspace_id, stream: event,
      } });
      this.deps.emitBridge(event);
    }
  }

  async prepareBindings(resolve: (threadId: string) => Promise<DurableConfig>, cancelThreads: string[] = []) {
    const bindings = await this.host.bindings();
    for (const binding of bindings.filter((item) => item.live)) {
      const config = await resolve(binding.threadId);
      this.configs.set(binding.threadId, config);
      await this.host.configure(binding.threadId, config);
    }
    for (const threadId of cancelThreads) await this.host.cancel(threadId);
    await this.host.resume();
  }

  async runPrompt(threadId: string, runId: string, sessionKey: string,
    config: LocalCoreProjectConfig, prompt: string, options: SendThreadMessageOptions, startedAt: number) {
    const submission = this.deps.store.submissions.byRun(runId);
    if (!submission) throw new Error('Pi Durable Core submission is missing.');
    const currentConfig = toDurableConfig(config, options.runtimeEnv);
    this.configs.set(threadId, currentConfig);
    await this.prepareBindings(async (boundThreadId) => {
      const candidate = boundThreadId === threadId ? currentConfig : this.configs.get(boundThreadId);
      if (!candidate) throw new Error(`Pi Durable recovery is blocked: configuration for live thread ${boundThreadId} is unavailable.`);
      return candidate;
    });
    const result = await this.host.submit({
      threadId,
      coreSubmissionId: submission.id,
      coreRunId: runId,
      prompt,
      config: currentConfig,
    });
    if (result.status !== 'done') throw new Error(result.reason || 'Pi Durable did not complete this request.');
    const row = this.deps.store.getThreadRow(threadId);
    if (!row) throw new Error(`Thread not found: ${threadId}`);
    const answer = result.answer.trim();
    this.partials.discard(threadId);
    this.deps.store.threadRuntime.clearPartial(threadId, runId);
    if (answer) {
      this.deps.store.appendRunFinalMessage(runId, threadId, answer);
      this.deps.eventBus.emit({ type: 'thread.message.accepted', payload: {
        threadId, workspaceId: row.workspace_id, role: 'assistant', content: answer, kind: 'final', source: 'agent',
      } });
      this.deps.emitBridge({ type: 'reply', sessionKey, replyCtx: runId, content: answer });
    }
    const usage = sumDurableUsage(result.usage);
    const usageSourceId = `pi-durable:${submission.id}`;
    if (usage.totalTokens > 0 && !this.deps.store.cost.hasRunSource(runId, usageSourceId)) {
      const eventPayload = {
        workspaceId: row.workspace_id, threadId, runId, agentType: 'pi-durable', modelId: config.model,
        sourceKind: 'manual' as const, sourceId: usageSourceId, tokensIn: usage.inputTokens, tokensOut: usage.outputTokens,
        tokensCache: usage.cacheTokens, tokensTotal: usage.totalTokens,
      };
      if (this.deps.costService) this.deps.costService.recordUsage(eventPayload);
      else this.deps.store.cost.recordCostEvent(eventPayload);
    }
    this.deps.store.updateRun(runId, threadId, 'completed');
    this.deps.endRun(runId, 'completed');
    const task = this.deps.store.getAgentTaskByRunId(runId);
    if (task) this.deps.store.updateAgentTask(task.taskId, { status: 'completed', summary: 'Task completed.' });
    this.deps.eventBus.emit({ type: 'run.completed', payload: {
      runId, threadId, workspaceId: row.workspace_id, stopReason: 'end_turn',
    } });
    this.deps.emitBridge({ type: 'typing_stop', sessionKey, replyCtx: runId });
    this.deps.log?.(`[pi-durable.run:${runId}] completed in ${Date.now() - startedAt}ms`);
  }
}
