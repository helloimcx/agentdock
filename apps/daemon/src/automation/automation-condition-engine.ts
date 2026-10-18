import type {
  AutomationCondition,
  AutomationEvaluationFinishInput,
} from '@cc/superai-contracts';
import { evaluateRestrictedExpression } from './condition-evaluator.js';

type EvaluationResultFor<Outcome extends AutomationEvaluationFinishInput['conditionOutcome']> = Pick<
  Extract<AutomationEvaluationFinishInput, { conditionOutcome: Outcome }>,
  'conditionOutcome' | 'triggerDecision'
>;
type MatchedEvaluationResult = EvaluationResultFor<'matched'>;
type NotMatchedEvaluationResult = EvaluationResultFor<'not_matched'>;
type ErrorEvaluationResult = EvaluationResultFor<'error'> & { error: string };
type ConcurrentSkippedEvaluationResult = Omit<EvaluationResultFor<'skipped'>, 'triggerDecision'> & {
  triggerDecision: Extract<EvaluationResultFor<'skipped'>['triggerDecision'], 'skipped_concurrent'>;
};

export type TriggerDecision =
  | (MatchedEvaluationResult & { nextMatch: true })
  | (NotMatchedEvaluationResult & { nextMatch: false });

export type ConditionEvaluation =
  | { kind: 'evaluated'; matched: boolean }
  | {
      kind: 'script-delegation';
      request: {
        scriptId: string;
        approvedVersionId: string;
        edge: 'rising';
        payload: Record<string, unknown>;
      };
    };

export type ConditionDecision =
  | ({
      kind: 'decision';
      nextMatch: boolean | undefined;
      error?: string;
    } & (
      | MatchedEvaluationResult
      | NotMatchedEvaluationResult
      | ErrorEvaluationResult
      | ConcurrentSkippedEvaluationResult
    ))
  | Extract<ConditionEvaluation, { kind: 'script-delegation' }>;

export interface DecideTriggerInput {
  previous: boolean | undefined;
  matched: boolean;
  coolingDown?: boolean;
  actionRunning?: boolean;
}

export interface DecideConditionInput {
  condition: AutomationCondition;
  payload?: Record<string, unknown>;
  previous: boolean | undefined;
  evaluationRunning?: boolean;
  coolingDown?: boolean;
  actionRunning?: boolean;
}

export type EvaluationAdmission =
  | { admitted: true }
  | ({ admitted: false } & ConcurrentSkippedEvaluationResult);

export function admitConditionEvaluation(evaluationRunning: boolean): EvaluationAdmission {
  return evaluationRunning
    ? { admitted: false, conditionOutcome: 'skipped', triggerDecision: 'skipped_concurrent' }
    : { admitted: true };
}

export function decideTrigger(input: DecideTriggerInput): TriggerDecision {
  if (!input.matched) {
    return { conditionOutcome: 'not_matched', triggerDecision: 'not_rising', nextMatch: false };
  }
  if (input.previous === true) {
    return { conditionOutcome: 'matched', triggerDecision: 'not_rising', nextMatch: true };
  }
  if (input.coolingDown) {
    return { conditionOutcome: 'matched', triggerDecision: 'skipped_cooldown', nextMatch: true };
  }
  if (input.actionRunning) {
    return { conditionOutcome: 'matched', triggerDecision: 'skipped_action_running', nextMatch: true };
  }
  return { conditionOutcome: 'matched', triggerDecision: 'triggered', nextMatch: true };
}

export function evaluateCondition(
  condition: AutomationCondition,
  payload: Record<string, unknown> = {},
): ConditionEvaluation {
  switch (condition.kind) {
    case 'always':
      return { kind: 'evaluated', matched: true };
    case 'expression':
      return { kind: 'evaluated', matched: evaluateRestrictedExpression(condition.expression, payload) };
    case 'approved-script':
      return {
        kind: 'script-delegation',
        request: {
          scriptId: condition.scriptId,
          approvedVersionId: condition.approvedVersionId,
          edge: condition.edge,
          payload,
        },
      };
  }
}

export function decideCondition(
  input: DecideConditionInput,
  evaluator: typeof evaluateCondition = evaluateCondition,
): ConditionDecision {
  const admission = admitConditionEvaluation(input.evaluationRunning === true);
  if (!admission.admitted) {
    return {
      kind: 'decision',
      conditionOutcome: admission.conditionOutcome,
      triggerDecision: admission.triggerDecision,
      nextMatch: input.previous,
    };
  }
  try {
    const evaluation = evaluator(input.condition, input.payload);
    if (evaluation.kind === 'script-delegation') return evaluation;
    return {
      kind: 'decision',
      ...decideTrigger({
        previous: input.previous,
        matched: evaluation.matched,
        coolingDown: input.coolingDown,
        actionRunning: input.actionRunning,
      }),
    };
  } catch (error) {
    return {
      kind: 'decision',
      conditionOutcome: 'error',
      triggerDecision: 'not_evaluated',
      nextMatch: input.previous,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
