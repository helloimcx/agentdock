import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import type {
  ConfigFileState,
  DesktopBridgeEvent,
  DesktopConnectConfig,
  DesktopRuntimeStatus,
  DesktopSettings,
  DesktopSettingsInput,
  DesktopServiceState,
  LocalCoreCapabilities,
  LocalCoreCapabilitySnapshot,
  LocalCorePluginDiagnostics,
  LocalCoreAuthorizedUser,
  LocalCoreChannelAuthorizedUser,
  LocalCoreChannelConnectionResult,
  LocalCoreChannelGatewayStatus,
  LocalCoreLarkConnectionResult,
  LocalCoreLarkGatewayStatus,
  LocalCoreChannelPairingRequest,
  LocalCorePairingRequest,
  LocalCoreEvent,
  ScheduledJob,
  ScheduledJobCreateInput,
  ScheduledJobRun,
  ScheduledJobUpdateInput,
  KnowledgeSource,
  KnowledgeBase,
  KnowledgeBaseCreateInput,
  KnowledgeBaseUpdateInput,
  KnowledgeConfig,
  KnowledgeFile,
  KnowledgeFolder,
  KnowledgeFolderCreateInput,
  KnowledgeFolderUpdateInput,
  KnowledgeSearchInput,
  KnowledgeSearchResult,
  KnowledgeUploadResult,
  WorkspaceStreamingProbeResult,
  ThreadDetail,
  ThreadSummary,
  WorkspaceSummary,
  InstalledAgentRuntime,
} from '../../../../packages/contracts/src/index.js';

