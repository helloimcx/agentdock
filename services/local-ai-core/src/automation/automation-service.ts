import type {
  AutomationCreateInput,
  AutomationDefinition,
  AutomationEvaluation,
  AutomationMonitorEventSnapshot,
  AutomationEvaluationFinishInput,
  AutomationRun,
  AutomationScriptTestReport,
  AutomationUpdateInput,
} from '@cc/superai-contracts';
import type { DomainEventType, EventBus, EventBusEvent } from '@cc/plugin-sdk';
import { redactSecrets, type LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import {
  decideTrigger,
  decideCondition,
  evaluateCondition,
} from './automation-condition-engine.js';
import {
  ScriptProtocolError,
  ScriptProtocolRunner,
} from './scripts/script-protocol-runner.js';
import { createAnthropicSandboxRunner } from './scripts/anthropic-sandbox-runner.js';
import { evaluateExpression } from './condition-evaluator.js';
import { missedActivationAt, nextActivationAt } from './automation-trigger-engine.js';
import type {
  AutomationActionExecutionResult,
  AutomationActionExecutor,
} from './automation-action-executor.js';
import {
  automationToMonitor,
  automationToMonitorRun,
  automationToScheduledJob,
  automationToScheduledJobRun,
  latestAutomationRun,
  latestFinishedEvaluation,
  type LegacyAutomationCreateInput,
} from './legacy-automation-mappers.js';

const DUE_LOOP_INTERVAL_MS = 30_000;
const DEFAULT_MAX_CONCURRENCY = 4;
export const AUTOMATION_ERROR_MAX_LENGTH = 2_000;
export const PROVIDER_LIFECYCLE_BLOCK_PREFIX = 'Automation monitor provider lifecycle blocked: ';
const PROVIDER_JSON_MAX_DEPTH = 64;
const PROVIDER_JSON_MAX_SIZE = 100_000;
const PROVIDER_EVENT_STRING_MAX_LENGTH = 16_384;
const FAILURE_ALERT_COUNTS = new Set([1, 3, 7, 15, 31]);
const RESTART_INTERRUPTION_REASON = 'Automation action interrupted by Local AI Core restart.';

export interface AutomationOwnershipPolicy {
  executes(automation: AutomationDefinition): boolean;
}

export const NATIVE_AUTOMATION_OWNERSHIP: AutomationOwnershipPolicy = {
  executes: () => true,
};

type TimerHandle = unknown;
type ActionExecutor = Pick<AutomationActionExecutor, 'execute'>;
type EvaluationContext = {
  payload: Record<string, unknown>;
  nextState: Record<string, unknown>;
  occurredAt: string;
};

export interface AutomationServiceOptions {
  store: LocalCoreAcpStore;
  eventBus: EventBus;
  actionExecutor: ActionExecutor;
  clock?: () => Date;
  setInterval?: (handler: () => void, delayMs: number) => TimerHandle;
  clearInterval?: (handle: TimerHandle) => void;
  conditionEvaluator?: typeof evaluateCondition;
  scriptProtocolRunner?: Pick<ScriptProtocolRunner, 'run'> & Partial<Pick<ScriptProtocolRunner, 'runTest'>>;
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
  private scriptProtocolRunner: (Pick<ScriptProtocolRunner, 'run'> & Partial<Pick<ScriptProtocolRunner, 'runTest'>>) | undefined;

  constructor(private readonly options: AutomationServiceOptions) {
    const concurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
      throw new Error('Automation maxConcurrency must be a positive safe integer.');
    }
    this.scriptProtocolRunner = options.scriptProtocolRunner;
  }

  list(workspaceId?: string): AutomationDefinition[] {
    return this.options.store.listAutomations(workspaceId);
  }

  get(automationId: string): AutomationDefinition | undefined {
    return this.options.store.getAutomation(automationId);
  }

  create(input: AutomationCreateInput): AutomationDefinition {
    const updated = this.options.store.createAutomationAtomically(input, (automation) => ({
      nextCheckAt: this.initialNextCheckAt(automation),
    }));
    this.emitDefinition(updated);
    return updated;
  }

  createFromLegacy(input: LegacyAutomationCreateInput): AutomationDefinition {
    this.assertLegacyFacadesAvailable();
    const updated = this.options.store.createTrustedAutomationAtomically(input, (automation) => ({
      nextCheckAt: this.initialNextCheckAt(automation),
    }));
    this.emitDefinition(updated);
    return updated;
  }

  assertLegacyFacadesAvailable(): void {
    if (this.runtimeStatus.status === 'degraded') {
      throw new Error(`Unified automation migration is unavailable: ${this.runtimeStatus.reason}`);
    }
  }

  update(automationId: string, input: AutomationUpdateInput): AutomationDefinition {
    return this.updateInternal(automationId, input);
  }

  updateFromLegacy(
    automationId: string,
    input: AutomationUpdateInput & { legacyMetadata?: AutomationDefinition['legacyMetadata'] },
  ): AutomationDefinition {
    this.assertLegacyFacadesAvailable();
    return this.updateInternal(automationId, input, true);
  }

  private updateInternal(
    automationId: string,
    input: AutomationUpdateInput,
    trustedLegacy = false,
  ): AutomationDefinition {
    const existing = this.requireAutomation(automationId);
    const initialize = (automation: AutomationDefinition) => {
      if (input.activation !== undefined) {
        return { nextCheckAt: this.initialNextCheckAt(automation, true) };
      }
      if (
      input.enabled === true
      && existing.enabled === false
      && this.options.store.getAutomationNextCheckAt(automation.id) === null
      && !this.isConsumedOnce(automation)
      ) return { nextCheckAt: this.initialNextCheckAt(automation) };
      return undefined;
    };
    const updated = trustedLegacy
      ? this.options.store.updateTrustedAutomationAtomically(automationId, input, initialize)
      : this.options.store.updateAutomationAtomically(automationId, input, initialize);
    this.emitDefinition(updated);
    return updated;
  }

  delete(automationId: string): { deleted: boolean } {
    return this.options.store.deleteAutomation(automationId);
  }

  listEvaluations(automationId: string): AutomationEvaluation[] {
    return this.options.store.listAutomationEvaluations(automationId);
  }

  getLatestEvaluationWithState(automationId: string): AutomationEvaluation | undefined {
    return this.options.store.getLatestAutomationEvaluationWithState(automationId);
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
    if (automation.activation.kind === 'provider-event') {
      throw new Error(`Provider-event automation requires an event snapshot: ${automationId}`);
    }
    return this.checkAutomation(automation, undefined, true);
  }

  /** The HTTP layer calls this only after the approval service grants one test run. */
  async executeAuthorizedScriptTest(versionId: string): Promise<AutomationScriptTestReport> {
    const version = this.options.store.getAutomationScriptVersion(versionId);
    if (!version || version.status !== 'testing') {
      throw new Error('Automation script test requires a claimed test authorization.');
    }
    const finishedAt = this.now().toISOString();
    try {
      const result = await this.getScriptTestRunner().runTest({
        scriptId: version.scriptId,
        approvedVersionId: version.id,
        evaluationId: `script-test:${version.id}`,
        triggeredAt: finishedAt,
        previousState: {},
      });
      return {
        status: 'passed',
        finishedAt: this.now().toISOString(),
        ...(result.summary === undefined ? {} : { summary: result.summary }),
      };
    } catch (error) {
      return {
        status: 'failed',
        finishedAt: this.now().toISOString(),
        summary: normalizeAutomationError(error),
      };
    }
  }

  async evaluateProviderEvent(
    automationId: string,
    event: AutomationMonitorEventSnapshot,
  ): Promise<AutomationEvaluation> {
    this.assertLegacyFacadesAvailable();
    const automation = this.requireAutomation(automationId);
    if (automation.activation.kind !== 'provider-event') {
      throw new Error(`Automation is not provider-event activated: ${automationId}`);
    }
    const snapshot = normalizeProviderEventSnapshot(event);
    if (snapshot.sourceType !== automation.activation.sourceType) {
      throw new Error(normalizeAutomationError(`Provider event source "${snapshot.sourceType}" does not match automation source "${automation.activation.sourceType}".`));
    }
    return this.checkAutomation(automation, this.providerEventContext(automation, snapshot));
  }

  recordUnavailableProviderEvent(automationId: string, reason: string): AutomationEvaluation {
    this.assertLegacyFacadesAvailable();
    const automation = this.requireAutomation(automationId);
    if (automation.activation.kind !== 'provider-event') {
      throw new Error(`Automation is not provider-event activated: ${automationId}`);
    }
    const startedAt = this.now();
    const running = this.createEvaluation(automation, startedAt);
    const finishedAt = this.now();
    const finished = this.finishEvaluation(running.id, {
      conditionOutcome: 'skipped',
      triggerDecision: 'not_evaluated',
      finishedAt: finishedAt.toISOString(),
      durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      resultSummary: normalizeAutomationError(reason),
    });
    this.updateDefinitionAfterEvaluation(automation, finishedAt, {
      nextMatch: automation.lastSuccessfulMatch,
      failureCount: automation.consecutiveEvaluationFailures,
    });
    this.emitCompatibilityEvaluationRun(automation, finished);
    return finished;
  }

  failClosedLegacyAutomation(automationId: string, reason: string): AutomationDefinition {
    const automation = this.requireAutomation(automationId);
    if (automation.originKind === 'native') {
      throw new Error(`Automation is not owned by a legacy facade: ${automationId}`);
    }
    const blocked = this.options.store.updateAutomationAtomically(automationId, { enabled: false }, () => ({
      health: 'blocked',
      blockedReason: providerLifecycleBlockReason(reason),
    }));
    this.emitDefinition(blocked);
    return blocked;
  }

  markLegacyProviderLifecycleBlocked(automationId: string, reason: string): AutomationDefinition {
    const automation = this.requireAutomation(automationId);
    if (automation.originKind !== 'automation-monitor') {
      throw new Error(`Automation is not owned by the legacy monitor facade: ${automationId}`);
    }
    const blocked = this.options.store.updateAutomationState(automationId, {
      health: 'blocked',
      blockedReason: providerLifecycleBlockReason(reason),
    });
    this.emitDefinition(blocked);
    return blocked;
  }

  clearLegacyProviderLifecycleBlocked(automationId: string, expectedReason: string): AutomationDefinition {
    const automation = this.requireAutomation(automationId);
    if (automation.originKind !== 'automation-monitor') {
      throw new Error(`Automation is not owned by the legacy monitor facade: ${automationId}`);
    }
    if (automation.health !== 'blocked' || automation.blockedReason !== normalizeAutomationError(expectedReason)) {
      return automation;
    }
    const healthy = this.options.store.updateAutomationState(automationId, { health: 'healthy' });
    this.emitDefinition(healthy);
    return healthy;
  }

  private async runTick(generation: number): Promise<void> {
    const now = this.now();
    const due: AutomationDefinition[] = [];
    const dueIds = this.options.store.listDueAutomationIds(now);
    for (const automation of this.list()) {
      if (!this.shouldPoll(automation)) continue;
      if (dueIds.has(automation.id)) {
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

  private async checkAutomation(
    automation: AutomationDefinition,
    context?: EvaluationContext,
    manual = false,
  ): Promise<AutomationEvaluation> {
    const existing = this.inFlight.get(automation.id);
    if (existing) return this.recordConcurrentSkip(automation, context);
    const work = this.evaluateAndMaybeRun(automation, context, manual);
    this.inFlight.set(automation.id, work);
    try {
      return await work;
    } finally {
      if (this.inFlight.get(automation.id) === work) this.inFlight.delete(automation.id);
    }
  }

  private async recordConcurrentSkip(
    automation: AutomationDefinition,
    context?: EvaluationContext,
  ): Promise<AutomationEvaluation> {
    const now = context ? new Date(context.occurredAt) : this.now();
    const running = this.createEvaluation(automation, now);
    const finished = this.finishEvaluation(running.id, {
      conditionOutcome: 'skipped',
      triggerDecision: 'skipped_concurrent',
      finishedAt: now.toISOString(),
      durationMs: 0,
      resultSummary: 'Skipped because another evaluation is still running.',
      ...(context ? { payload: context.payload, nextState: context.nextState } : {}),
    });
    this.updateDefinitionAfterEvaluation(automation, now, {
      nextMatch: automation.lastSuccessfulMatch,
      failureCount: automation.consecutiveEvaluationFailures,
    });
    this.emitCompatibilityEvaluationRun(automation, finished);
    return finished;
  }

  private async evaluateAndMaybeRun(
    automation: AutomationDefinition,
    context?: EvaluationContext,
    manual = false,
  ): Promise<AutomationEvaluation> {
    const startedAt = context ? new Date(context.occurredAt) : this.now();
    const running = this.createEvaluation(automation, startedAt);
    const actionRunning = this.listRuns(automation.id)
      .some((run) => run.status === 'queued' || run.status === 'running');
    const coolingDown = automation.lastTriggeredAt !== undefined
      && startedAt.getTime() < Date.parse(automation.lastTriggeredAt) + automation.policies.cooldownMs;
    const payload = context?.payload || {};
    let decision: ReturnType<typeof decideCondition>;
    try {
      const legacySnapshot = automation.originKind === 'automation-monitor'
        && automation.condition.kind === 'expression'
        && isPlainRecord(payload.eventSnapshot)
        ? payload.eventSnapshot as unknown as AutomationMonitorEventSnapshot
        : undefined;
      const evaluator = this.options.conditionEvaluator || (legacySnapshot
        ? ((condition: AutomationDefinition['condition']) => condition.kind === 'expression'
          ? { kind: 'evaluated' as const, matched: evaluateExpression(condition.expression, legacySnapshot) }
          : evaluateCondition(condition, payload))
        : evaluateCondition);
      decision = decideCondition({
        condition: automation.condition,
        payload,
        previous: automation.condition.kind === 'always' ? undefined : automation.lastSuccessfulMatch,
        coolingDown,
        actionRunning,
      }, evaluator);
    } catch (error) {
      const finishedAt = this.now();
      return this.finishError(
        automation,
        running,
        startedAt,
        finishedAt,
        normalizeAutomationError(error),
        context,
      );
    }
    const finishedAt = this.now();
    if (decision.kind === 'script-delegation') {
      try {
        const previousEvaluation = this.getLatestEvaluationWithState(automation.id);
        const previousState = previousEvaluation?.status === 'finished' && previousEvaluation.nextState
          ? previousEvaluation.nextState
          : {};
        const scriptResult = await this.getScriptProtocolRunner().run({
          scriptId: decision.request.scriptId,
          approvedVersionId: decision.request.approvedVersionId,
          evaluationId: running.id,
          triggeredAt: startedAt.toISOString(),
          previousState,
        });
        const scriptDecision = decideTrigger({
          previous: automation.lastSuccessfulMatch,
          matched: scriptResult.matched,
          coolingDown,
          actionRunning,
        });
        const scriptFinishedAt = this.now();
        const scriptPayload = scriptResult.payload || {};
        const scriptFinishDetails = {
          finishedAt: scriptFinishedAt.toISOString(),
          durationMs: Math.max(0, scriptFinishedAt.getTime() - startedAt.getTime()),
          ...(scriptDecision.triggerDecision === 'triggered' ? { triggeredAt: startedAt.toISOString() } : {}),
          payload: scriptPayload,
          ...(scriptResult.nextState === undefined ? {} : { nextState: scriptResult.nextState }),
          stdout: scriptResult.stdout,
          stderr: scriptResult.stderr,
          exitCode: scriptResult.exitCode === null ? undefined : scriptResult.exitCode,
          outputTruncated: scriptResult.outputTruncated,
          ...(scriptResult.networkAudit === undefined ? {} : { networkAudit: scriptResult.networkAudit }),
          ...(scriptResult.summary === undefined ? {} : { resultSummary: scriptResult.summary }),
        };
        const scriptFinished = this.finishEvaluation(running.id, scriptDecision.conditionOutcome === 'matched'
          ? { ...scriptFinishDetails, conditionOutcome: 'matched', triggerDecision: scriptDecision.triggerDecision }
          : { ...scriptFinishDetails, conditionOutcome: 'not_matched', triggerDecision: 'not_rising' });
        const updated = this.updateDefinitionAfterEvaluation(automation, startedAt, {
          nextMatch: scriptDecision.nextMatch,
          failureCount: 0,
          triggered: scriptDecision.triggerDecision === 'triggered',
        });
        if (scriptDecision.triggerDecision === 'triggered') {
          await this.executeAction(updated, scriptFinished, scriptPayload);
        } else {
          this.emitCompatibilityEvaluationRun(updated, scriptFinished);
        }
        return scriptFinished;
      } catch (error) {
        const message = normalizeAutomationError(error);
        if (error instanceof ScriptProtocolError && error.blockAutomation) this.blockAutomation(automation, message);
        return this.finishError(automation, running, startedAt, this.now(), message, undefined,
          error instanceof ScriptProtocolError ? { networkAudit: error.networkAudit } : undefined);
      }
    }
    if (decision.conditionOutcome === 'error') {
      return this.finishError(
        automation,
        running,
        startedAt,
        finishedAt,
        normalizeAutomationError(decision.error || 'Condition evaluation failed.'),
        context,
      );
    }
    const finishDetails = {
      finishedAt: finishedAt.toISOString(),
      durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      ...(decision.triggerDecision === 'triggered' ? { triggeredAt: startedAt.toISOString() } : {}),
      payload,
      ...(context ? { nextState: context.nextState } : {}),
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
    const updated = this.updateDefinitionAfterEvaluation(automation, startedAt, {
      nextMatch: decision.nextMatch,
      failureCount: 0,
      triggered: decision.triggerDecision === 'triggered',
    });
    if (decision.triggerDecision === 'triggered') {
      const run = await this.executeAction(updated, finished, payload);
      if (!manual && updated.originKind === 'scheduled-job' && updated.activation.kind === 'once' && run.status === 'succeeded') {
        const disabled = this.options.store.updateAutomation(updated.id, { enabled: false });
        this.emitDefinition(disabled);
      }
    } else {
      this.emitCompatibilityEvaluationRun(updated, finished);
    }
    return finished;
  }

  private finishError(
    automation: AutomationDefinition,
    running: AutomationEvaluation,
    startedAt: Date,
    finishedAt: Date,
    error: string,
    context?: EvaluationContext,
    details?: { networkAudit?: Array<{ host: string; port?: number; allowed: boolean; timestamp: string }> },
  ): AutomationEvaluation {
    const finished = this.finishEvaluation(running.id, {
      conditionOutcome: 'error',
      triggerDecision: 'not_evaluated',
      finishedAt: finishedAt.toISOString(),
      durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      errorCategory: 'condition_evaluation',
      resultSummary: error,
      ...(context ? { payload: context.payload, nextState: context.nextState } : {}),
      ...(details?.networkAudit === undefined ? {} : { networkAudit: details.networkAudit }),
    });
    const count = automation.consecutiveEvaluationFailures + 1;
    const updated = this.updateDefinitionAfterEvaluation(automation, context ? startedAt : finishedAt, {
      nextMatch: automation.lastSuccessfulMatch,
      failureCount: count,
    });
    this.options.log?.(normalizeAutomationError(error, `automation evaluation failed ${automation.id} (${count}): `));
    if (FAILURE_ALERT_COUNTS.has(count)) this.options.alert?.({ automation: updated, count, error });
    this.emitCompatibilityEvaluationRun(updated, finished);
    return finished;
  }

  private getScriptProtocolRunner(): Pick<ScriptProtocolRunner, 'run'> {
    if (!this.scriptProtocolRunner) {
      this.scriptProtocolRunner = new ScriptProtocolRunner({
        sandbox: createAnthropicSandboxRunner(),
        getVersion: (versionId) => this.options.store.getAutomationScriptVersion(versionId),
      });
    }
    return this.scriptProtocolRunner;
  }

  private getScriptTestRunner(): Pick<ScriptProtocolRunner, 'runTest'> {
    if (!this.scriptProtocolRunner?.runTest) {
      this.scriptProtocolRunner = new ScriptProtocolRunner({
        sandbox: createAnthropicSandboxRunner(),
        getVersion: (versionId) => this.options.store.getAutomationScriptVersion(versionId),
      });
    }
    return this.scriptProtocolRunner as Pick<ScriptProtocolRunner, 'runTest'>;
  }

  private blockAutomation(automation: AutomationDefinition, reason: string) {
    const blocked = this.options.store.updateAutomationState(automation.id, {
      health: 'blocked',
      blockedReason: normalizeAutomationError(reason),
    });
    this.emitDefinition(blocked);
  }

  private async executeAction(
    automation: AutomationDefinition,
    evaluation: AutomationEvaluation,
    payload: Record<string, unknown>,
  ): Promise<AutomationRun> {
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
    return run;
  }

  private successfulRunUpdate(result: AutomationActionExecutionResult) {
    const bridgeActivity = {
      ...(result.deliveryMode ? { deliveryMode: result.deliveryMode } : {}),
      ...(result.lastBridgeEventAt ? { lastBridgeEventAt: result.lastBridgeEventAt } : {}),
    };
    return {
      status: 'succeeded' as const,
      threadId: result.threadId,
      acpRunId: result.acpRunId,
      finishedAt: this.now().toISOString(),
      deliveryStatus: result.deliveryStatus === 'failed' ? 'failed' as const : 'delivered' as const,
      ...(result.deliveryError ? { error: normalizeAutomationError(result.deliveryError) } : {}),
      ...(Object.keys(bridgeActivity).length > 0 ? { bridgeActivity } : {}),
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
    return this.options.store.updateAutomationState(automation.id, {
      nextCheckAt: this.initialNextCheckAt(automation, activationReplaced),
    });
  }

  private initialNextCheckAt(automation: AutomationDefinition, activationReplaced = false): string | null {
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
    return next?.toISOString() || null;
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
    this.emitEvent({ type: 'automation.definition.updated', payload: automation });
    try {
      if (automation.originKind === 'scheduled-job') {
        this.emitEvent({
          type: 'scheduler.job.updated',
          payload: automationToScheduledJob(automation, latestAutomationRun(this.listRuns(automation.id))),
        });
      } else if (automation.originKind === 'automation-monitor') {
        const latest = latestFinishedEvaluation(this.listEvaluations(automation.id));
        this.emitEvent({
          type: 'automation.monitor.updated',
          payload: automationToMonitor(
            automation,
            latest,
            latestAutomationRun(this.listRuns(automation.id)),
            this.getLatestEvaluationWithState(automation.id),
          ),
        });
      }
    } catch (error) {
      this.reportDiagnostic('event-projection', normalizeAutomationError(error, 'Automation event projection failed: '));
    }
  }

  private emitEvaluation(evaluation: AutomationEvaluation): void {
    this.emitEvent({ type: 'automation.evaluation.updated', payload: evaluation });
  }

  private emitRun(run: AutomationRun): void {
    this.emitEvent({ type: 'automation.run.updated', payload: run });
    try {
      const automation = this.get(run.automationId);
      const evaluation = this.listEvaluations(run.automationId).find((candidate) => candidate.id === run.evaluationId);
      if (!automation || !evaluation) return;
      if (automation.originKind === 'scheduled-job') {
        this.emitEvent({ type: 'scheduler.run.updated', payload: automationToScheduledJobRun(evaluation, run) });
      } else if (automation.originKind === 'automation-monitor') {
        this.emitEvent({ type: 'automation.monitor.run.updated', payload: automationToMonitorRun(evaluation, run) });
      }
    } catch (error) {
      this.reportDiagnostic('event-projection', normalizeAutomationError(error, 'Automation event projection failed: '));
    }
  }

  private emitCompatibilityEvaluationRun(
    automation: AutomationDefinition,
    evaluation: AutomationEvaluation,
  ): void {
    try {
      if (automation.originKind === 'scheduled-job') {
        this.emitEvent({
          type: 'scheduler.run.updated',
          payload: automationToScheduledJobRun(evaluation),
        });
      } else if (automation.originKind === 'automation-monitor') {
        this.emitEvent({
          type: 'automation.monitor.run.updated',
          payload: automationToMonitorRun(evaluation),
        });
      }
    } catch (error) {
      this.reportDiagnostic('event-projection', normalizeAutomationError(error, 'Automation event projection failed: '));
    }
  }

  private providerEventContext(
    automation: AutomationDefinition,
    event: AutomationMonitorEventSnapshot,
  ): EvaluationContext {
    const occurredAt = normalizeProviderEventTimestamp(event.occurredAt);
    const previousEvaluation = this.getLatestEvaluationWithState(automation.id);
    const previous = previousEvaluation?.status === 'finished' ? previousEvaluation.nextState : undefined;
    const nextState = {
      ...(previous || {}),
      ...event.payload,
      payload: event.payload,
      lastEventId: event.id,
      lastEventAt: occurredAt,
    };
    return {
      payload: {
        ...event.payload,
        ...(!Object.prototype.hasOwnProperty.call(event.payload, 'subject') ? { subject: event.subject } : {}),
        ...(!Object.prototype.hasOwnProperty.call(event.payload, 'sourceType') ? { sourceType: event.sourceType } : {}),
        eventSubject: event.subject,
        eventSourceType: event.sourceType,
        occurredAt,
        timestamp: occurredAt,
        summary: event.summary || '',
        eventSnapshot: event,
        previous: previous || {},
      },
      nextState,
      occurredAt,
    };
  }

  private emitEvent<TType extends DomainEventType>(event: EventBusEvent<TType>): void {
    try {
      this.options.eventBus.emit(event);
    } catch (error) {
      this.reportDiagnostic('event-projection', normalizeAutomationError(error, 'Automation event projection failed: '));
    }
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

export function providerLifecycleBlockReason(error: unknown): string {
  const normalized = normalizeAutomationError(error);
  return normalized.startsWith(PROVIDER_LIFECYCLE_BLOCK_PREFIX)
    ? normalized
    : normalizeAutomationError(normalized, PROVIDER_LIFECYCLE_BLOCK_PREFIX);
}

function normalizeProviderEventTimestamp(value: unknown): string {
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.trim())
  ) {
    throw new Error('Provider event occurredAt must be a valid ISO timestamp.');
  }
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error('Provider event occurredAt must be a valid ISO timestamp.');
  }
  return timestamp.toISOString();
}

export function normalizeProviderEventSnapshot(value: unknown): AutomationMonitorEventSnapshot {
  if (!isPlainRecord(value)) throw new Error('Provider event must be a plain object.');
  assertOwnDataProperties(value, 'Provider event');
  for (const field of ['id', 'sourceType', 'subject'] as const) {
    const fieldValue = ownDataProperty(value, field);
    if (typeof fieldValue !== 'string' || !fieldValue.trim()) {
      throw new Error(`Provider event ${field} must be a non-empty string.`);
    }
  }
  const summary = ownDataProperty(value, 'summary');
  if (summary !== undefined && typeof summary !== 'string') {
    throw new Error('Provider event summary must be a string when provided.');
  }
  const occurredAt = ownDataProperty(value, 'occurredAt');
  const normalizedOccurredAt = normalizeProviderEventTimestampStrict(occurredAt);
  const topLevelStrings = [
    ownDataProperty(value, 'id'),
    ownDataProperty(value, 'sourceType'),
    ownDataProperty(value, 'subject'),
    occurredAt,
    ...(summary === undefined ? [] : [summary]),
  ] as string[];
  if (topLevelStrings.some((field) => field.length > PROVIDER_EVENT_STRING_MAX_LENGTH)) {
    throw new Error('Provider event string field exceeds the maximum length.');
  }
  const topLevelSize = topLevelStrings.reduce((total, field) => total + field.length, 0);
  if (topLevelSize > PROVIDER_JSON_MAX_SIZE) throw new Error('Provider event exceeds the maximum total size.');
  const payloadValue = ownDataProperty(value, 'payload');
  if (!isPlainRecord(payloadValue)) throw new Error('Provider event payload must be a plain object.');
  let payload: Record<string, unknown>;
  try {
    payload = cloneProviderJsonValue(payloadValue, '$', {
      ancestors: new WeakSet<object>(),
      size: topLevelSize,
    }, 0) as Record<string, unknown>;
  } catch (error) {
    throw new Error(normalizeAutomationError(error, 'Invalid provider event payload: '));
  }
  return {
    id: ownDataProperty(value, 'id') as string,
    sourceType: ownDataProperty(value, 'sourceType') as string,
    subject: ownDataProperty(value, 'subject') as string,
    occurredAt: normalizedOccurredAt,
    ...(summary === undefined ? {} : { summary }),
    payload,
  };
}

type ProviderJsonCloneState = {
  ancestors: WeakSet<object>;
  size: number;
};

function cloneProviderJsonValue(
  value: unknown,
  path: string,
  state: ProviderJsonCloneState,
  depth: number,
): unknown {
  if (depth > PROVIDER_JSON_MAX_DEPTH) throw new Error(`${path} exceeds the maximum nesting depth.`);
  state.size += typeof value === 'string' ? value.length + 1 : 1;
  if (state.size > PROVIDER_JSON_MAX_SIZE) throw new Error(`${path} exceeds the maximum payload size.`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} must contain only finite numbers.`);
    return value;
  }
  if (typeof value !== 'object') throw new Error(`${path} contains a non-JSON value.`);
  if (state.ancestors.has(value)) throw new Error(`${path} contains a cycle.`);
  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error(`${path} must be a plain array.`);
      if (Object.getOwnPropertySymbols(value).length > 0) throw new Error(`${path} contains a symbol property.`);
      const keys = Object.getOwnPropertyNames(value);
      for (const key of keys) {
        if (key !== 'length' && !isArrayIndex(key, value.length)) {
          throw new Error(`${path} contains a non-index array property.`);
        }
      }
      const clone: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor) throw new Error(`${path}[${index}] must not be sparse.`);
        if (!('value' in descriptor)) throw new Error(`${path}[${index}] must be a data property.`);
        clone.push(cloneProviderJsonValue(descriptor.value, `${path}[${index}]`, state, depth + 1));
      }
      return clone;
    }
    if (!isPlainRecord(value)) throw new Error(`${path} must contain only plain objects and arrays.`);
    if (Object.getOwnPropertySymbols(value).length > 0) throw new Error(`${path} contains a symbol property.`);
    const clone: Record<string, unknown> = {};
    for (const key of Object.getOwnPropertyNames(value)) {
      state.size += key.length;
      if (state.size > PROVIDER_JSON_MAX_SIZE) throw new Error(`${path} exceeds the maximum payload size.`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      const propertyPath = providerJsonPropertyPath(path, key);
      if (!('value' in descriptor)) throw new Error(`${propertyPath} must be a data property.`);
      Object.defineProperty(clone, key, {
        value: cloneProviderJsonValue(descriptor.value, propertyPath, state, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return clone;
  } finally {
    state.ancestors.delete(value);
  }
}

function assertOwnDataProperties(value: Record<string, unknown>, context: string): void {
  if (Object.getOwnPropertySymbols(value).length > 0) throw new Error(`${context} must not contain symbol properties.`);
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in descriptor)) throw new Error(`${context} ${key} must be a data property.`);
  }
}

function ownDataProperty(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function isArrayIndex(key: string, length: number): boolean {
  if (!/^(0|[1-9]\d*)$/.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length;
}

function providerJsonPropertyPath(path: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key.slice(0, 80))}${key.length > 80 ? '…' : ''}]`;
}

function normalizeProviderEventTimestampStrict(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) throw new Error('Provider event occurredAt must be a valid ISO timestamp.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fraction = String(match[7] || '').padEnd(3, '0').slice(0, 3);
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, Number(fraction));
  if (
    local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day
    || local.getUTCHours() !== hour || local.getUTCMinutes() !== minute || local.getUTCSeconds() !== second
  ) throw new Error('Provider event occurredAt must be a valid ISO timestamp.');
  const zone = String(match[8]);
  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const zoneMatch = zone.match(/^([+-])(\d{2}):(\d{2})$/)!;
    const offsetHour = Number(zoneMatch[2]);
    const offsetMinute = Number(zoneMatch[3]);
    if (offsetHour > 23 || offsetMinute > 59) throw new Error('Provider event occurredAt must be a valid ISO timestamp.');
    offsetMinutes = (offsetHour * 60 + offsetMinute) * (zoneMatch[1] === '+' ? 1 : -1);
  }
  return new Date(local.getTime() - offsetMinutes * 60_000).toISOString();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
