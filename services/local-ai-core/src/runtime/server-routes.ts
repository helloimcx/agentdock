export type LocalAiCoreRoute =
  | { name: 'health' }
  | { name: 'runtime.status' }
  | { name: 'runtime.service.start' }
  | { name: 'runtime.service.stop' }
  | { name: 'runtime.service.restart' }
  | { name: 'runtime.logs' }
  | { name: 'runtime.agent-runtimes' }
  | { name: 'runtime.config.read' }
  | { name: 'runtime.config.save-raw' }
  | { name: 'runtime.config.save-structured' }
  | { name: 'runtime.settings.save' }
  | { name: 'runtimes.list' }
  | { name: 'runtimes.detail'; runtimeId: string }
  | { name: 'runtimes.refresh' }
  | { name: 'runtimes.refresh-one'; runtimeId: string }
  | { name: 'scheduler.jobs.list' }
  | { name: 'scheduler.jobs.create' }
  | { name: 'scheduler.job.get'; jobId: string }
  | { name: 'scheduler.job.runs'; jobId: string }
  | { name: 'scheduler.job.run'; jobId: string }
  | { name: 'scheduler.job.update'; jobId: string }
  | { name: 'scheduler.job.delete'; jobId: string }
  | { name: 'threads.list' }
  | { name: 'threads.create' }
  | { name: 'thread.get'; threadId: string }
  | { name: 'thread.rename'; threadId: string }
  | { name: 'thread.update-knowledge-bases'; threadId: string }
  | { name: 'thread.delete'; threadId: string }
  | { name: 'thread.messages.send'; threadId: string }
  | { name: 'thread.actions.send'; threadId: string }
  | { name: 'run.interrupt'; runId: string }
  | { name: 'workspaces.list' }
  | { name: 'workspace-registry.list' }
  | { name: 'workspace-registry.create' }
  | { name: 'workspace-registry.get'; workspaceId: string }
  | { name: 'workspace-registry.update'; workspaceId: string }
  | { name: 'workspace-registry.delete'; workspaceId: string }
  | { name: 'workspace-security.get'; workspaceId: string }
  | { name: 'workspace-security.update'; workspaceId: string }
  | { name: 'security.command-risk.classify' }
  | { name: 'approvals.list' }
  | { name: 'approvals.create' }
  | { name: 'approval.get'; approvalId: string }
  | { name: 'approval.resolve'; approvalId: string }
  | { name: 'audit-events.list' }
  | { name: 'tasks.list' }
  | { name: 'tasks.create' }
  | { name: 'task.get'; taskId: string }
  | { name: 'task.update'; taskId: string };

const API_PREFIX = '/api/local/v1';

