import type {
  AutomationDefinition,
  AutomationEvaluation,
  AutomationMonitorEventSnapshot,
  AutomationRun,
} from '@cc/superai-contracts';
import type { DomainEventType, EventBus, EventBusEvent } from '@cc/plugin-sdk';
import {
  normalizeAutomationError,
  normalizeProviderEventTimestamp,
} from './automation-event-utils.js';
import {
  automationToMonitor,
  automationToMonitorRun,
  automationToScheduledJob,
  automationToScheduledJobRun,
  latestAutomationRun,
  latestFinishedEvaluation,
} from './legacy-automation-mappers.js';

export interface EvaluationContext {
  payload: Record<string, unknown>;
  nextState: Record<string, unknown>;
  occurredAt: string;
}

export interface AutomationEventProjectorStoreDelegate {
  getAutomation: (automationId: string) => AutomationDefinition | undefined;
  listRuns: (automationId: string) => AutomationRun[];
  listEvaluations: (automationId: string) => AutomationEvaluation[];
  getLatestEvaluationWithState: (automationId: string) => AutomationEvaluation | undefined;
}

export class AutomationEventProjector {
  constructor(
    private readonly eventBus: EventBus,
    private readonly store: AutomationEventProjectorStoreDelegate,
    private readonly log?: (message: string) => void,
  ) {}

  emitDefinition(automation: AutomationDefinition): void {
    this.emitEvent({ type: 'automation.definition.updated', payload: automation });
    try {
      if (automation.originKind === 'scheduled-job') {
        this.emitEvent({
          type: 'scheduler.job.updated',
          payload: automationToScheduledJob(automation, latestAutomationRun(this.store.listRuns(automation.id))),
        });
      } else if (automation.originKind === 'automation-monitor') {
        const latest = latestFinishedEvaluation(this.store.listEvaluations(automation.id));
        this.emitEvent({
          type: 'automation.monitor.updated',
          payload: automationToMonitor(
            automation,
            latest,
            latestAutomationRun(this.store.listRuns(automation.id)),
            this.store.getLatestEvaluationWithState(automation.id),
          ),
        });
      }
    } catch (error) {
      this.reportDiagnostic('event-projection', normalizeAutomationError(error, 'Automation event projection failed: '));
    }
  }

  emitEvaluation(evaluation: AutomationEvaluation): void {
    this.emitEvent({ type: 'automation.evaluation.updated', payload: evaluation });
  }

  emitRun(run: AutomationRun): void {
    this.emitEvent({ type: 'automation.run.updated', payload: run });
    try {
      const automation = this.store.getAutomation(run.automationId);
      const evaluation = this.store.listEvaluations(run.automationId).find((candidate) => candidate.id === run.evaluationId);
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

  emitCompatibilityEvaluationRun(
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

  reportDiagnostic(phase: string, error: string): void {
    try {
      this.log?.(error);
    } catch {
      // Diagnostics must not destabilize automation lifecycle handling.
    }
    try {
      this.eventBus.emit({
        type: 'localcore.error',
        payload: { scope: 'automation-service', error, context: { phase } },
      });
    } catch {
      // Diagnostics must not destabilize automation lifecycle handling.
    }
  }

  buildProviderEventContext(
    automation: AutomationDefinition,
    event: AutomationMonitorEventSnapshot,
  ): EvaluationContext {
    const occurredAt = normalizeProviderEventTimestamp(event.occurredAt);
    const previousEvaluation = this.store.getLatestEvaluationWithState(automation.id);
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
      this.eventBus.emit(event);
    } catch (error) {
      this.reportDiagnostic('event-projection', normalizeAutomationError(error, 'Automation event projection failed: '));
    }
  }
}