export interface LocalAiCoreBindings extends EventEmitter {
  getRuntimeStatus(): Promise<DesktopRuntimeStatus>;
  startService(): Promise<DesktopServiceState>;
  stopService(): Promise<DesktopServiceState>;
  restartService(): Promise<DesktopServiceState>;
  getLogs(limit?: number): string[];
  readConfigFile(): Promise<ConfigFileState>;
  saveRawConfigFile(raw: string): Promise<ConfigFileState>;
  saveStructuredConfigFile(config: DesktopConnectConfig): Promise<ConfigFileState>;
  saveSettings(input: DesktopSettingsInput): Promise<DesktopSettings>;
  listWorkspaces(): Promise<WorkspaceSummary[]>;
  listScheduledJobs(workspaceId?: string): Promise<ScheduledJob[]>;
  getScheduledJob(jobId: string): Promise<ScheduledJob>;
  createScheduledJob(input: ScheduledJobCreateInput): Promise<ScheduledJob>;
  updateScheduledJob(jobId: string, input: ScheduledJobUpdateInput): Promise<ScheduledJob>;
  deleteScheduledJob(jobId: string): Promise<{ deleted: boolean }>;
  runScheduledJob(jobId: string): Promise<ScheduledJobRun>;
  listScheduledJobRuns(jobId: string): Promise<ScheduledJobRun[]>;
  listThreads(workspaceId: string): Promise<ThreadSummary[]>;
  createThread(workspaceId: string, title?: string): Promise<ThreadDetail>;
  getThread(threadId: string): Promise<ThreadDetail>;
  renameThread(threadId: string, title: string): Promise<ThreadDetail>;
  updateThreadKnowledgeBases(threadId: string, knowledgeBaseIds: string[]): Promise<{ knowledgeBaseIds: string[] }>;
  deleteThread(threadId: string): Promise<{ deleted: boolean }>;
  sendThreadMessage(threadId: string, content: string): Promise<{ runId: string }>;
  sendThreadAction(threadId: string, content: string): Promise<{ runId: string }>;
  interruptRun(runId: string): Promise<{ interrupted: boolean }>;
  listKnowledgeSources(): Promise<KnowledgeSource[]>;
  getKnowledgeConfig(): Promise<KnowledgeConfig>;
  updateKnowledgeConfig(input: Partial<KnowledgeConfig>): Promise<KnowledgeConfig>;
  listKnowledgeFolders(): Promise<KnowledgeFolder[]>;
  createKnowledgeFolder(input: KnowledgeFolderCreateInput): Promise<KnowledgeFolder>;
  updateKnowledgeFolder(id: string, input: KnowledgeFolderUpdateInput): Promise<KnowledgeFolder>;
  deleteKnowledgeFolder(id: string): Promise<{ deleted: boolean }>;
  listKnowledgeBases(): Promise<KnowledgeBase[]>;
  getKnowledgeBase(id: string): Promise<KnowledgeBase>;
  createKnowledgeBase(input: KnowledgeBaseCreateInput): Promise<KnowledgeBase>;
  updateKnowledgeBase(id: string, input: KnowledgeBaseUpdateInput): Promise<KnowledgeBase>;
  deleteKnowledgeBase(id: string): Promise<{ deleted: boolean }>;
  listKnowledgeBaseFiles(knowledgeBaseId: string): Promise<KnowledgeFile[]>;
  uploadKnowledgeBaseFiles(
    knowledgeBaseId: string,
    request: { contentType: string; body: Uint8Array },
  ): Promise<KnowledgeUploadResult[]>;
  deleteKnowledgeBaseFile(knowledgeBaseId: string, fileId: string): Promise<{ deleted: boolean }>;
  searchKnowledgeBase(knowledgeBaseId: string, input: KnowledgeSearchInput): Promise<KnowledgeSearchResult[]>;
  getCapabilities(): Promise<LocalCoreCapabilities>;
  getCapabilitySnapshot(): Promise<LocalCoreCapabilitySnapshot>;
  listInstalledAgentRuntimes(): Promise<InstalledAgentRuntime[]>;
  getPluginDiagnostics(): Promise<LocalCorePluginDiagnostics>;
  probeWorkspaceStreaming(workspaceId: string): Promise<WorkspaceStreamingProbeResult>;
  listChannelGatewayStatuses(platform?: string): Promise<LocalCoreChannelGatewayStatus[]>;
  getChannelGatewayStatus(platform: string, workspaceId: string): Promise<LocalCoreChannelGatewayStatus>;
  testChannelConnection(platform: string, workspaceId: string): Promise<LocalCoreChannelConnectionResult>;
  enableChannelGateway(platform: string, workspaceId: string): Promise<LocalCoreChannelGatewayStatus>;
  disableChannelGateway(platform: string, workspaceId: string): Promise<LocalCoreChannelGatewayStatus>;
  listChannelPendingPairings(platform: string, workspaceId?: string): Promise<LocalCoreChannelPairingRequest[]>;
  approveChannelPairing(platform: string, code: string): Promise<LocalCoreChannelAuthorizedUser>;
  rejectChannelPairing(platform: string, code: string): Promise<{ rejected: boolean }>;
  listChannelAuthorizedUsers(platform: string, workspaceId?: string): Promise<LocalCoreChannelAuthorizedUser[]>;
  getWeixinQrCode(workspaceId: string): Promise<{ ticket: string; expiresIn: number; qrCodeUrl: string }>;
  checkWeixinQrCodeStatus(workspaceId: string, ticket: string): Promise<{
    status: 'wait' | 'signed' | 'confirmed' | 'expired';
    userName?: string;
    userId?: string;
  }>;
  listLarkGatewayStatuses(): Promise<LocalCoreLarkGatewayStatus[]>;
  getLarkGatewayStatus(workspaceId: string): Promise<LocalCoreLarkGatewayStatus>;
  testLarkConnection(workspaceId: string): Promise<LocalCoreLarkConnectionResult>;
  enableLarkGateway(workspaceId: string): Promise<LocalCoreLarkGatewayStatus>;
  disableLarkGateway(workspaceId: string): Promise<LocalCoreLarkGatewayStatus>;
  listLarkPendingPairings(workspaceId?: string): Promise<LocalCorePairingRequest[]>;
  approveLarkPairing(code: string): Promise<LocalCoreAuthorizedUser>;
  rejectLarkPairing(code: string): Promise<{ rejected: boolean }>;
  listLarkAuthorizedUsers(workspaceId?: string): Promise<LocalCoreAuthorizedUser[]>;
}

