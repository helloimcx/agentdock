import { normalizePermissionOptionAction } from './workspace-acp-permissions.js';
import type { AcpSessionState, RunningPermissionRequest } from '../router/workspace-router-types.js';

type RunningToolCall = NonNullable<NonNullable<AcpSessionState['currentTurn']>['pendingToolCalls']>[string];

export type PermissionApprovalInput = {
  threadId: string;
  runId: string;
  title: string;
  description: string;
  command?: string;
  options: RunningPermissionRequest['options'];
};

export function parsePermissionOptions(options: unknown): RunningPermissionRequest['options'] {
  return Array.isArray(options)
    ? options
        .map((option: any) => ({
          optionId: String(option?.optionId || '').trim(),
          name: String(option?.name || option?.optionId || '').trim(),
          kind: String(option?.kind || '').trim(),
          normalizedAction: normalizePermissionOptionAction({
            optionId: option?.optionId,
            name: option?.name,
            kind: option?.kind,
          }),
        }))
        .filter((option: { optionId: string }) => option.optionId)
    : [];
}

export function createRunningPermissionRequest(input: {
  requestId: number | string;
  toolTitle: string;
  options: RunningPermissionRequest['options'];
  approvalId?: string;
}): RunningPermissionRequest {
  return {
    requestId: input.requestId,
    toolTitle: input.toolTitle,
    isSchedulerAdd: isSchedulerAddCommand(input.toolTitle),
    options: input.options,
    ...(input.approvalId ? { approvalId: input.approvalId } : {}),
  };
}

export function createPermissionApprovalInput(input: {
  threadId: string;
  runId: string;
  toolTitle: string;
  options: RunningPermissionRequest['options'];
}): PermissionApprovalInput {
  return {
    threadId: input.threadId,
    runId: input.runId,
    title: input.toolTitle ? `Approve ${input.toolTitle}` : 'Approve agent action',
    description: input.toolTitle || 'Agent requested permission before continuing.',
    command: input.toolTitle,
    options: input.options,
  };
}

export function createPermissionPrompt(toolTitle: string) {
  return [
    '等待工具确认',
    '',
    toolTitle,
    '',
    '请选择一个选项继续执行。',
    '',
    '若按钮没有显示，请直接回复：allow all / allow / deny',
  ].join('\n');
}

export function applyPendingPermissionRequest(input: {
  session: AcpSessionState;
  runId: string;
  permissionRequest: RunningPermissionRequest;
  resolveFallbackToolCall: (currentTurn: NonNullable<AcpSessionState['currentTurn']>) => RunningToolCall | undefined;
  syncLegacyPendingToolCall: (
    currentTurn: NonNullable<AcpSessionState['currentTurn']>,
    toolCall?: RunningToolCall,
  ) => void;
}) {
  input.session.pendingPermissionByRun.set(input.runId, input.permissionRequest);
  const currentTurn = input.session.currentTurn;
  if (!currentTurn) {
    return;
  }
  currentTurn.permission = input.permissionRequest;
  const toolTitle = input.permissionRequest.toolTitle;
  if (!toolTitle || toolTitle === 'Permission required before continuing.') {
    return;
  }
  currentTurn.pendingToolCallDetail = toolTitle;
  const toolCall = input.resolveFallbackToolCall(currentTurn);
  if (toolCall) {
    toolCall.detail = toolTitle;
    input.syncLegacyPendingToolCall(currentTurn, toolCall);
  }
}

export function isSchedulerAddCommand(value: unknown) {
  return /\blac\s+scheduler\s+add\b/.test(String(value || ''));
}
