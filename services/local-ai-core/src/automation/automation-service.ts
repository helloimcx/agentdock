import type {
  AutomationCreateInput,
  AutomationDefinition,
  AutomationEvaluation,
  AutomationEvaluationFinishInput,
  AutomationRun,
  AutomationUpdateInput,
} from '@cc/superai-contracts';
import type { EventBus } from '@cc/plugin-sdk';
import { redactSecrets, type LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import {
  decideCondition,
  evaluateCondition,
} from './automation-condition-engine.js';
import { missedActivationAt, nextActivationAt } from './automation-trigger-engine.js';
import type {
  AutomationActionExecutionResult,
  AutomationActionExecutor,
} from './automation-action-executor.js';

const DUE_LOOP_INTERVAL_MS = 30_000;
const DEFAULT_MAX_CONCURRENCY = 4;
export const AUTOMATION_ERROR_MAX_LENGTH = 2_000;
const FAILURE_ALERT_COUNTS = new Set([1, 3, 7, 15, 31]);
const RESTART_INTERRUPTION_REASON = 'Automation action interrupted by Local AI Core restart.';

export interface AutomationOwnershipPolicy {
  executes(automation: AutomationDefinition): boolean;
}

export const NATIVE_AUTOMATION_OWNERSHIP: AutomationOwnershipPolicy = {
  executes: (automation) => (automation.originKind || 'native') === 'native',
};

type TimerHandle = unknown;
type ActionExecutor = Pick<AutomationActionExecutor, 'execute'>;

export interface AutomationServiceOptions {
  store: LocalCoreAcpStore;
  eventBus: EventBus;
  actionExecutor: ActionExecutor;
  clock?: () => Date;
  setInterval?: (handler: () => void, delayMs: number) => TimerHandle;
  clearInterval?: (handle: TimerHandle) => void;
  conditionEvaluator?: typeof evaluateCondition;
  maxConcurrency?: number;
  ownershipPolicy?: AutomationOwnershipPolicy;
  alert?: (input: { automation: AutomationDefinition; count: number; error: string }) => void;
  log?: (message: string) => void;
}

export type AutomationServiceRuntimeStatus =
  | { status: 'stopped' | 'running' }
  | { status: 'degraded'; reason: string };

export class AutomationService {
  private timer: TimerHandle | undefined;
  private tickPromise: Promise<void> | undefined;
  private startPromise: Promise<void> | undefined;
  private readonly inFlight = new Map<string, Promise<AutomationEvaluation>>();
  private runtimeStatus: AutomationServiceRuntimeStatus = { status: 'stopped' };
  private stopping = false;
  private lifecycleGeneration = 0;

  constructor(private readonly options: AutomationServiceOptions) {
    const concurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
      throw new Error('Automation maxConcurrency must be a positive safe integer.');
    }
  }

  list(workspaceId?: string): AutomationDefinition[] {
    return this.options.store.listAutomations(workspaceId);
  }

  get(automationId: string): AutomationDefinition | undefined {
    return this.options.store.getAutomation(automationId);
  }

  create(input: AutomationCreateInput): AutomationDefinition {
    const automation = this.options.store.createAutomation(input);
    const updated = this.persistInitialNextCheck(automation);
    this.emitDefinition(updated);
    return updated;
  }

  update(automationId: string, input: AutomationUpdateInput): AutomationDefinition {
    const existing = this.requireAutomation(automationId);
    const automation = this.options.store.updateAutomation(automationId, input);
    let updated = automation;
    if (input.activation !== undefined) {
      updated = this.persistInitialNextCheck(automation, true, true);
    } else if (
      input.enabled === true
      && existing.enabled === false
      && this.options.store.getAutomationNextCheckAt(automation.id) === null
      && !this.isConsumedOnce(automation)
    ) {
      updated = this.persistInitialNextCheck(automation);
    }
    this.emitDefinition(updated);
    return updated;
  }

  delete(automationId: string): { deleted: boolean } {
    return this.options.store.deleteAutomation(automationId);
  }

  listEvaluations(automationId: string): AutomationEvaluation[] {
    return this.options.store.listAutomationEvaluations(automationId);
  }

  listRuns(automationId: string): AutomationRun[] {
    return this.options.store.listAutomationRuns(automationId);
  }

  getRuntimeStatus(): AutomationServiceRuntimeStatus {
    return this.runtimeStatus;
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    if (this.runtimeStatus.status === 'running') return Promise.resolve();
    const work = this.startInternal();
    let shared!: Promise<void>;
    shared = work.finally(() => {
      if (this.startPromise === shared) this.startPromise = undefined;
    });
    this.startPromise = shared;
    return shared;
  }

  private async startInternal(): Promise<void> {
    this.stopping = false;
    const generation = ++this.lifecycleGeneration;
    await this.settleActiveWork();
    if (generation !== this.lifecycleGeneration || this.stopping) return;
    try {
      this.options.store.importLegacyAutomations();
    } catch (error) {
      const reason = normalizeAutomationError(error, 'Legacy automation import failed: ');
      this.runtimeStatus = { status: 'degraded', reason };
      this.reportDiagnostic('legacy-import', reason);
      return;
    }
    try {
      const recovered = this.options.store.reconcileInterruptedAutomationRuns(
        normalizeAutomationError(RESTART_INTERRUPTION_REASON),
        this.now().toISOString(),
      );
      for (const run of recovered) this.emitRun(run);
      for (const automation of this.list()) {
        if (
          this.shouldPoll(automation)
          && this.options.store.getAutomationNextCheckAt(automation.id) === null
          && !this.isConsumedOnce(automation)
        ) {
          this.persistInitialNextCheck(automation);
        }
      }
      this.runtimeStatus = { status: 'running' };
      if (this.timer === undefined) {
        this.timer = (this.options.setInterval || setInterval)(() => {
          this.runTimerTick(generation);
        }, DUE_LOOP_INTERVAL_MS);
      }
      await this.tick();
    } catch (error) {
      const isCurrentGeneration = this.lifecycleGeneration === generation && !this.stopping;
      if (isCurrentGeneration) {
        this.clearTimer();
        this.runtimeStatus = { status: 'stopped' };
      }
      const message = normalizeAutomationError(error, 'Automation startup failed: ');
      this.reportDiagnostic('startup', message);
      throw new Error(message);
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const stopGeneration = ++this.lifecycleGeneration;
    this.clearTimer();
    this.runtimeStatus = { status: 'stopped' };
    await this.settleActiveWork();
    if (this.lifecycleGeneration === stopGeneration) {
      this.runtimeStatus = { status: 'stopped' };
    }
  }

  async tick(): Promise<void> {
    if (this.tickPromise) return this.tickPromise;
    const work = this.runTick(this.lifecycleGeneration);
    this.tickPromise = work;
    try {
      await work;
    } finally {
      if (this.tickPromise === work) this.tickPromise = undefined;
    }
  }

  async checkNow(automationId: string): Promise<AutomationEvaluation> {
    const automation = this.requireAutomation(automationId);
    return this.checkAutomation(automation);
  }

  private async runTick(generation: number): Promise<void> {
    const now = this.now();
    const due: AutomationDefinition[] = [];
    for (const automation of this.list()) {
      if (!this.shouldPoll(automation)) continue;
      const nextCheckAt = this.options.store.getAutomationNextCheckAt(automation.id);
      if (nextCheckAt !== null && Date.parse(nextCheckAt) <= now.getTime()) {
        due.push(automation);
      }
    }
    let index = 0;
    const worker = async () => {
      while (!this.stopping && generation === this.lifecycleGeneration) {
        const automation = due[index];
        index += 1;
        if (!automation) return;
        await this.checkAutomation(automation);
      }
    };
    const workerCount = Math.min(due.length, this.options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    if (!this.stopping && generation === this.lifecycleGeneration) {
      this.options.store.pruneAutomationEvaluations(now);
    }
  }

  private async checkAutomation(automation: AutomationDefinition): Promise<AutomationEvaluation> {
    const existing = this.inFlight.get(automation.id);
    if (existing) return this.recordConcurrentSkip(automation);
    const work = this.evaluateAndMaybeRun(automation);
    this.inFlight.set(automation.id, work);
    try {
      return await work;
    } finally {
      if (this.inFlight.get(automation.id) === work) this.inFlight.delete(automation.id);
    }
  }

  private async recordConcurrentSkip(automation: AutomationDefinition): Promise<AutomationEvaluation> {
    const now = this.now();
    const running = this.createEvaluation(automation, now);
    const finished = this.finishEvaluation(running.id, {
      conditionOutcome: 'skipped',
      triggerDecision: 'skipped_concurrent',
      finishedAt: now.toISOString(),
      durationMs: 0,
      resultSummary: 'Skipped because another evaluation is still running.',
    });
    this.updateDefinitionAfterEvaluation(automation, now, {
      nextMatch: automation.lastSuccessfulMatch,
      failureCount: automation.consecutiveEvaluationFailures,
    });
    return finished;
  }

  private async evaluateAndMaybeRun(automation: AutomationDefinition): Promise<AutomationEvaluation> {
    const startedAt = this.now();
    const running = this.createEvaluation(automation, startedAt);
    const actionRunning = this.listRuns(automation.id)
      .some((run) => run.status === 'queued' || run.status === 'running');
    const coolingDown = automation.lastTriggeredAt !== undefined
      && startedAt.getTime() < Date.parse(automation.lastTriggeredAt) + automation.policies.cooldownMs;
    const payload: Record<string, unknown> = {};
    let decision: ReturnType<typeof decideCondition>;
    try {
      decision = decideCondition({
        condition: automation.condition,
        payload,
        previous: automation.lastSuccessfulMatch,
        coolingDown,
        actionRunning,
      }, this.options.conditionEvaluator || evaluateCondition);
    } catch (error) {
      const finishedAt = this.now();
      return this.finishError(
        automation,
        running,
        startedAt,
        finishedAt,
        normalizeAutomationError(error),
      );
    }
    const finishedAt = this.now();
    if (decision.kind === 'script-delegation') {
      const message = normalizeAutomationError(`Approved-script evaluation is unavailable until the script runtime is installed (script ${decision.request.scriptId}, version ${decision.request.approvedVersionId}).`);
      return this.finishError(automation, running, startedAt, finishedAt, message);
    }
    if (decision.conditionOutcome === 'error') {
      return this.finishError(
        automation,
        running,
        startedAt,
        finishedAt,
        normalizeAutomationError(decision.error || 'Condition evaluation failed.'),
      );
    }
    const finishDetails = {
      finishedAt: finishedAt.toISOString(),
      durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      ...(decision.triggerDecision === 'triggered' ? { triggeredAt: finishedAt.toISOString() } : {}),
      payload,
    };
    let finishInput: AutomationEvaluationFinishInput;
    if (decision.conditionOutcome === 'matched') {
      finishInput = { ...finishDetails, conditionOutcome: 'matched', triggerDecision: decision.triggerDecision };
    } else if (decision.conditionOutcome === 'not_matched') {
      finishInput = { ...finishDetails, conditionOutcome: 'not_matched', triggerDecision: 'not_rising' };
    } else {
      finishInput = { ...finishDetails, conditionOutcome: 'skipped', triggerDecision: decision.triggerDecision };
    }
    const finished = this.finishEvaluation(running.id, finishInput);
    const updated = this.updateDefinitionAfterEvaluation(automation, finishedAt, {
      nextMatch: decision.nextMatch,
      failureCount: 0,
      triggered: decision.triggerDecision === 'triggered',
    });
    if (decision.triggerDecision === 'triggered') await this.executeAction(updated, finished, payload);
    return finished;
  }

  private finishError(
    automation: AutomationDefinition,
    running: AutomationEvaluation,
    startedAt: Date,
    finishedAt: Date,
    error: string,
  ): AutomationEvaluation {
    const finished = this.finishEvaluation(running.id, {
      conditionOutcome: 'error',
      triggerDecision: 'not_evaluated',
      finishedAt: finishedAt.toISOString(),
      durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      errorCategory: 'condition_evaluation',
      resultSummary: error,
    });
    const count = automation.consecutiveEvaluationFailures + 1;
    const updated = this.updateDefinitionAfterEvaluation(automation, finishedAt, {
      nextMatch: automation.lastSuccessfulMatch,
      failureCount: count,
    });
    this.options.log?.(normalizeAutomationError(error, `automation evaluation failed ${automation.id} (${count}): `));
    if (FAILURE_ALERT_COUNTS.has(count)) this.options.alert?.({ automation: updated, count, error });
    return finished;
  }

  private async executeAction(
    automation: AutomationDefinition,
    evaluation: AutomationEvaluation,
    payload: Record<string, unknown>,
  ): Promise<void> {
    let run = this.options.store.createAutomationRun(automation.id, evaluation.id);
    this.emitRun(run);
    const startedAt = this.now().toISOString();
    run = this.options.store.updateAutomationRun(run.id, { status: 'running', startedAt });
    this.emitRun(run);
    const promptVariables = {
      title: automation.title,
      timestamp: evaluation.status === 'finished' ? evaluation.finishedAt : startedAt,
      evaluationId: evaluation.id,
      ...payload,
    };
    try {
      const result = await this.options.actionExecutor.execute({ automation, evaluation, promptVariables });
      run = this.options.store.updateAutomationRun(run.id, this.successfulRunUpdate(result));
    } catch (error) {
      const message = normalizeAutomationError(error);
      run = this.options.store.updateAutomationRun(run.id, {
        status: 'failed',
        finishedAt: this.now().toISOString(),
        deliveryStatus: 'failed',
        error: message,
      });
      this.options.log?.(normalizeAutomationError(run.error, `automation action failed ${automation.id}: `));
    }
    this.emitRun(run);
  }

  private successfulRunUpdate(result: AutomationActionExecutionResult) {
    return {
      status: 'succeeded' as const,
      threadId: result.threadId,
      acpRunId: result.acpRunId,
      finishedAt: this.now().toISOString(),
      deliveryStatus: result.deliveryStatus === 'failed' ? 'failed' as const : 'delivered' as const,
      ...(result.deliveryError ? { error: normalizeAutomationError(result.deliveryError) } : {}),
      ...(result.lastBridgeEventAt ? { bridgeActivity: { lastBridgeEventAt: result.lastBridgeEventAt } } : {}),
    };
  }

  private createEvaluation(automation: AutomationDefinition, now: Date): AutomationEvaluation {
    const evaluation = this.options.store.createAutomationEvaluation(automation.id, {
      activationKind: automation.activation.kind,
      ...(automation.condition.kind === 'approved-script'
        ? { scriptVersionId: automation.condition.approvedVersionId }
        : {}),
      startedAt: now.toISOString(),
    });
    this.emitEvaluation(evaluation);
    return evaluation;
  }

  private finishEvaluation(
    evaluationId: string,
    input: Parameters<LocalCoreAcpStore['finishAutomationEvaluation']>[1],
  ): AutomationEvaluation {
    const evaluation = this.options.store.finishAutomationEvaluation(evaluationId, input);
    this.emitEvaluation(evaluation);
    return evaluation;
  }

  private updateDefinitionAfterEvaluation(
    automation: AutomationDefinition,
    now: Date,
    input: { nextMatch: boolean | undefined; failureCount: number; triggered?: boolean },
  ): AutomationDefinition {
    const next = nextActivationAt(automation.activation, now);
    const updated = this.options.store.updateAutomationState(automation.id, {
      ...(input.nextMatch === undefined ? {} : { lastSuccessfulMatch: input.nextMatch }),
      lastEvaluationAt: now.toISOString(),
      ...(input.triggered ? { lastTriggeredAt: now.toISOString() } : {}),
      consecutiveEvaluationFailures: input.failureCount,
      nextCheckAt: next?.toISOString() || null,
    });
    this.emitDefinition(updated);
    return updated;
  }

  private persistInitialNextCheck(
    automation: AutomationDefinition,
    replace = false,
    activationReplaced = false,
  ): AutomationDefinition {
    if (!replace && this.options.store.getAutomationNextCheckAt(automation.id) !== null) return automation;
    const now = this.now();
    let next: Date | null;
    if ((!automation.enabled && !activationReplaced) || automation.activation.kind === 'provider-event') {
      next = null;
    } else if (automation.activation.kind === 'once') {
      next = new Date(automation.activation.runAt);
    } else if (automation.lastEvaluationAt) {
      next = missedActivationAt(automation.activation, automation.lastEvaluationAt, now)
        || nextActivationAt(automation.activation, now);
    } else if (automation.activation.kind === 'interval') {
      next = new Date(Math.floor(now.getTime() / automation.activation.intervalMs) * automation.activation.intervalMs);
    } else {
      const baseline = new Date(Math.min(Date.parse(automation.createdAt), now.getTime() - 24 * 60 * 60 * 1_000));
      next = missedActivationAt(automation.activation, baseline.toISOString(), now)
        || nextActivationAt(automation.activation, now);
    }
    return this.options.store.updateAutomationState(automation.id, { nextCheckAt: next?.toISOString() || null });
  }

  private shouldPoll(automation: AutomationDefinition): boolean {
    return automation.enabled
      && automation.health === 'healthy'
      && automation.activation.kind !== 'provider-event'
      && (this.options.ownershipPolicy || NATIVE_AUTOMATION_OWNERSHIP).executes(automation);
  }

  private isConsumedOnce(automation: AutomationDefinition): boolean {
    if (automation.activation.kind !== 'once') return false;
    if (automation.lastEvaluationAt !== undefined) return true;
    return this.listEvaluations(automation.id).some((evaluation) => evaluation.status === 'finished');
  }

  private requireAutomation(automationId: string): AutomationDefinition {
    const automation = this.get(automationId);
    if (!automation) throw new Error(`Automation not found: ${automationId}`);
    return automation;
  }

  private now(): Date {
    const now = (this.options.clock || (() => new Date()))();
    if (!Number.isFinite(now.getTime())) throw new Error('Automation clock returned an invalid date.');
    return new Date(now);
  }

  private emitDefinition(automation: AutomationDefinition): void {
    this.options.eventBus.emit({ type: 'automation.definition.updated', payload: automation });
  }

  private emitEvaluation(evaluation: AutomationEvaluation): void {
    this.options.eventBus.emit({ type: 'automation.evaluation.updated', payload: evaluation });
  }

  private emitRun(run: AutomationRun): void {
    this.options.eventBus.emit({ type: 'automation.run.updated', payload: run });
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    (this.options.clearInterval || clearInterval)(this.timer as ReturnType<typeof setInterval>);
    this.timer = undefined;
  }

  private runTimerTick(generation: number): void {
    if (!this.isActiveGeneration(generation)) return;
    void this.tick().catch((error) => this.handleTimerFailure(error, generation));
  }

  private handleTimerFailure(error: unknown, generation: number): void {
    const reason = normalizeAutomationError(error, 'Automation timer tick failed: ');
    if (this.isActiveGeneration(generation)) {
      try {
        this.clearTimer();
      } catch {
        this.timer = undefined;
      }
      this.runtimeStatus = { status: 'degraded', reason };
    }
    this.reportDiagnostic('timer-tick', reason);
  }

  private isActiveGeneration(generation: number): boolean {
    return generation === this.lifecycleGeneration
      && !this.stopping
      && this.runtimeStatus.status === 'running';
  }

  private async settleActiveWork(): Promise<void> {
    const tick = this.tickPromise;
    if (tick) await Promise.allSettled([tick]);
    await Promise.allSettled([...this.inFlight.values()]);
  }

  private reportDiagnostic(phase: string, error: string): void {
    try {
      this.options.log?.(error);
    } catch {
      // Diagnostics must not destabilize automation lifecycle handling.
    }
    try {
      this.options.eventBus.emit({
        type: 'localcore.error',
        payload: { scope: 'automation-service', error, context: { phase } },
      });
    } catch {
      // Diagnostics must not destabilize automation lifecycle handling.
    }
  }
}

export function normalizeAutomationError(error: unknown, prefix = ''): string {
  let raw: string;
  try {
    raw = error instanceof Error ? error.message : String(error);
  } catch {
    raw = 'Unprintable error';
  }
  const withoutControls = `${prefix}${raw}`.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
  return redactSecrets(withoutControls)
    .replace(/\b(password|api[-_]?key)\s*[:=]\s*[^\s]+/gi, '$1=[REDACTED_SECRET]')
    .slice(0, AUTOMATION_ERROR_MAX_LENGTH);
}