export function parseLocalAiCoreRoute(method: string | undefined, path: string): LocalAiCoreRoute | null {
  const normalizedMethod = String(method || '').toUpperCase();
  const relativePath = path.startsWith(API_PREFIX) ? path.slice(API_PREFIX.length) || '/' : path;

  if (normalizedMethod === 'GET' && relativePath === '/health') {
    return { name: 'health' };
  }
  if (normalizedMethod === 'GET' && relativePath === '/runtime') {
    return { name: 'runtime.status' };
  }
  if (normalizedMethod === 'POST' && relativePath === '/runtime/service/start') {
    return { name: 'runtime.service.start' };
  }
  if (normalizedMethod === 'POST' && relativePath === '/runtime/service/stop') {
    return { name: 'runtime.service.stop' };
  }
  if (normalizedMethod === 'POST' && relativePath === '/runtime/service/restart') {
    return { name: 'runtime.service.restart' };
  }
  if (normalizedMethod === 'GET' && relativePath === '/runtime/logs') {
    return { name: 'runtime.logs' };
  }
  if (normalizedMethod === 'GET' && relativePath === '/runtime/agent-runtimes') {
    return { name: 'runtime.agent-runtimes' };
  }
  if (normalizedMethod === 'GET' && relativePath === '/runtime/config') {
    return { name: 'runtime.config.read' };
  }
  if (normalizedMethod === 'POST' && relativePath === '/runtime/config/raw') {
    return { name: 'runtime.config.save-raw' };
  }
  if (normalizedMethod === 'POST' && relativePath === '/runtime/config/structured') {
    return { name: 'runtime.config.save-structured' };
  }
  if (normalizedMethod === 'POST' && relativePath === '/runtime/settings') {
    return { name: 'runtime.settings.save' };
  }

  const segments = splitRouteSegments(relativePath);
  if (segments[0] === 'runtimes') {
    return parseRuntimesRoute(normalizedMethod, segments);
  }
  if (segments[0] === 'scheduler' && segments[1] === 'jobs') {
    return parseSchedulerJobsRoute(normalizedMethod, segments);
  }
  if (segments[0] === 'threads') {
    return parseThreadsRoute(normalizedMethod, segments);
  }
  if (segments[0] === 'runs') {
    return parseRunsRoute(normalizedMethod, segments);
  }
  if (segments[0] === 'workspaces') {
    return parseWorkspacesRoute(normalizedMethod, segments);
  }
  if (segments[0] === 'workspace-registry') {
    return parseWorkspaceRegistryRoute(normalizedMethod, segments);
  }
  if (segments[0] === 'workspace-security') {
    return parseWorkspaceSecurityRoute(normalizedMethod, segments);
  }
  if (segments[0] === 'security') {
    return parseSecurityRoute(normalizedMethod, segments);
  }
  if (segments[0] === 'approvals') {
    return parseApprovalsRoute(normalizedMethod, segments);
  }
  if (segments[0] === 'audit-events') {
    return parseAuditEventsRoute(normalizedMethod, segments);
  }
  if (segments[0] === 'tasks') {
    return parseTasksRoute(normalizedMethod, segments);
  }

  return null;
}

function parseRuntimesRoute(method: string, segments: string[]): LocalAiCoreRoute | null {
  if (method === 'GET' && segments.length === 1) {
    return { name: 'runtimes.list' };
  }
  if (method === 'POST' && segments.length === 2 && segments[1] === 'refresh') {
    return { name: 'runtimes.refresh' };
  }
  if (method === 'GET' && segments.length === 2) {
    return { name: 'runtimes.detail', runtimeId: decodeURIComponent(segments[1] || '') };
  }
  if (method === 'POST' && segments.length === 3 && segments[2] === 'refresh') {
    return { name: 'runtimes.refresh-one', runtimeId: decodeURIComponent(segments[1] || '') };
  }
  return null;
}

function parseSchedulerJobsRoute(method: string, segments: string[]): LocalAiCoreRoute | null {
  if (method === 'GET' && segments.length === 2) {
    return { name: 'scheduler.jobs.list' };
  }
  if (method === 'POST' && segments.length === 2) {
    return { name: 'scheduler.jobs.create' };
  }
  const jobId = segments.length >= 3 ? decodeURIComponent(segments[2] || '') : '';
  if (!jobId) {
    return null;
  }
  if (method === 'GET' && segments.length === 3) {
    return { name: 'scheduler.job.get', jobId };
  }
  if (method === 'GET' && segments.length === 4 && segments[3] === 'runs') {
    return { name: 'scheduler.job.runs', jobId };
  }
  if (method === 'POST' && segments.length === 4 && segments[3] === 'run') {
    return { name: 'scheduler.job.run', jobId };
  }
  if (method === 'PATCH' && segments.length === 3) {
    return { name: 'scheduler.job.update', jobId };
  }
  if (method === 'DELETE' && segments.length === 3) {
    return { name: 'scheduler.job.delete', jobId };
  }
  return null;
}

function parseThreadsRoute(method: string, segments: string[]): LocalAiCoreRoute | null {
  if (method === 'GET' && segments.length === 1) {
    return { name: 'threads.list' };
  }
  if (method === 'POST' && segments.length === 1) {
    return { name: 'threads.create' };
  }
  const threadId = segments.length >= 2 ? decodeURIComponent(segments[1] || '') : '';
  if (!threadId) {
    return null;
  }
  if (method === 'GET' && segments.length === 2) {
    return { name: 'thread.get', threadId };
  }
  if (method === 'PATCH' && segments.length === 2) {
    return { name: 'thread.rename', threadId };
  }
  if (method === 'DELETE' && segments.length === 2) {
    return { name: 'thread.delete', threadId };
  }
  if (method === 'PATCH' && segments.length === 3 && segments[2] === 'knowledge-bases') {
    return { name: 'thread.update-knowledge-bases', threadId };
  }
  if (method === 'POST' && segments.length === 3 && segments[2] === 'messages') {
    return { name: 'thread.messages.send', threadId };
  }
  if (method === 'POST' && segments.length === 3 && segments[2] === 'actions') {
    return { name: 'thread.actions.send', threadId };
  }
  return null;
}

