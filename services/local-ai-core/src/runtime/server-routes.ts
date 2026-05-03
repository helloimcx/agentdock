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
  | { name: 'scheduler.job.delete'; jobId: string };

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

function splitRouteSegments(path: string) {
  return path.split('/').filter(Boolean);
}
