import type { KnowledgeBase } from '../../../packages/contracts/src';
import type { PendingPermissionRequest } from './thread-chat-permission';
import {
  isHiddenProgressMessage,
  isInteractivePermissionMessage,
  type PermissionCard,
} from './thread-chat-message-blocks';
import type { ChatMessage, ChatTaskState, ThreadGroup } from './thread-chat-model';

export type SelectedKnowledgeBaseSummary = Pick<KnowledgeBase, 'id' | 'name' | 'fileCount'>;

export function toSelectedKnowledgeBases(
  knowledgeBaseIds: string[],
  availableKnowledgeBases: KnowledgeBase[],
): SelectedKnowledgeBaseSummary[] {
  return knowledgeBaseIds.map((knowledgeBaseId) => {
    const matched = availableKnowledgeBases.find((base) => base.id === knowledgeBaseId);
    return {
      id: knowledgeBaseId,
      name: matched?.name || knowledgeBaseId,
      fileCount: matched?.fileCount || 0,
    };
  });
}

export function filterKnowledgeBases(knowledgeBases: KnowledgeBase[], search: string): KnowledgeBase[] {
  const query = search.trim().toLowerCase();
  if (!query) {
    return knowledgeBases;
  }
  return knowledgeBases.filter((base) =>
    [base.name, base.description, base.id].join(' ').toLowerCase().includes(query),
  );
}

export function orderKnowledgeBases(
  knowledgeBases: KnowledgeBase[],
  selectedKnowledgeBaseIds: string[],
): KnowledgeBase[] {
  const selectedIds = new Set(selectedKnowledgeBaseIds);
  return [...knowledgeBases].sort((a, b) => {
    const aSelected = selectedIds.has(a.id);
    const bSelected = selectedIds.has(b.id);
    if (aSelected !== bSelected) {
      return aSelected ? -1 : 1;
    }
    return a.name.localeCompare(b.name, 'zh-CN');
  });
}

export function getVisibleSessionGroups(sessionGroups: ThreadGroup[], selectedProject: string): ThreadGroup[] {
  if (!selectedProject) {
    return sessionGroups;
  }
  return sessionGroups.filter((group) => group.project === selectedProject);
}

export function getVisibleProjects(projects: string[], selectedProject: string): string[] {
  return selectedProject && !projects.includes(selectedProject) ? [selectedProject, ...projects] : projects;
}

export function hasVisibleSessions(sessionGroups: ThreadGroup[]): boolean {
  return sessionGroups.some((group) => group.sessions.length > 0);
}

export function toComposerPermissionCard(
  pendingPermissionRequest: PendingPermissionRequest | null,
): PermissionCard | null {
  if (!pendingPermissionRequest) {
    return null;
  }
  return {
    id: pendingPermissionRequest.id,
    content: pendingPermissionRequest.content,
    actions: pendingPermissionRequest.actions,
    actionReplyCtx: pendingPermissionRequest.actionReplyCtx,
    actionPending: pendingPermissionRequest.actionPending,
    actionStatus: pendingPermissionRequest.actionStatus,
    actionMode: 'permission',
    actionInteractive: true,
  };
}

export function shouldRenderThreadChatMessage(
  message: ChatMessage,
  composerPermissionCard: PermissionCard | null,
): boolean {
  if (message.kind === 'progress' && isHiddenProgressMessage(message.content)) {
    return false;
  }
  return !isInteractivePermissionMessage(message, composerPermissionCard);
}

export function getComposerPlaceholder(input: {
  serviceRunning: boolean;
  transportReady: boolean;
  taskState: ChatTaskState;
  taskInputLocked: boolean;
  startFirstPlaceholder: string;
  waitingRuntimePlaceholder: string;
  sendPlaceholder: string;
}): string {
  if (!input.serviceRunning) {
    return input.startFirstPlaceholder;
  }
  if (!input.transportReady) {
    return input.waitingRuntimePlaceholder;
  }
  if (input.taskState === 'awaiting_input') {
    return 'Agent 正在等待你的回复，可直接继续输入。';
  }
  if (input.taskInputLocked) {
    return '任务正在运行，点击停止可中断当前执行。';
  }
  return input.sendPlaceholder;
}

export function canSubmitComposer(input: {
  draft: string;
  serviceRunning: boolean;
  transportReady: boolean;
  sending: boolean;
  selectedProject: string;
}): boolean {
  return Boolean(
    input.draft.trim() &&
      input.serviceRunning &&
      input.transportReady &&
      !input.sending &&
      input.selectedProject,
  );
}
