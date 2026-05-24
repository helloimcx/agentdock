import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ConfigFileState,
  DesktopConnectConfig,
  DesktopProjectConfig,
  ExternalProject,
  ExternalProjectEnsureInput,
  ExternalRunCreateInput,
  ExternalRunCreateResponse,
  ExternalRunSnapshot,
  ExternalThread,
} from '../../../../packages/contracts/src/index.js';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import { migrateLegacyProjectProvidersToStore } from './provider-config-migration.js';
import type { WorkspaceRouter } from '../router/workspace-router.js';

export interface ExternalServiceDeps {
  readConfigState: () => Promise<ConfigFileState>;
  saveStructuredConfig: (config: DesktopConnectConfig) => Promise<ConfigFileState>;
}

export class ExternalService {
  constructor(
    private readonly store: LocalCoreAcpStore,
    private readonly workspaceRouter: WorkspaceRouter,
    private readonly deps: ExternalServiceDeps,
    private readonly userDataPath: string,
  ) {}

  async ensureProject(input: ExternalProjectEnsureInput): Promise<ExternalProject> {
    const userId = normalizeExternalId(input.user_id, 'user_id');
    const externalProjectId = normalizeExternalId(input.external_project_id, 'external_project_id');
    const agentType = normalizeExternalSegment(input.agent_type || 'pi', 'pi');
    const existing = this.store.getExternalProject(userId, externalProjectId);
    const provider = this.resolveProvider(input.provider_id || existing?.providerId);
    const workspaceId = externalWorkspaceId(userId, externalProjectId);
    const workspacePath = this.projectBasePath(userId, externalProjectId);
    const displayName = String(input.display_name || externalProjectId).trim() || externalProjectId;
    mkdirSync(workspacePath, { recursive: true, mode: 0o700 });

    const now = new Date().toISOString();
    const project = this.store.upsertExternalProject({
      userId,
      externalProjectId,
      workspaceId,
      workspacePath,
      displayName,
      agentType,
      providerId: provider.id,
      metadata: input.metadata || existing?.metadata || {},
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });
    await this.ensureWorkspaceConfig(project, input.model);
    this.store.upsertWorkspaceRegistryEntry({
      workspaceId: project.workspaceId,
      displayName: project.displayName,
      path: project.workspacePath,
      deviceId: 'external',
      defaultRuntimeId: project.agentType,
      health: { status: 'healthy', summary: 'External workspace is available.', issues: [], checkedAt: now },
      metadata: {
        external: true,
        userId: project.userId,
        externalProjectId: project.externalProjectId,
      },
    });
    return project;
  }

  async createRun(input: ExternalRunCreateInput): Promise<ExternalRunCreateResponse> {
    if (!String(input.prompt || '').trim()) {
      throw new Error('prompt is required.');
    }
    const project = await this.ensureProject(input);
    const thread = await this.ensureThread(project, input);
    const sent = await this.workspaceRouter.sendThreadMessage(thread.threadId, input.prompt, {
      permissionMode: input.permission_mode,
      runtimeEnv: input.runtime_env,
    });
    const task = this.store.getAgentTaskByRunId(sent.runId);
    return {
      project,
      thread,
      workspace_id: project.workspaceId,
      thread_id: thread.threadId,
      run_id: sent.runId,
      task_id: task?.taskId,
      events_url: `/api/local/v1/external/runs/${encodeURIComponent(sent.runId)}/events`,
    };
  }

  async getRunSnapshot(runId: string): Promise<ExternalRunSnapshot> {
    const task = this.store.getAgentTaskByRunId(runId);
    const run = this.store.getRun(runId);
    const threadId = task?.threadId || run?.thread_id || '';
    const thread = threadId
      ? await this.workspaceRouter.getThread(threadId).catch(() => undefined)
      : undefined;
    return {
      runId,
      task,
      thread,
    };
  }

  private resolveProvider(providerId?: string) {
    const requested = String(providerId || '').trim();
    if (requested) {
      const provider = this.store.getModelProvider(requested);
      if (!provider) {
        throw new Error(`Provider not found: ${requested}`);
      }
      return provider;
    }
    const provider = this.store.listModelProviders()[0];
    if (!provider) {
      throw new Error('No model provider is configured. Create a provider before starting an external run.');
    }
    return provider;
  }

