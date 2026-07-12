import type {
  AutomationCreateInput,
  AutomationDefinition,
  AutomationEvaluation,
  AutomationRun,
  AutomationScript,
  AutomationScriptCreateInput,
  AutomationScriptUpdateInput,
  AutomationScriptVersion,
  AutomationUpdateInput,
} from '@cc/superai-contracts/automations';
import type { ApprovalRequest } from '@cc/superai-contracts';
import { buildQuery, coreRequest } from './request.js';

function scoped(path: string, workspaceId: string) {
  return `${path}${buildQuery({ workspace_id: workspaceId })}`;
}

export function listAutomations(workspaceId: string) {
  return coreRequest<{ automations: AutomationDefinition[] }>('GET', scoped('/automations', workspaceId));
}

export function createAutomation(input: AutomationCreateInput) {
  return coreRequest<AutomationDefinition>('POST', '/automations', input);
}

export function getAutomation(automationId: string, workspaceId: string) {
  return coreRequest<AutomationDefinition>('GET', scoped(`/automations/${encodeURIComponent(automationId)}`, workspaceId));
}

export function updateAutomation(automationId: string, workspaceId: string, input: AutomationUpdateInput) {
  return coreRequest<AutomationDefinition>('PATCH', scoped(`/automations/${encodeURIComponent(automationId)}`, workspaceId), input);
}

export function deleteAutomation(automationId: string, workspaceId: string) {
  return coreRequest<{ deleted: boolean }>('DELETE', scoped(`/automations/${encodeURIComponent(automationId)}`, workspaceId));
}

export function checkAutomation(automationId: string, workspaceId: string) {
  return coreRequest<AutomationEvaluation>('POST', scoped(`/automations/${encodeURIComponent(automationId)}/check`, workspaceId));
}

export function listAutomationEvaluations(automationId: string, workspaceId: string) {
  return coreRequest<{ evaluations: AutomationEvaluation[] }>('GET', scoped(`/automations/${encodeURIComponent(automationId)}/evaluations`, workspaceId));
}

export function listAutomationRuns(automationId: string, workspaceId: string) {
  return coreRequest<{ runs: AutomationRun[] }>('GET', scoped(`/automations/${encodeURIComponent(automationId)}/runs`, workspaceId));
}

export function listAutomationScripts(workspaceId: string) {
  return coreRequest<{ scripts: AutomationScript[] }>('GET', scoped('/automation-scripts', workspaceId));
}

export function createAutomationScript(input: AutomationScriptCreateInput) {
  return coreRequest<AutomationScript>('POST', '/automation-scripts', input);
}

export function getAutomationScript(scriptId: string, workspaceId: string) {
  return coreRequest<AutomationScript>('GET', scoped(`/automation-scripts/${encodeURIComponent(scriptId)}`, workspaceId));
}

export function updateAutomationScript(scriptId: string, workspaceId: string, input: AutomationScriptUpdateInput) {
  return coreRequest<AutomationScript>('PATCH', scoped(`/automation-scripts/${encodeURIComponent(scriptId)}`, workspaceId), input);
}

export function listAutomationScriptVersions(scriptId: string, workspaceId: string) {
  return coreRequest<{ versions: AutomationScriptVersion[] }>('GET', scoped(`/automation-scripts/${encodeURIComponent(scriptId)}/versions`, workspaceId));
}

export function requestAutomationScriptTestApproval(versionId: string, workspaceId: string, actor: string) {
  return coreRequest<ApprovalRequest>('POST', scoped(`/automation-scripts/versions/${encodeURIComponent(versionId)}/test-approval`, workspaceId), { actor });
}

export function executeAutomationScriptTest(versionId: string, workspaceId: string, actor: string) {
  return coreRequest<AutomationScriptVersion>('POST', scoped(`/automation-scripts/versions/${encodeURIComponent(versionId)}/test`, workspaceId), { actor });
}

export function requestAutomationScriptEnableApproval(versionId: string, workspaceId: string, actor: string) {
  return coreRequest<ApprovalRequest>('POST', scoped(`/automation-scripts/versions/${encodeURIComponent(versionId)}/enable-approval`, workspaceId), { actor });
}

export function approveAutomationScriptVersion(versionId: string, workspaceId: string, approvalId: string, actor: string) {
  return coreRequest<AutomationScriptVersion>('POST', scoped(`/automation-scripts/versions/${encodeURIComponent(versionId)}/approve`, workspaceId), { approvalId, actor });
}

export function rejectAutomationScriptVersion(versionId: string, workspaceId: string, approvalId: string, actor: string) {
  return coreRequest<AutomationScriptVersion>('POST', scoped(`/automation-scripts/versions/${encodeURIComponent(versionId)}/reject`, workspaceId), { approvalId, actor });
}

export function revokeAutomationScriptVersion(versionId: string, workspaceId: string, actor: string) {
  return coreRequest<AutomationScriptVersion>('POST', scoped(`/automation-scripts/versions/${encodeURIComponent(versionId)}/revoke`, workspaceId), { actor });
}
