import type { AutomationDefinition, AutomationEvaluation, AutomationRun, AutomationScriptVersion } from '@cc/superai-contracts/automations';

export type AutomationDisplayStatus = 'active' | 'paused' | 'blocked';
export type AutomationOriginFilter = 'all' | 'native' | 'scheduled-job' | 'automation-monitor';
export type ScriptApprovalAction = 'authorize-test' | 'run-test' | 'request-enable' | 'approve-enable' | 'revoke';
export type ApprovalDecision = 'approved' | 'rejected';

export function deriveAutomationDisplayStatus(automation: Pick<AutomationDefinition, 'enabled' | 'health'>): AutomationDisplayStatus {
  if (automation.health === 'blocked') return 'blocked';
  return automation.enabled ? 'active' : 'paused';
}

export function filterAutomationRows(
  automations: AutomationDefinition[],
  filter: { origin?: AutomationOriginFilter; query?: string } = {},
) {
  const query = filter.query?.trim().toLocaleLowerCase() || '';
  return automations.filter((automation) => {
    const origin = automation.originKind || 'native';
    return (!filter.origin || filter.origin === 'all' || origin === filter.origin) &&
      (!query || `${automation.title} ${automation.workspaceId}`.toLocaleLowerCase().includes(query));
  });
}

/** The API exposes pending IDs only for transitions the server currently authorizes. */
export function approvalActionForVersion(version: Pick<AutomationScriptVersion, 'status' | 'pendingTestApprovalId' | 'pendingApprovalId'>): ScriptApprovalAction | null {
  switch (version.status) {
    case 'pending_test_approval': return version.pendingTestApprovalId ? 'authorize-test' : null;
    case 'test_authorized': return 'run-test';
    case 'tested': return 'request-enable';
    case 'pending_approval': return version.pendingApprovalId ? 'approve-enable' : null;
    case 'approved': return 'revoke';
    default: return null;
  }
}

/**
 * An Automation version endpoint applies a decision; it never makes one. Keep
 * the pending ID selected by the server and resolve that ApprovalRequest first.
 */
export function approvalResolutionForVersion(
  version: Pick<AutomationScriptVersion, 'status' | 'pendingTestApprovalId' | 'pendingApprovalId'>,
  decision: ApprovalDecision,
) {
  const approvalId = version.status === 'pending_test_approval'
    ? version.pendingTestApprovalId
    : version.status === 'pending_approval'
      ? version.pendingApprovalId
      : undefined;
  return approvalId ? { approvalId, decision } : null;
}

export function formatEvaluation(evaluation?: Pick<AutomationEvaluation, 'status'> & Partial<{
  conditionOutcome: string;
  triggerDecision: string;
  errorCategory: string;
}>) {
  if (!evaluation) return '—';
  if (evaluation.status === 'running') return 'Running';
  if (evaluation.errorCategory === 'sandbox_unavailable') return 'Blocked: sandbox unavailable';
  if (evaluation.conditionOutcome === 'error') return `Error${evaluation.errorCategory ? `: ${evaluation.errorCategory}` : ''}`;
  return `${evaluation.conditionOutcome || 'finished'} · ${evaluation.triggerDecision || 'not evaluated'}`;
}

export function formatRun(run?: Pick<AutomationRun, 'status' | 'deliveryStatus'>) {
  if (!run) return '—';
  return `${run.status}${run.deliveryStatus ? ` · ${run.deliveryStatus}` : ''}`;
}

/** Never expose full secret names in list/detail views. */
export function redactSecretName(reference: string) {
  const name = reference.replace(/^env:\/\//, '').trim();
  if (name.length < 7) return '***';
  return `${name.slice(0, 4)}…${name.slice(-4)}`;
}

export function originLabel(origin?: AutomationDefinition['originKind']) {
  if (origin === 'scheduled-job') return 'Cron';
  if (origin === 'automation-monitor') return 'Monitor';
  return 'Native';
}
