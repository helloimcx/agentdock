import type { RouteHandler } from '../server-helpers.js';
import { json, readJsonBody } from '../server-helpers.js';
import type { StandardsService } from '../../standards/standards-service.js';
import type { WorkspaceRouter } from '../../router/workspace-router.js';
import { detectWorkspaceTechStack } from '../../standards/standards-detector.js';
import type { DesktopStandardsOptions } from '@cc/superai-contracts';
import type {
  InstallStandardPackInput,
  RuleIntensityLevel,
  WorkspaceStandardsConfig,
} from '@cc/superai-contracts/standards';
import { StandardSecurityError } from '../../standards/standards-service.js';

export function registerStandardsHandlers(
  map: Map<string, RouteHandler>,
  standardsService: StandardsService,
  workspaceRouter: WorkspaceRouter,
) {
  registerStandardsPackHandlers(map, standardsService, workspaceRouter);
  registerWorkspaceStandardsRouteHandlers(map, standardsService, workspaceRouter);
}

function registerStandardsPackHandlers(
  map: Map<string, RouteHandler>,
  standardsService: StandardsService,
  workspaceRouter: WorkspaceRouter,
) {
  registerPackQueryHandlers(map, standardsService, workspaceRouter);
  registerPackMutationHandlers(map, standardsService, workspaceRouter);
}

function registerPackQueryHandlers(
  map: Map<string, RouteHandler>,
  standardsService: StandardsService,
  workspaceRouter: WorkspaceRouter,
) {
  map.set('standards.packs.list', async (_route, req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const workspaceId = url.searchParams.get('workspaceId') || undefined;
    let workspacePath = url.searchParams.get('workspacePath') || undefined;
    let workspaceConfig: WorkspaceStandardsConfig | undefined;

    if (workspaceId) {
      if (!workspacePath) workspacePath = await workspaceRouter.resolveWorkspacePath(workspaceId);
      const project = await workspaceRouter.getWorkspaceProject(workspaceId);
      if (project?.agent?.options?.standards) {
        const std = project.agent.options.standards;
        workspaceConfig = {
          enabled: std.enabled !== false,
          intensity: (std.intensity as RuleIntensityLevel) || 'full',
          activePacks: std.active_packs || ['general'],
          autoDetectStack: std.auto_detect_stack !== false,
          customRules: std.custom_rules,
          targetFiles: std.target_files,
        };
      }
    }

    const packs = standardsService.listPacks({ workspacePath, workspaceConfig });
    json(res, 200, { packs });
  });

  map.set('standards.packs.get', async (route, req, res) => {
    const packId = (route as { packId: string }).packId;
    const url = new URL(req.url || '/', 'http://localhost');
    const workspaceId = url.searchParams.get('workspaceId') || undefined;
    let workspacePath = url.searchParams.get('workspacePath') || undefined;

    if (workspaceId && !workspacePath) workspacePath = await workspaceRouter.resolveWorkspacePath(workspaceId);

    const pack = standardsService.getPackMetadata(packId, { workspacePath });
    if (!pack) {
      json(res, 404, { error: `Standard pack "${packId}" not found.` });
      return;
    }
    json(res, 200, pack);
  });
}

function registerPackMutationHandlers(
  map: Map<string, RouteHandler>,
  standardsService: StandardsService,
  workspaceRouter: WorkspaceRouter,
) {
  map.set('standards.packs.install', async (_route, req, res) => {
    const body = (await readJsonBody(req)) as unknown as (InstallStandardPackInput & { rawContent?: string }) | null;
    if (!body || (!body.repoOrUrl && !body.rawContent)) {
      json(res, 400, { error: 'Missing repository URL or raw pack content.' });
      return;
    }

    let workspacePath = body.workspacePath;
    if (body.workspaceId && !workspacePath) workspacePath = await workspaceRouter.resolveWorkspacePath(body.workspaceId);

    try {
      const pack = await standardsService.installStandardPack({
        repoOrUrl: body.repoOrUrl || '',
        scope: body.scope,
        workspacePath,
        rawContent: body.rawContent,
        force: body.force,
      });
      json(res, 200, { pack });
    } catch (err: any) {
      if (err instanceof StandardSecurityError) {
        json(res, 422, { error: err.message, report: err.report });
        return;
      }
      json(res, 500, { error: err.message || 'Failed to install standard pack.' });
    }
  });

  map.set('standards.packs.scan', async (_route, req, res) => {
    const body = (await readJsonBody(req)) as { content?: string; packId?: string } | null;
    if (!body || typeof body.content !== 'string') {
      json(res, 400, { error: 'Missing content field to scan.' });
      return;
    }
    const report = standardsService.scanStandardPack(body.content, body.packId);
    json(res, 200, report);
  });

  map.set('standards.packs.remove', async (route, req, res) => {
    const packId = (route as { packId: string }).packId;
    const url = new URL(req.url || '/', 'http://localhost');
    const scope = (url.searchParams.get('scope') as 'user' | 'workspace') || undefined;
    const workspaceId = url.searchParams.get('workspaceId') || undefined;
    let workspacePath = url.searchParams.get('workspacePath') || undefined;

    if (workspaceId && !workspacePath) workspacePath = await workspaceRouter.resolveWorkspacePath(workspaceId);

    const removed = standardsService.removeStandardPack(packId, { scope, workspacePath });
    if (!removed) {
      json(res, 404, { error: `Standard pack "${packId}" could not be found or removed.` });
      return;
    }
    json(res, 200, { ok: true, removedPackId: packId });
  });
}

