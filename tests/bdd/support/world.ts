/**
 * Per-scenario state shared across Given/When/Then steps.
 * Cucumber constructs a fresh World for each scenario, so fields start at
 * their defaults every time — no manual reset hook is required.
 */
import { setWorldConstructor, World, type IWorldOptions } from '@cucumber/cucumber';
import type { TriggerDecision } from '../../../services/local-ai-core/src/automation/automation-condition-engine.js';
import type {
  ConditionDecision,
  ConditionEvaluation,
} from '../../../services/local-ai-core/src/automation/automation-condition-engine.js';
import type { AutomationActivation, AutomationCondition } from '@cc/superai-contracts';

export class BddWorld extends World {
  // --- automation-trigger state ---
  previous: boolean | undefined = undefined;
  matched = false;
  coolingDown = false;
  actionRunning = false;
  triggerDecision?: TriggerDecision;

  // --- cron / activation state ---
  activation?: AutomationActivation;
  resultDate?: Date | null;
  resultDue?: boolean;
  threw?: Error;

  // --- condition-evaluation state ---
  condition?: AutomationCondition;
  payload: Record<string, unknown> = {};
  evaluation?: ConditionEvaluation;
  decision?: ConditionDecision;
  evaluatorCalls = 0;
  evaluationRunning = false;

  // --- thread task-state mapping state ---
  controllerStatus?: string;
  inputTaskState?: string;
  derivedTaskState?: string;
  controllerActionType?: string;

  // --- chat event gate state ---
  gate?: {
    acceptBridgeEvent: (event: unknown, context: unknown) => boolean;
    acceptCoreEvent: (event: unknown) => boolean;
  };
  activeRunId?: string;
  pendingTurn?: { sessionKey: string; runId?: string; supersededRunId?: string };

  // --- generic result scratch (reused by permission / text-utils features) ---
  boolResult?: boolean;
  stringResult?: string;
  stringList?: string[];
  objectResult?: unknown;
  rendered?: Record<string, unknown>;

  constructor(options: IWorldOptions) {
    super(options);
  }
}

setWorldConstructor(BddWorld);