function parseRunsRoute(method: string, segments: string[]): LocalAiCoreRoute | null {
  const runId = segments.length >= 2 ? decodeURIComponent(segments[1] || '') : '';
  if (method === 'POST' && runId && segments.length === 3 && segments[2] === 'interrupt') {
    return { name: 'run.interrupt', runId };
  }
  return null;
}

function parseWorkspacesRoute(method: string, segments: string[]): LocalAiCoreRoute | null {
  if (method === 'GET' && segments.length === 1) {
    return { name: 'workspaces.list' };
  }
  return null;
}

function parseWorkspaceRegistryRoute(method: string, segments: string[]): LocalAiCoreRoute | null {
  if (method === 'GET' && segments.length === 1) {
    return { name: 'workspace-registry.list' };
  }
  if (method === 'POST' && segments.length === 1) {
    return { name: 'workspace-registry.create' };
  }
  const workspaceId = segments.length >= 2 ? decodeURIComponent(segments[1] || '') : '';
  if (!workspaceId || segments.length !== 2) {
    return null;
  }
  if (method === 'GET') {
    return { name: 'workspace-registry.get', workspaceId };
  }
  if (method === 'PATCH') {
    return { name: 'workspace-registry.update', workspaceId };
  }
  if (method === 'DELETE') {
    return { name: 'workspace-registry.delete', workspaceId };
  }
  return null;
}

function parseWorkspaceSecurityRoute(method: string, segments: string[]): LocalAiCoreRoute | null {
  const workspaceId = segments.length >= 2 ? decodeURIComponent(segments[1] || '') : '';
  if (!workspaceId || segments.length !== 2) {
    return null;
  }
  if (method === 'GET') {
    return { name: 'workspace-security.get', workspaceId };
  }
  if (method === 'PATCH') {
    return { name: 'workspace-security.update', workspaceId };
  }
  return null;
}

function parseSecurityRoute(method: string, segments: string[]): LocalAiCoreRoute | null {
  if (method === 'POST' && segments.length === 2 && segments[1] === 'command-risk') {
    return { name: 'security.command-risk.classify' };
  }
  return null;
}

function parseApprovalsRoute(method: string, segments: string[]): LocalAiCoreRoute | null {
  if (method === 'GET' && segments.length === 1) {
    return { name: 'approvals.list' };
  }
  if (method === 'POST' && segments.length === 1) {
    return { name: 'approvals.create' };
  }
  const approvalId = segments.length >= 2 ? decodeURIComponent(segments[1] || '') : '';
  if (!approvalId) {
    return null;
  }
  if (method === 'GET' && segments.length === 2) {
    return { name: 'approval.get', approvalId };
  }
  if (method === 'POST' && segments.length === 3 && segments[2] === 'resolve') {
    return { name: 'approval.resolve', approvalId };
  }
  return null;
}

function parseAuditEventsRoute(method: string, segments: string[]): LocalAiCoreRoute | null {
  if (method === 'GET' && segments.length === 1) {
    return { name: 'audit-events.list' };
  }
  return null;
}

function parseTasksRoute(method: string, segments: string[]): LocalAiCoreRoute | null {
  if (method === 'GET' && segments.length === 1) {
    return { name: 'tasks.list' };
  }
  if (method === 'POST' && segments.length === 1) {
    return { name: 'tasks.create' };
  }
  const taskId = segments.length >= 2 ? decodeURIComponent(segments[1] || '') : '';
  if (!taskId || segments.length !== 2) {
    return null;
  }
  if (method === 'GET') {
    return { name: 'task.get', taskId };
  }
  if (method === 'PATCH') {
    return { name: 'task.update', taskId };
  }
  return null;
}

function splitRouteSegments(path: string) {
  return path.split('/').filter(Boolean);
}
