import { EventEmitter } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { LocalCoreCapabilitySnapshot, LocalCoreEvent, WorkspaceRegistryCreateInput } from '../../../../packages/contracts/src/index.js';
import type { AgentDockCloudConfig } from '../config.js';
import type { CloudRepository } from '../db/repository.js';
import type { CloudTaskExecutor } from '../executor.js';
import type { LocalVolumeStorage } from '../storage/local-storage.js';

function ok<T>(res: ServerResponse, data: T) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ ok: true, data }));
}

function fail(res: ServerResponse, statusCode: number, error: unknown) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
}

async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) as Record<string, unknown> : {};
}

function cors(req: IncomingMessage, res: ServerResponse) {
  const origin = String(req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Origin', origin === 'null' ? '*' : origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sse(event: LocalCoreEvent) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export class AgentDockCloudServer {
  private readonly server = createServer((req, res) => void this.handle(req, res));

  constructor(
    private readonly config: AgentDockCloudConfig,
    private readonly repo: CloudRepository,
    private readonly storage: LocalVolumeStorage,
    private readonly executor: CloudTaskExecutor,
    private readonly events: EventEmitter,
  ) {}

  listen() {
    return new Promise<void>((resolve) => {
      this.server.listen(this.config.port, this.config.host, resolve);
    });
  }

  close() {
    return new Promise<void>((resolve, reject) => this.server.close((error) => error ? reject(error) : resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    cors(req, res);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      if (url.pathname === '/healthz' || url.pathname === '/api/local/v1/health') {
        ok(res, { name: 'agentdock-cloud', version: '0.1.0', status: 'healthy', instanceId: this.config.instanceId });
        return;
      }
      if (url.pathname === '/metrics' && req.method === 'GET') {
        const metrics = this.repo.getMetrics();
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.end([
          `agentdock_cloud_workspaces ${metrics.workspaces}`,
          `agentdock_cloud_threads ${metrics.threads}`,
          `agentdock_cloud_tasks ${metrics.tasks}`,
          `agentdock_cloud_running_tasks ${metrics.runningTasks}`,
          `agentdock_cloud_events ${metrics.events}`,
          '',
        ].join('\n'));
        return;
      }
      if (url.pathname === '/api/local/v1/events' && req.method === 'GET') {
        this.handleEvents(res);
        return;
      }
      if (url.pathname === '/api/local/v1/runtime' && req.method === 'GET') {
        ok(res, { status: 'running', mode: 'cloud', pid: process.pid, startedAt: new Date().toISOString(), instanceId: this.config.instanceId });
        return;
      }
      if (url.pathname === '/api/local/v1/capabilities/snapshot' && req.method === 'GET') {
        ok(res, cloudCapabilities());
        return;
      }
      if (url.pathname === '/api/local/v1/workspace-registry' && req.method === 'GET') {
        ok(res, { workspaces: this.repo.listWorkspaces() });
        return;
      }
      if (url.pathname === '/api/local/v1/workspace-registry' && req.method === 'POST') {
        const input = await body(req) as unknown as WorkspaceRegistryCreateInput;
        const workspace = this.repo.createWorkspace(input);
        this.storage.ensureWorkspace(workspace.workspaceId);
        ok(res, workspace);
        return;
      }
      const workspaceMatch = url.pathname.match(/^\/api\/local\/v1\/workspace-registry\/([^/]+)$/);
      if (workspaceMatch && req.method === 'GET') {
        ok(res, this.repo.getWorkspace(decodeURIComponent(workspaceMatch[1] || '')));
        return;
      }
      if (url.pathname === '/api/local/v1/workspaces' && req.method === 'GET') {
        ok(res, { workspaces: this.repo.listWorkspaces().map((workspace) => ({
          id: workspace.workspaceId,
          name: workspace.displayName,
          agentType: 'pi',
          platforms: [],
          sessionsCount: 0,
          heartbeatEnabled: false,
        })) });
        return;
      }
      if (url.pathname === '/api/local/v1/workspaces' && req.method === 'POST') {
        const input = await body(req) as unknown as WorkspaceRegistryCreateInput;
        const workspace = this.repo.createWorkspace(input);
        this.storage.ensureWorkspace(workspace.workspaceId);
        ok(res, workspace);
        return;
      }
      const workspaceThreadsMatch = url.pathname.match(/^\/api\/local\/v1\/workspaces\/([^/]+)\/threads$/);
      if (workspaceThreadsMatch && req.method === 'GET') {
        ok(res, { threads: this.repo.listThreads(decodeURIComponent(workspaceThreadsMatch[1] || '')) });
        return;
      }
      if (workspaceThreadsMatch && req.method === 'POST') {
        const input = await body(req);
        ok(res, this.repo.createThread(decodeURIComponent(workspaceThreadsMatch[1] || ''), String(input.title || '') || undefined));
        return;
      }
      if (url.pathname === '/api/local/v1/threads' && req.method === 'GET') {
        ok(res, { threads: this.repo.listThreads(String(url.searchParams.get('workspace_id') || '')) });
        return;
      }
      if (url.pathname === '/api/local/v1/threads' && req.method === 'POST') {
        const input = await body(req);
        ok(res, this.repo.createThread(String(input.workspaceId || ''), String(input.title || '') || undefined));
        return;
      }
      if (url.pathname === '/api/v1/tasks' && req.method === 'POST') {
        const input = await body(req);
        const workspaceId = String(input.workspaceId || '');
        const prompt = String(input.prompt || input.content || '');
        const threadId = String(input.threadId || '') || this.repo.createThread(workspaceId, String(input.title || '') || undefined).id;
        ok(res, await this.executor.startThreadMessage(threadId, prompt));
        return;
      }
      const threadMatch = url.pathname.match(/^\/api\/local\/v1\/threads\/([^/]+)(?:\/([^/]+))?$/);
      if (threadMatch) {
        const threadId = decodeURIComponent(threadMatch[1] || '');
        const action = threadMatch[2] || '';
        if (!action && req.method === 'GET') {
          ok(res, this.repo.getThread(threadId));
          return;
        }
        if (!action && req.method === 'PATCH') {
          const input = await body(req);
          ok(res, this.repo.renameThread(threadId, String(input.title || '')));
          return;
        }
        if (!action && req.method === 'DELETE') {
          ok(res, this.repo.deleteThread(threadId));
          return;
        }
        if ((action === 'messages' || action === 'actions') && req.method === 'POST') {
          const input = await body(req);
          ok(res, await this.executor.startThreadMessage(threadId, String(input.content || '')));
          return;
        }
      }
      const runMatch = url.pathname.match(/^\/api\/local\/v1\/runs\/([^/]+)\/interrupt$/);
      if (runMatch && req.method === 'POST') {
        ok(res, await this.executor.cancelRun(decodeURIComponent(runMatch[1] || '')));
        return;
      }
      const taskMatch = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)(?:\/([^/]+))?$/);
      if (taskMatch) {
        const taskId = decodeURIComponent(taskMatch[1] || '');
        const action = taskMatch[2] || '';
        if (!action && req.method === 'GET') {
          ok(res, this.repo.getTask(taskId));
          return;
        }
        if (action === 'cancel' && req.method === 'POST') {
          ok(res, await this.executor.cancelRun(this.repo.getTask(taskId).runId));
          return;
        }
        if (action === 'files' && req.method === 'GET') {
          const task = this.repo.getTask(taskId);
          const root = this.storage.ensureSessionOutput(task.sessionId);
          const scanned = this.storage.listFiles(root);
          this.repo.replaceOutputFiles(task, scanned);
          ok(res, { root, files: this.repo.listOutputFiles(task.taskId) });
          return;
        }
      }
      fail(res, 404, `Route not found: ${req.method || 'GET'} ${url.pathname}`);
    } catch (error) {
      fail(res, 500, error);
    }
  }

  private handleEvents(res: ServerResponse) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.write(': connected\n\n');
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
    const listener = (event: LocalCoreEvent) => res.write(sse(event));
    this.events.on('local-event', listener);
    res.on('close', () => {
      clearInterval(heartbeat);
      this.events.off('local-event', listener);
    });
  }
}

function cloudCapabilities(): LocalCoreCapabilitySnapshot {
  return {
    agents: [{ id: 'pi', agentType: 'pi', displayName: 'Pi' }],
    channels: [],
    knowledge: [],
    schedulers: [],
    monitors: [],
    ui: [],
  };
}
