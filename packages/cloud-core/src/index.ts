import path from 'node:path';

export type CloudTaskStatus =
  | 'created'
  | 'accepted'
  | 'input_syncing'
  | 'input_synced'
  | 'sandbox_creating'
  | 'sandbox_created'
  | 'running'
  | 'output_syncing'
  | 'output_synced'
  | 'succeeded'
  | 'failed'
  | 'cancelling'
  | 'cancelled'
  | 'timeout';

export interface CloudTaskRecord {
  taskId: string;
  runId: string;
  threadId: string;
  workspaceId: string;
  sessionId: string;
  agentId: string;
  status: CloudTaskStatus;
  sandboxId?: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  errorCode?: string;
  error?: string;
}

export type AgentDockCloudEvent =
  | { type: 'task.created'; task: CloudTaskRecord }
  | { type: 'task.accepted'; task: CloudTaskRecord }
  | { type: 'workspace.input_syncing'; taskId: string; runId: string; threadId: string; workspaceId: string; timestamp: string }
  | { type: 'workspace.input_synced'; taskId: string; runId: string; threadId: string; workspaceId: string; timestamp: string }
  | { type: 'sandbox.creating'; taskId: string; runId: string; threadId: string; workspaceId: string; timestamp: string }
  | { type: 'sandbox.created'; taskId: string; runId: string; threadId: string; workspaceId: string; sandboxId: string; timestamp: string }
  | { type: 'task.started'; taskId: string; runId: string; threadId: string; workspaceId: string; timestamp: string }
  | { type: 'assistant.delta'; taskId: string; runId: string; threadId: string; content: string; timestamp: string }
  | { type: 'assistant.message'; taskId: string; runId: string; threadId: string; content: string; timestamp: string }
  | { type: 'workspace.output_syncing'; taskId: string; runId: string; threadId: string; workspaceId: string; timestamp: string }
  | { type: 'workspace.output_synced'; taskId: string; runId: string; threadId: string; workspaceId: string; fileCount: number; timestamp: string }
  | { type: 'task.succeeded'; taskId: string; runId: string; threadId: string; workspaceId: string; timestamp: string }
  | { type: 'task.cancelling'; taskId: string; runId: string; threadId: string; workspaceId: string; timestamp: string }
  | { type: 'task.failed'; taskId: string; runId: string; threadId: string; workspaceId: string; error: string; errorCode?: string; timestamp: string }
  | { type: 'task.cancelled'; taskId: string; runId: string; threadId: string; workspaceId: string; timestamp: string };

export interface AgentDockCloudEventEnvelope {
  eventId: string;
  type: AgentDockCloudEvent['type'];
  taskId?: string;
  runId?: string;
  seq: number;
  createdAt: string;
  source: {
    service: 'agentdock-cloud';
    instanceId: string;
    sandboxId?: string;
    agentId?: string;
    runtimeImage?: string;
  };
  event: AgentDockCloudEvent;
}

export interface SandboxMount {
  hostPath: string;
  containerPath: string;
  readonly?: boolean;
}

export interface SandboxRunRequest {
  taskId: string;
  workspaceId: string;
  threadId: string;
  sessionId: string;
  image: string;
  command: string[];
  env: Record<string, string>;
  mounts: SandboxMount[];
}

export type SandboxRunEvent =
  | { type: 'sandbox_created'; sandboxId: string }
  | { type: 'stdout'; data: string }
  | { type: 'stderr'; data: string }
  | { type: 'exit'; code: number };

export interface SandboxProvider {
  run(request: SandboxRunRequest, onEvent: (event: SandboxRunEvent) => void | Promise<void>): Promise<void>;
  cancel(taskId: string): Promise<boolean>;
}

export const AGENTDOCK_EVENT_PREFIX = '__AGENTDOCK_EVENT__ ';

export function encodeRuntimeEvent(event: AgentDockCloudEvent): string {
  return `${AGENTDOCK_EVENT_PREFIX}${JSON.stringify(event)}`;
}

export function parseRuntimeEventLine(line: string): AgentDockCloudEvent | null {
  if (!line.startsWith(AGENTDOCK_EVENT_PREFIX)) {
    return null;
  }
  const parsed = JSON.parse(line.slice(AGENTDOCK_EVENT_PREFIX.length)) as AgentDockCloudEvent;
  if (!parsed || typeof parsed.type !== 'string') {
    return null;
  }
  return parsed;
}

export function toLocalCoreEventName(type: AgentDockCloudEvent['type']) {
  switch (type) {
    case 'task.created':
    case 'task.accepted':
    case 'workspace.input_syncing':
    case 'workspace.input_synced':
    case 'sandbox.creating':
    case 'sandbox.created':
    case 'task.started':
    case 'workspace.output_syncing':
    case 'workspace.output_synced':
    case 'task.succeeded':
    case 'task.cancelling':
    case 'task.failed':
    case 'task.cancelled':
      return 'run.updated';
    case 'assistant.delta':
      return 'message.updated';
    case 'assistant.message':
      return 'message.created';
  }
}

export function tagForCloudEventType(type: AgentDockCloudEvent['type']) {
  const prefix = type.split('.')[0] || 'runtime';
  if (prefix === 'task' || prefix === 'sandbox' || prefix === 'workspace') {
    return prefix;
  }
  if (prefix === 'assistant') {
    return 'agent';
  }
  return 'runtime';
}

export function ensureChildPath(root: string, candidate: string) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return resolvedCandidate;
  }
  throw new Error(`Path escapes storage root: ${candidate}`);
}

export function buildWorkspacePath(root: string, tenantId: string, userId: string, workspaceId: string) {
  return ensureChildPath(root, path.join(root, 'workspaces', 'tenant', tenantId, 'user', userId, 'workspace', workspaceId, 'workdir'));
}

export function buildTaskRuntimePath(root: string, taskId: string) {
  return ensureChildPath(root, path.join(root, 'runtime', 'tasks', taskId));
}

export function buildSessionOutputPath(root: string, sessionId: string) {
  return ensureChildPath(root, path.join(root, 'runtime', 'sessions', sessionId, 'output'));
}
