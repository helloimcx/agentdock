/**
 * Business deadline for background agent work started by schedulers,
 * automations, and monitors. All equivalent entry points must share this
 * value so moving work between orchestration paths does not change behavior.
 */
export const BACKGROUND_AGENT_EXECUTION_TIMEOUT_MS = 60 * 60 * 1_000;

/**
 * Protocol safety ceiling for one ACP session/prompt request. This is
 * intentionally longer than the business deadline: callers should interrupt
 * timed-out background work, while this limit protects orphaned requests.
 */
export const ACP_PROMPT_TIMEOUT_MS = 180 * 60 * 1_000;