  private async ensureWorkspaceConfig(project: ExternalProject, model?: string) {
    const current = await this.readAndMigrateConfigFile();
    const config: DesktopConnectConfig = {
      ...(current.parsed || {}),
      projects: Array.isArray(current.parsed?.projects) ? [...current.parsed.projects] : [],
    };
    const existingIndex = config.projects!.findIndex((item) => item?.name === project.workspaceId);
    const existing = existingIndex >= 0 ? config.projects![existingIndex] : undefined;
    const defaultRuntimeImageId = Array.isArray(config.sandbox_runtime_images)
      ? config.sandbox_runtime_images.find((image) => image?.agent_type === project.agentType)?.id
      : undefined;
    const options = {
      ...(existing?.agent?.options || {}),
      work_dir: project.workspacePath,
      user_id: project.userId,
      provider_id: project.providerId,
      ...(model ? { model } : {}),
      sandbox: {
        ...(existing?.agent?.options?.sandbox || {}),
        enabled: true,
        ...(defaultRuntimeImageId ? { runtime_image_id: defaultRuntimeImageId } : {}),
        state_scope: 'project' as const,
        sandbox_lifecycle: 'per_thread' as const,
      },
    };
    const nextProject: DesktopProjectConfig = {
      name: project.workspaceId,
      agent: {
        ...(existing?.agent || {}),
        type: project.agentType,
        options,
      },
      platforms: Array.isArray(existing?.platforms) ? existing!.platforms : [],
      admin_from: existing?.admin_from,
      disabled_commands: existing?.disabled_commands,
    };
    if (existingIndex >= 0) {
      config.projects![existingIndex] = nextProject;
    } else {
      config.projects!.push(nextProject);
    }
    await this.deps.saveStructuredConfig(config);
  }

  private async ensureThread(project: ExternalProject, input: ExternalRunCreateInput): Promise<ExternalThread> {
    const externalThreadId = normalizeExternalId(input.external_thread_id || `thread-${randomUUID()}`, 'external_thread_id');
    const existing = this.store.getExternalThread(project.userId, project.externalProjectId, externalThreadId);
    if (existing) {
      const thread = await this.workspaceRouter.getThread(existing.threadId).catch(() => undefined);
      if (thread) {
        return existing;
      }
    }
    const workspacePath = this.threadWorkspacePath(project.userId, project.externalProjectId, externalThreadId);
    mkdirSync(workspacePath, { recursive: true, mode: 0o700 });
    const title = String(input.title || externalThreadId).trim() || externalThreadId;
    const thread = await this.workspaceRouter.createThread(project.workspaceId, title);
    const now = new Date().toISOString();
    return this.store.upsertExternalThread({
      userId: project.userId,
      externalProjectId: project.externalProjectId,
      externalThreadId,
      workspaceId: project.workspaceId,
      threadId: thread.id,
      workspacePath,
      metadata: input.metadata || {},
      createdAt: now,
      updatedAt: now,
    });
  }

  private async readAndMigrateConfigFile(): Promise<ConfigFileState> {
    const current = await this.deps.readConfigState();
    if (!current.parsed) {
      return current;
    }
    const migrated = migrateLegacyProjectProvidersToStore(current.parsed, this.store);
    if (!migrated.changed) {
      return current;
    }
    const saved = await this.deps.saveStructuredConfig(migrated.config);
    return {
      ...saved,
      warnings: [
        ...(current.warnings || []),
        ...(saved.warnings || []),
        ...migrated.warnings,
      ],
    };
  }

  private projectBasePath(userId: string, externalProjectId: string) {
    return join(
      this.workspaceRoot(),
      'users',
      normalizeExternalSegment(userId, 'user'),
      'projects',
      normalizeExternalSegment(externalProjectId, 'project'),
    );
  }

  private threadWorkspacePath(userId: string, externalProjectId: string, externalThreadId: string) {
    return join(
      this.projectBasePath(userId, externalProjectId),
      'threads',
      normalizeExternalSegment(externalThreadId, 'thread'),
      'workspace',
    );
  }

  private workspaceRoot() {
    return String(process.env.AGENTDOCK_EXTERNAL_WORKSPACE_ROOT || '').trim()
      || join(this.userDataPath, 'external-workspaces');
  }
}

function normalizeExternalId(value: string | undefined, label: string) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

function normalizeExternalSegment(value: string | undefined, fallback: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || fallback;
}

function externalWorkspaceId(userId: string, externalProjectId: string) {
  const base = [
    'external',
    normalizeExternalSegment(userId, 'user'),
    normalizeExternalSegment(externalProjectId, 'project'),
  ].join('-');
  const digest = createHash('sha256')
    .update(`${userId}\0${externalProjectId}`)
    .digest('hex')
    .slice(0, 8);
  return `${base}-${digest}`;
}