interface LocalAiCoreServerOptions {
  host?: string;
  port?: number;
}

function json<T>(res: ServerResponse, statusCode: number, data: T, ok = true, error?: string) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(ok ? { ok: true, data } : { ok: false, error }));
}

async function readJsonBody(req: IncomingMessage) {
  const body = await readRawBody(req);
  if (!body.length) {
    return {};
  }
  return JSON.parse(Buffer.from(body).toString('utf8')) as Record<string, unknown>;
}

async function readRawBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function setCorsHeaders(req: IncomingMessage, res: ServerResponse) {
  const origin = String(req.headers.origin || '');
  if (origin === 'null' || origin.startsWith('http://127.0.0.1:') || origin.startsWith('http://localhost:')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function createSseEvent(name: LocalCoreEvent['type'], payload: LocalCoreEvent) {
  return `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export class LocalAiCoreServer {
  private readonly host: string;
  private readonly port: number;
  private readonly sseClients = new Set<ServerResponse>();
  private readonly heartbeatTimers = new Map<ServerResponse, NodeJS.Timeout>();
  private server = createServer((req, res) => {
    void this.handleRequest(req, res);
  });

  constructor(private readonly bindings: LocalAiCoreBindings, options: LocalAiCoreServerOptions = {}) {
    this.host = options.host || '127.0.0.1';
    this.port = options.port || 9831;
    this.bindings.on('runtime', (runtime: DesktopRuntimeStatus) => {
      this.broadcast({ type: 'runtime.updated', runtime });
    });
    this.bindings.on('bridge', (bridge: DesktopBridgeEvent) => {
      this.broadcast({ type: 'stream.updated', stream: bridge });
      if (bridge.sessionKey) {
        const threadId = this.findThreadIdFromSessionKey(bridge.sessionKey);
        this.broadcast({
          type: 'presence.updated',
          threadId,
          live: bridge.type !== 'typing_stop',
          stream: bridge,
        });
      }
    });
    this.bindings.on('scheduler-job', (job: ScheduledJob) => {
      this.broadcast({ type: 'scheduler.job.updated', job });
    });
    this.bindings.on('scheduler-run', (run: ScheduledJobRun) => {
      this.broadcast({ type: 'scheduler.run.updated', run });
    });
  }

  async start() {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.server.removeListener('error', reject);
        resolve();
      });
    });
  }

  async stop() {
    for (const client of this.sseClients) {
      client.end();
    }
    this.sseClients.clear();
    for (const timer of this.heartbeatTimers.values()) {
      clearInterval(timer);
    }
    this.heartbeatTimers.clear();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse) {
    setCorsHeaders(req, res);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${this.host}:${this.port}`);
    const path = url.pathname;

    try {
      if (req.method === 'GET' && path === '/api/local/v1/health') {
        json(res, 200, { name: 'local-ai-core', version: '0.1.0' });
        return;
      }
      if (req.method === 'GET' && path === '/api/local/v1/runtime') {
        json(res, 200, await this.bindings.getRuntimeStatus());
        return;
      }
      if (req.method === 'POST' && path === '/api/local/v1/runtime/service/start') {
        json(res, 200, await this.bindings.startService());
        return;
      }
      if (req.method === 'POST' && path === '/api/local/v1/runtime/service/stop') {
        json(res, 200, await this.bindings.stopService());
        return;
      }
      if (req.method === 'POST' && path === '/api/local/v1/runtime/service/restart') {
        json(res, 200, await this.bindings.restartService());
        return;
      }
      if (req.method === 'GET' && path === '/api/local/v1/runtime/logs') {
        const limit = Number(url.searchParams.get('limit') || '200');
        json(res, 200, this.bindings.getLogs(limit));
        return;
      }
      if (req.method === 'GET' && path === '/api/local/v1/runtime/agent-runtimes') {
        json(res, 200, { runtimes: await this.bindings.listInstalledAgentRuntimes() });
        return;
      }
      if (req.method === 'GET' && path === '/api/local/v1/runtime/config') {
        json(res, 200, await this.bindings.readConfigFile());
        return;
      }
      if (req.method === 'POST' && path === '/api/local/v1/runtime/config/raw') {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.saveRawConfigFile(String(body.raw || '')));
        return;
      }
      if (req.method === 'POST' && path === '/api/local/v1/runtime/config/structured') {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.saveStructuredConfigFile((body.config || {}) as DesktopConnectConfig));
        return;
      }
      if (req.method === 'POST' && path === '/api/local/v1/runtime/settings') {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.saveSettings(body as DesktopSettingsInput));
        return;
      }
      if (req.method === 'GET' && path.startsWith('/api/local/v1/platforms/')) {
        const suffix = path.slice('/api/local/v1/platforms/'.length);
        const segments = suffix.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
        const [platform = '', workspaceOrCollection = '', action = ''] = segments;
        if (!platform) {
          json(res, 404, null, false, 'Platform not found');
          return;
        }
        if (segments.length === 1) {
          json(res, 200, { gateways: await this.bindings.listChannelGatewayStatuses(platform) });
          return;
        }
        if (workspaceOrCollection === 'pairings' && segments.length === 2) {
          const workspaceId = String(url.searchParams.get('workspace_id') || '');
          json(res, 200, { pairings: await this.bindings.listChannelPendingPairings(platform, workspaceId || undefined) });
          return;
        }
        if (workspaceOrCollection === 'users' && segments.length === 2) {
          const workspaceId = String(url.searchParams.get('workspace_id') || '');
          json(res, 200, { users: await this.bindings.listChannelAuthorizedUsers(platform, workspaceId || undefined) });
          return;
        }
        if (segments.length === 2) {
          json(res, 200, await this.bindings.getChannelGatewayStatus(platform, workspaceOrCollection));
          return;
        }
        if (platform === 'weixin' && segments.length === 4 && action === 'qrcode' && segments[3] === 'status') {
          const ticket = String(url.searchParams.get('ticket') || '');
          if (!ticket) {
            json(res, 400, null, false, 'Missing ticket parameter');
            return;
          }
          json(res, 200, await this.bindings.checkWeixinQrCodeStatus(workspaceOrCollection, ticket));
          return;
        }
      }
      if (req.method === 'POST' && path.startsWith('/api/local/v1/platforms/')) {
        const suffix = path.slice('/api/local/v1/platforms/'.length);
        const segments = suffix.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
        const [platform = '', workspaceOrCollection = '', action = ''] = segments;
        if (!platform) {
          json(res, 404, null, false, 'Platform not found');
          return;
        }
        if (workspaceOrCollection === 'pairings' && action === 'approve') {
          const body = await readJsonBody(req);
          json(res, 200, await this.bindings.approveChannelPairing(platform, String(body.code || '')));
          return;
        }
        if (workspaceOrCollection === 'pairings' && action === 'reject') {
          const body = await readJsonBody(req);
          json(res, 200, await this.bindings.rejectChannelPairing(platform, String(body.code || '')));
          return;
        }
        if (action === 'test') {
          json(res, 200, await this.bindings.testChannelConnection(platform, workspaceOrCollection));
          return;
        }
        if (action === 'enable') {
          json(res, 200, await this.bindings.enableChannelGateway(platform, workspaceOrCollection));
          return;
        }
        if (action === 'disable') {
          json(res, 200, await this.bindings.disableChannelGateway(platform, workspaceOrCollection));
          return;
        }
        if (platform === 'weixin' && segments.length === 3 && workspaceOrCollection !== 'pairings' && action === 'qrcode') {
          json(res, 200, await this.bindings.getWeixinQrCode(workspaceOrCollection));
          return;
        }
      }
      if (req.method === 'GET' && path === '/api/local/v1/scheduler/jobs') {
        const workspaceId = String(url.searchParams.get('workspace_id') || '');
        json(res, 200, { jobs: await this.bindings.listScheduledJobs(workspaceId || undefined) });
        return;
      }
      if (req.method === 'POST' && path === '/api/local/v1/scheduler/jobs') {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.createScheduledJob(body as unknown as ScheduledJobCreateInput));
        return;
      }
      if (
        req.method === 'GET'
        && path.startsWith('/api/local/v1/scheduler/jobs/')
        && !path.endsWith('/runs')
        && !path.endsWith('/run')
      ) {
        const jobId = decodeURIComponent(path.slice('/api/local/v1/scheduler/jobs/'.length));
        json(res, 200, await this.bindings.getScheduledJob(jobId));
        return;
      }
      if (req.method === 'GET' && path.startsWith('/api/local/v1/scheduler/jobs/') && path.endsWith('/runs')) {
        const jobId = decodeURIComponent(path.slice('/api/local/v1/scheduler/jobs/'.length, -'/runs'.length));
        json(res, 200, { runs: await this.bindings.listScheduledJobRuns(jobId) });
        return;
      }
      if (req.method === 'POST' && path.startsWith('/api/local/v1/scheduler/jobs/') && path.endsWith('/run')) {
        const jobId = decodeURIComponent(path.slice('/api/local/v1/scheduler/jobs/'.length, -'/run'.length));
        json(res, 200, await this.bindings.runScheduledJob(jobId));
        return;
      }
      if (req.method === 'PATCH' && path.startsWith('/api/local/v1/scheduler/jobs/')) {
        const jobId = decodeURIComponent(path.slice('/api/local/v1/scheduler/jobs/'.length));
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.updateScheduledJob(jobId, body as unknown as ScheduledJobUpdateInput));
        return;
      }
      if (req.method === 'DELETE' && path.startsWith('/api/local/v1/scheduler/jobs/')) {
        const jobId = decodeURIComponent(path.slice('/api/local/v1/scheduler/jobs/'.length));
        json(res, 200, await this.bindings.deleteScheduledJob(jobId));
        return;
      }
      if (req.method === 'GET' && path === '/api/local/v1/workspaces') {
        json(res, 200, { workspaces: await this.bindings.listWorkspaces() });
        return;
      }
      if (req.method === 'GET' && path === '/api/local/v1/threads') {
        const workspaceId = String(url.searchParams.get('workspace_id') || '');
        json(res, 200, { threads: workspaceId ? await this.bindings.listThreads(workspaceId) : [] });
        return;
      }
      if (req.method === 'POST' && path === '/api/local/v1/threads') {
        const body = await readJsonBody(req);
        json(
          res,
          200,
          await this.bindings.createThread(String(body.workspaceId || ''), String(body.title || '') || undefined),
        );
        return;
      }
      if (req.method === 'GET' && path.startsWith('/api/local/v1/threads/')) {
        const threadId = decodeURIComponent(path.slice('/api/local/v1/threads/'.length));
        json(res, 200, await this.bindings.getThread(threadId));
        return;
      }
      if (req.method === 'PATCH' && path.startsWith('/api/local/v1/threads/') && path.endsWith('/knowledge-bases')) {
        const threadId = decodeURIComponent(path.slice('/api/local/v1/threads/'.length, -'/knowledge-bases'.length));
        const body = await readJsonBody(req);
        const knowledgeBaseIds = Array.isArray(body.knowledgeBaseIds)
          ? body.knowledgeBaseIds.map((value) => String(value || ''))
          : [];
        json(res, 200, await this.bindings.updateThreadKnowledgeBases(threadId, knowledgeBaseIds));
        return;
      }
      if (req.method === 'PATCH' && path.startsWith('/api/local/v1/threads/')) {
        const threadId = decodeURIComponent(path.slice('/api/local/v1/threads/'.length));
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.renameThread(threadId, String(body.title || '')));
        return;
      }
      if (req.method === 'DELETE' && path.startsWith('/api/local/v1/threads/')) {
        const threadId = decodeURIComponent(path.slice('/api/local/v1/threads/'.length));
        json(res, 200, await this.bindings.deleteThread(threadId));
        return;
      }
      if (req.method === 'POST' && path.startsWith('/api/local/v1/threads/') && path.endsWith('/messages')) {
        const threadId = decodeURIComponent(path.slice('/api/local/v1/threads/'.length, -'/messages'.length));
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.sendThreadMessage(threadId, String(body.content || '')));
        return;
      }
      if (req.method === 'POST' && path.startsWith('/api/local/v1/threads/') && path.endsWith('/actions')) {
        const threadId = decodeURIComponent(path.slice('/api/local/v1/threads/'.length, -'/actions'.length));
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.sendThreadAction(threadId, String(body.content || '')));
        return;
      }
      if (req.method === 'POST' && path.startsWith('/api/local/v1/runs/') && path.endsWith('/interrupt')) {
        const runId = decodeURIComponent(path.slice('/api/local/v1/runs/'.length, -'/interrupt'.length));
        json(res, 200, await this.bindings.interruptRun(runId));
        return;
      }
      if (req.method === 'GET' && path === '/api/local/v1/knowledge/sources') {
        json(res, 200, { sources: await this.bindings.listKnowledgeSources() });
        return;
      }
      if (req.method === 'GET' && path === '/api/local/v1/knowledge/config') {
        json(res, 200, await this.bindings.getKnowledgeConfig());
        return;
      }
      if (req.method === 'POST' && path === '/api/local/v1/knowledge/config') {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.updateKnowledgeConfig(body as Partial<KnowledgeConfig>));
        return;
      }
      if (req.method === 'GET' && path === '/api/local/v1/knowledge/folders') {
        json(res, 200, { folders: await this.bindings.listKnowledgeFolders() });
        return;
      }
      if (req.method === 'POST' && path === '/api/local/v1/knowledge/folders') {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.createKnowledgeFolder(body as unknown as KnowledgeFolderCreateInput));
        return;
      }
      if (req.method === 'PATCH' && path.startsWith('/api/local/v1/knowledge/folders/')) {
        const folderId = decodeURIComponent(path.slice('/api/local/v1/knowledge/folders/'.length));
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.updateKnowledgeFolder(folderId, body as unknown as KnowledgeFolderUpdateInput));
        return;
      }
      if (req.method === 'DELETE' && path.startsWith('/api/local/v1/knowledge/folders/')) {
        const folderId = decodeURIComponent(path.slice('/api/local/v1/knowledge/folders/'.length));
        json(res, 200, await this.bindings.deleteKnowledgeFolder(folderId));
        return;
      }
      if (req.method === 'GET' && path === '/api/local/v1/knowledge/bases') {
        json(res, 200, { bases: await this.bindings.listKnowledgeBases() });
        return;
      }
      if (req.method === 'POST' && path === '/api/local/v1/knowledge/bases') {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.createKnowledgeBase(body as unknown as KnowledgeBaseCreateInput));
        return;
      }
      if (req.method === 'GET' && path.startsWith('/api/local/v1/knowledge/bases/') && !path.endsWith('/files') && !path.endsWith('/search')) {
        const knowledgeBaseId = decodeURIComponent(path.slice('/api/local/v1/knowledge/bases/'.length));
        json(res, 200, await this.bindings.getKnowledgeBase(knowledgeBaseId));
        return;
      }
      if (req.method === 'PATCH' && path.startsWith('/api/local/v1/knowledge/bases/')) {
        const knowledgeBaseId = decodeURIComponent(path.slice('/api/local/v1/knowledge/bases/'.length));
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.updateKnowledgeBase(knowledgeBaseId, body as KnowledgeBaseUpdateInput));
        return;
      }
      if (req.method === 'DELETE' && path.startsWith('/api/local/v1/knowledge/bases/') && !path.includes('/files/')) {
        const knowledgeBaseId = decodeURIComponent(path.slice('/api/local/v1/knowledge/bases/'.length));
        json(res, 200, await this.bindings.deleteKnowledgeBase(knowledgeBaseId));
        return;
      }
      if (req.method === 'GET' && path.startsWith('/api/local/v1/knowledge/bases/') && path.endsWith('/files')) {
        const knowledgeBaseId = decodeURIComponent(path.slice('/api/local/v1/knowledge/bases/'.length, -'/files'.length));
        json(res, 200, { files: await this.bindings.listKnowledgeBaseFiles(knowledgeBaseId) });
        return;
      }
      if (req.method === 'POST' && path.startsWith('/api/local/v1/knowledge/bases/') && path.endsWith('/files')) {
        const knowledgeBaseId = decodeURIComponent(path.slice('/api/local/v1/knowledge/bases/'.length, -'/files'.length));
        const contentType = String(req.headers['content-type'] || '').trim();
        if (!contentType) {
          throw new Error('Upload content type is required.');
        }
        const body = await readRawBody(req);
        json(
          res,
          200,
          { results: await this.bindings.uploadKnowledgeBaseFiles(knowledgeBaseId, { contentType, body }) },
        );
        return;
      }
      if (req.method === 'DELETE' && path.includes('/api/local/v1/knowledge/bases/') && path.includes('/files/')) {
        const prefix = '/api/local/v1/knowledge/bases/';
        const fileMarker = '/files/';
        const knowledgeBaseId = decodeURIComponent(path.slice(prefix.length, path.indexOf(fileMarker)));
        const fileId = decodeURIComponent(path.slice(path.indexOf(fileMarker) + fileMarker.length));
        json(res, 200, await this.bindings.deleteKnowledgeBaseFile(knowledgeBaseId, fileId));
        return;
      }
      if (req.method === 'POST' && path.startsWith('/api/local/v1/knowledge/bases/') && path.endsWith('/search')) {
        const knowledgeBaseId = decodeURIComponent(path.slice('/api/local/v1/knowledge/bases/'.length, -'/search'.length));
        const body = await readJsonBody(req);
        json(res, 200, { results: await this.bindings.searchKnowledgeBase(knowledgeBaseId, body as unknown as KnowledgeSearchInput) });
        return;
      }
      if (req.method === 'GET' && path === '/api/local/v1/capabilities') {
        json(res, 200, await this.bindings.getCapabilities());
        return;
      }
      if (req.method === 'GET' && path === '/api/local/v1/capabilities/snapshot') {
        json(res, 200, await this.bindings.getCapabilitySnapshot());
        return;
      }
      if (req.method === 'GET' && path === '/api/local/v1/plugins/diagnostics') {
        json(res, 200, await this.bindings.getPluginDiagnostics());
        return;
      }
      if (req.method === 'POST' && path.startsWith('/api/local/v1/workspaces/') && path.endsWith('/streaming-probe')) {
        const workspaceId = decodeURIComponent(path.slice('/api/local/v1/workspaces/'.length, -'/streaming-probe'.length));
        json(res, 200, await this.bindings.probeWorkspaceStreaming(workspaceId));
        return;
      }
      if (req.method === 'GET' && path === '/api/local/v1/events') {
        this.attachSseClient(res);
        return;
      }
      json(res, 404, null, false, `Unknown route: ${path}`);
    } catch (error) {
      json(res, 500, null, false, error instanceof Error ? error.message : String(error));
    }
  }

  private attachSseClient(res: ServerResponse) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    this.sseClients.add(res);
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 15000);
    this.heartbeatTimers.set(res, heartbeat);
    res.on('close', () => {
      clearInterval(heartbeat);
      this.heartbeatTimers.delete(res);
      this.sseClients.delete(res);
    });
  }

  private broadcast(event: LocalCoreEvent) {
    const payload = createSseEvent(event.type, event);
    for (const client of this.sseClients) {
      client.write(payload);
    }
  }

  private findThreadIdFromSessionKey(sessionKey: string) {
    const parts = sessionKey.split(':');
    if (parts.length < 3) {
      return undefined;
    }
    return `${encodeURIComponent(parts[1] || '')}::${encodeURIComponent(parts[2] || '')}`;
  }
}
