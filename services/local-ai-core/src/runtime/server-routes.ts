export type LocalAiCoreRoute =
  | { name: 'health' }
  | { name: 'runtime.status' }
  | { name: 'runtime.service.start' }
  | { name: 'runtime.service.stop' }
  | { name: 'runtime.service.restart' }
  | { name: 'runtime.logs' }
  | { name: 'logs.list' }
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
  | { name: 'automation.monitors.list' }
  | { name: 'automation.monitors.create' }
  | { name: 'automation.monitor.get'; monitorId: string }
  | { name: 'automation.monitor.runs'; monitorId: string }
  | { name: 'automation.monitor.run'; monitorId: string }
  | { name: 'automation.monitor.update'; monitorId: string }
  | { name: 'automation.monitor.delete'; monitorId: string }
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
  | { name: 'providers.list' }
  | { name: 'providers.create' }
  | { name: 'provider.update'; providerId: string }
  | { name: 'provider.delete'; providerId: string }
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
  | { name: 'task.update'; taskId: string }
  | { name: 'knowledge.sources.list' }
  | { name: 'knowledge.config.read' }
  | { name: 'knowledge.config.update' }
  | { name: 'knowledge.folders.list' }
  | { name: 'knowledge.folders.create' }
  | { name: 'knowledge.folder.update'; folderId: string }
  | { name: 'knowledge.folder.delete'; folderId: string }
  | { name: 'knowledge.bases.list' }
  | { name: 'knowledge.bases.create' }
  | { name: 'knowledge.base.get'; knowledgeBaseId: string }
  | { name: 'knowledge.base.update'; knowledgeBaseId: string }
  | { name: 'knowledge.base.delete'; knowledgeBaseId: string }
  | { name: 'knowledge.base.files.list'; knowledgeBaseId: string }
  | { name: 'knowledge.base.files.upload'; knowledgeBaseId: string }
  | { name: 'knowledge.base.file.delete'; knowledgeBaseId: string; fileId: string }
  | { name: 'knowledge.base.search'; knowledgeBaseId: string }
  | { name: 'capabilities.read' }
  | { name: 'capabilities.snapshot' }
  | { name: 'diagnostics.errors' }
  | { name: 'diagnostics.doctor' }
  | { name: 'plugins.diagnostics' }
  | { name: 'workspace.streaming-probe'; workspaceId: string }
  | { name: 'events.stream' }
  | { name: 'platform.gateways.list'; platform: string }
  | { name: 'platform.pairings.list'; platform: string }
  | { name: 'platform.users.list'; platform: string }
  | { name: 'platform.gateway.get'; platform: string; workspaceId: string }
  | { name: 'platform.qrcode.status'; platform: string; workspaceId: string }
  | { name: 'platform.pairing.approve'; platform: string }
  | { name: 'platform.pairing.reject'; platform: string }
  | { name: 'platform.gateway.test'; platform: string; workspaceId: string }
  | { name: 'platform.gateway.enable'; platform: string; workspaceId: string }
  | { name: 'platform.gateway.disable'; platform: string; workspaceId: string }
  | { name: 'platform.file.send'; platform: string; workspaceId: string }
  | { name: 'platform.message.send'; platform: string; workspaceId: string }
  | { name: 'platform.qrcode.create'; platform: string; workspaceId: string };

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
  if (normalizedMethod === 'GET' && relativePath === '/logs') {
    return { name: 'logs.list' };
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
  if (segments[0] === 'automation' && segments[1] === 'monitors') {
    return parseAutomationMonitorsRoute(normalizedMethod, segments);
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
  if (segments[0] === 'providers') {
    return parseProvidersRoute(normalizedMethod, segments);
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
  if (segments[0] === 'knowledge') {
    return parseKnowledgeRoute(normalizedMethod, segments);
  }
  if (segments[0] === 'capabilities') {
    return parseCapabilitiesRoute(normalizedMethod, segments);
  }
  if (segments[0] === 'diagnostics') {
    return parseDiagnosticsRoute(normalizedMethod, segments);
  }
  if (segments[0] === 'plugins') {
    return parsePluginsRoute(normalizedMethod, segments);
  }
  if (normalizedMethod === 'GET' && segments.length === 1 && segments[0] === 'events') {
    return { name: 'events.stream' };
  }
  if (segments[0] === 'platforms') {
    return parsePlatformsRoute(normalizedMethod, segments);
  }

  return null;
}

function parseProvidersRoute(method: string, segments: string[]): LocalAiCoreRoute | null {
  if (method === 'GET' && segments.length === 1) {
    return { name: 'providers.list' };
  }
  if (method === 'POST' && segments.length === 1) {
    return { name: 'providers.create' };
  }
  const providerId = segments.length >= 2 ? decodeURIComponent(segments[1] || '') : '';
  if (!providerId || segments.length !== 2) {
    return null;
  }
  if (method === 'PUT' || method === 'PATCH') {
    return { name: 'provider.update', providerId };
  }
  if (method === 'DELETE') {
    return { name: 'provider.delete', providerId };
  }
  return null;
}

function parseAutomationMonitorsRoute(method: string, segments: string[]): LocalAiCoreRoute | null {
  if (method === 'GET' && segments.length === 2) {
    return { name: 'automation.monitors.list' };
  }
  if (method === 'POST' && segments.length === 2) {
    return { name: 'automation.monitors.create' };
  }
  const monitorId = segments.length >= 3 ? decodeURIComponent(segments[2] || '') : '';
  if (!monitorId) {
    return null;
  }
  if (method === 'GET' && segments.length === 3) {
    return { name: 'automation.monitor.get', monitorId };
  }
  if (method === 'GET' && segments.length === 4 && segments[3] === 'runs') {
    return { name: 'automation.monitor.runs', monitorId };
  }
  if (method === 'POST' && segments.length === 4 && segments[3] === 'run') {
    return { name: 'automation.monitor.run', monitorId };
  }
  if (method === 'PATCH' && segments.length === 3) {
    return { name: 'automation.monitor.update', monitorId };
  }
  if (method === 'DELETE' && segments.length === 3) {
    return { name: 'automation.monitor.delete', monitorId };
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
  const workspaceId = segments.length >= 2 ? decodeURIComponent(segments[1] || '') : '';
  if (method === 'POST' && workspaceId && segments.length === 3 && segments[2] === 'streaming-probe') {
    return { name: 'workspace.streaming-probe', workspaceId };
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

function parseKnowledgeRoute(method: string, segments: string[]): LocalAiCoreRoute | null {
  if (method === 'GET' && segments.length === 2 && segments[1] === 'sources') {
    return { name: 'knowledge.sources.list' };
  }
  if (segments.length === 2 && segments[1] === 'config') {
    if (method === 'GET') {
      return { name: 'knowledge.config.read' };
    }
    if (method === 'POST') {
      return { name: 'knowledge.config.update' };
    }
    return null;
  }
  if (segments[1] === 'folders') {
    return parseKnowledgeFoldersRoute(method, segments);
  }
  if (segments[1] === 'bases') {
    return parseKnowledgeBasesRoute(method, segments);
  }
  return null;
}

function parseKnowledgeFoldersRoute(method: string, segments: string[]): LocalAiCoreRoute | null {
  if (segments.length === 2) {
    if (method === 'GET') {
      return { name: 'knowledge.folders.list' };
    }
    if (method === 'POST') {
      return { name: 'knowledge.folders.create' };
    }
    return null;
  }
  const folderId = segments.length >= 3 ? decodeURIComponent(segments[2] || '') : '';
  if (!folderId || segments.length !== 3) {
    return null;
  }
  if (method === 'PATCH') {
    return { name: 'knowledge.folder.update', folderId };
  }
  if (method === 'DELETE') {
    return { name: 'knowledge.folder.delete', folderId };
  }
  return null;
}

function parseKnowledgeBasesRoute(method: string, segments: string[]): LocalAiCoreRoute | null {
  if (segments.length === 2) {
    if (method === 'GET') {
      return { name: 'knowledge.bases.list' };
    }
    if (method === 'POST') {
      return { name: 'knowledge.bases.create' };
    }
    return null;
  }

  const knowledgeBaseId = segments.length >= 3 ? decodeURIComponent(segments[2] || '') : '';
  if (!knowledgeBaseId) {
    return null;
  }
  if (segments.length === 3) {
    if (method === 'GET') {
      return { name: 'knowledge.base.get', knowledgeBaseId };
    }
    if (method === 'PATCH') {
      return { name: 'knowledge.base.update', knowledgeBaseId };
    }
    if (method === 'DELETE') {
      return { name: 'knowledge.base.delete', knowledgeBaseId };
    }
    return null;
  }
  if (segments.length === 4 && segments[3] === 'files') {
    if (method === 'GET') {
      return { name: 'knowledge.base.files.list', knowledgeBaseId };
    }
    if (method === 'POST') {
      return { name: 'knowledge.base.files.upload', knowledgeBaseId };
    }
    return null;
  }
  if (method === 'DELETE' && segments.length === 5 && segments[3] === 'files') {
    const fileId = decodeURIComponent(segments[4] || '');
    return fileId ? { name: 'knowledge.base.file.delete', knowledgeBaseId, fileId } : null;
  }
  if (method === 'POST' && segments.length === 4 && segments[3] === 'search') {
    return { name: 'knowledge.base.search', knowledgeBaseId };
  }
  return null;
}

function parseCapabilitiesRoute(method: string, segments: string[]): LocalAiCoreRoute | null {
  if (method === 'GET' && segments.length === 1) {
    return { name: 'capabilities.read' };
  }
  if (method === 'GET' && segments.length === 2 && segments[1] === 'snapshot') {
    return { name: 'capabilities.snapshot' };
  }
  return null;
}

function parsePluginsRoute(method: string, segments: string[]): LocalAiCoreRoute | null {
  if (method === 'GET' && segments.length === 2 && segments[1] === 'diagnostics') {
    return { name: 'plugins.diagnostics' };
  }
  return null;
}

function parseDiagnosticsRoute(method: string, segments: string[]): LocalAiCoreRoute | null {
  if (method === 'GET' && segments.length === 2 && segments[1] === 'errors') {
    return { name: 'diagnostics.errors' };
  }
  if (method === 'POST' && segments.length === 2 && segments[1] === 'doctor') {
    return { name: 'diagnostics.doctor' };
  }
  return null;
}

function parsePlatformsRoute(method: string, segments: string[]): LocalAiCoreRoute | null {
  const platform = segments.length >= 2 ? decodeURIComponent(segments[1] || '') : '';
  if (!platform) {
    return null;
  }
  if (method === 'GET') {
    return parsePlatformReadRoute(platform, segments);
  }
  if (method === 'POST') {
    return parsePlatformWriteRoute(platform, segments);
  }
  return null;
}

function parsePlatformReadRoute(platform: string, segments: string[]): LocalAiCoreRoute | null {
  if (segments.length === 2) {
    return { name: 'platform.gateways.list', platform };
  }
  if (segments.length === 3 && segments[2] === 'pairings') {
    return { name: 'platform.pairings.list', platform };
  }
  if (segments.length === 3 && segments[2] === 'users') {
    return { name: 'platform.users.list', platform };
  }
  const workspaceId = segments.length >= 3 ? decodeURIComponent(segments[2] || '') : '';
  if (!workspaceId) {
    return null;
  }
  if (segments.length === 3) {
    return { name: 'platform.gateway.get', platform, workspaceId };
  }
  if (segments.length === 5 && segments[3] === 'qrcode' && segments[4] === 'status') {
    return { name: 'platform.qrcode.status', platform, workspaceId };
  }
  return null;
}

function parsePlatformWriteRoute(platform: string, segments: string[]): LocalAiCoreRoute | null {
  if (segments.length === 4 && segments[2] === 'pairings' && segments[3] === 'approve') {
    return { name: 'platform.pairing.approve', platform };
  }
  if (segments.length === 4 && segments[2] === 'pairings' && segments[3] === 'reject') {
    return { name: 'platform.pairing.reject', platform };
  }

  const workspaceId = segments.length >= 3 ? decodeURIComponent(segments[2] || '') : '';
  const action = segments[3] || '';
  if (!workspaceId || segments.length !== 4 || segments[2] === 'pairings') {
    return null;
  }
  if (action === 'test') {
    return { name: 'platform.gateway.test', platform, workspaceId };
  }
  if (action === 'enable') {
    return { name: 'platform.gateway.enable', platform, workspaceId };
  }
  if (action === 'disable') {
    return { name: 'platform.gateway.disable', platform, workspaceId };
  }
  if (action === 'files') {
    return { name: 'platform.file.send', platform, workspaceId };
  }
  if (action === 'messages') {
    return { name: 'platform.message.send', platform, workspaceId };
  }
  if (action === 'qrcode') {
    return { name: 'platform.qrcode.create', platform, workspaceId };
  }
  return null;
}

function splitRouteSegments(path: string) {
  return path.split('/').filter(Boolean);
}