function registerWorkspaceStandardsRouteHandlers(
  map: Map<string, RouteHandler>,
  standardsService: StandardsService,
  workspaceRouter: WorkspaceRouter,
) {
  registerWorkspaceStandardsCrudHandlers(map, standardsService, workspaceRouter);
  registerWorkspaceStandardsActionHandlers(map, standardsService, workspaceRouter);
}

function registerWorkspaceStandardsCrudHandlers(
  map: Map<string, RouteHandler>,
  standardsService: StandardsService,
  workspaceRouter: WorkspaceRouter,
) {
  map.set('workspaces.standards.get', async (route, _req, res) => {
    const workspaceId = (route as { workspaceId: string }).workspaceId;
    const project = await workspaceRouter.getWorkspaceProject(workspaceId);
    const workspacePath = await workspaceRouter.resolveWorkspacePath(workspaceId);

    const standards = project?.agent?.options?.standards || {
      enabled: true,
      intensity: 'full',
      active_packs: ['general'],
      auto_detect_stack: true,
      target_files: ['AGENTS.md', 'CLAUDE.md'],
    };

    const detectedStacks = workspacePath
      ? detectWorkspaceTechStack(workspacePath)
      : { languages: [], frameworks: [], detectedFiles: [], recommendedPacks: ['general'] };
    json(res, 200, { workspaceId, workspacePath, standards, detectedStacks });
  });

  map.set('workspaces.standards.update', async (route, req, res) => {
    const workspaceId = (route as { workspaceId: string }).workspaceId;
    const body = (await readJsonBody(req)) as DesktopStandardsOptions | null;
    if (!body) {
      json(res, 400, { error: 'Missing standards configuration body.' });
      return;
    }

    const updated = await workspaceRouter.updateWorkspaceStandards(workspaceId, body);
    const workspacePath = await workspaceRouter.resolveWorkspacePath(workspaceId);

    let materialized = null;
    if (workspacePath && updated.enabled !== false) {
      try {
        materialized = standardsService.materialize({
          workspacePath,
          workspaceId,
          config: {
            enabled: true,
            intensity: (updated.intensity as RuleIntensityLevel) || 'full',
            activePacks: updated.active_packs || ['general'],
            autoDetectStack: updated.auto_detect_stack !== false,
            customRules: updated.custom_rules,
            targetFiles: updated.target_files || ['AGENTS.md', 'CLAUDE.md'],
          },
        });
      } catch (err: any) {
        if (err instanceof StandardSecurityError) {
          json(res, 422, { error: err.message, report: err.report });
          return;
        }
        json(res, 500, { error: err.message || 'Failed to materialize standards.' });
        return;
      }
    }

    json(res, 200, { ok: true, standards: updated, materialized });
  });
}

function registerWorkspaceStandardsActionHandlers(
  map: Map<string, RouteHandler>,
  standardsService: StandardsService,
  workspaceRouter: WorkspaceRouter,
) {
  map.set('workspaces.standards.materialize', async (route, req, res) => {
    const workspaceId = (route as { workspaceId: string }).workspaceId;
    const body = (await readJsonBody(req)) as { unattended?: boolean } | null;
    const workspacePath = await workspaceRouter.resolveWorkspacePath(workspaceId);
    if (!workspacePath) {
      json(res, 404, { error: `Workspace "${workspaceId}" path not found.` });
      return;
    }

    const project = await workspaceRouter.getWorkspaceProject(workspaceId);
    const std = project?.agent?.options?.standards;

    try {
      const result = standardsService.materialize({
        workspacePath,
        workspaceId,
        config: {
          enabled: std?.enabled !== false,
          intensity: (std?.intensity as RuleIntensityLevel) || 'full',
          activePacks: std?.active_packs || ['general'],
          autoDetectStack: std?.auto_detect_stack !== false,
          customRules: std?.custom_rules,
          targetFiles: std?.target_files || ['AGENTS.md', 'CLAUDE.md'],
        },
        unattended: body?.unattended,
      });

      json(res, 200, result);
    } catch (err: any) {
      if (err instanceof StandardSecurityError) {
        json(res, 422, { error: err.message, report: err.report });
        return;
      }
      json(res, 500, { error: err.message || 'Failed to materialize standards.' });
    }
  });

  map.set('workspaces.standards.detect', async (route, _req, res) => {
    const workspaceId = (route as { workspaceId: string }).workspaceId;
    const workspacePath = await workspaceRouter.resolveWorkspacePath(workspaceId);
    if (!workspacePath) {
      json(res, 404, { error: `Workspace "${workspaceId}" path not found.` });
      return;
    }

    const detectedStacks = detectWorkspaceTechStack(workspacePath);
    json(res, 200, { workspaceId, workspacePath, detectedStacks });
  });
}
