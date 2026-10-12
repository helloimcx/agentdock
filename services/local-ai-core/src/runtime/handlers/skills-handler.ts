import { existsSync } from 'node:fs';
import type { RouteHandler } from '../server-helpers.js';
import { json, readJsonBody } from '../server-helpers.js';
import type {
  SaveSkillInput,
  InstallSkillInput,
  InstallSkillBundleInput,
  DeleteSkillInput,
  ToggleSkillInput,
  UpdateSkillInput,
  SkillRouteInput,
} from '@cc/superai-contracts/skills';
import { ManagedSkillCatalog } from '../managed-skill-catalog.js';
import { mountActiveSkillsForAgent } from '../skill-mounter.js';
import {
  toSafeWorkspaceId,
  resolveMeshWorkspaceSkillsPath,
  refreshMeshShadowSkillMounts,
} from '../workspace-skills-resolver.js';
import { SkillRouter } from '../../skills/skill-router.js';
import {
  scanSkillContent,
  scanSkillDirectory,
  summarizeFindings,
  calculateHighestSeverity,
} from '../../security/skill-content-scan.js';

export interface SkillsHandlerContext {
  baseDir?: string;
  workspaceRouter?: { resolveWorkspacePath: (workspaceId: string) => Promise<string | undefined> };
  store?: { readRuntimeConfig?: () => { baseDir?: string } };
}

async function resolveWorkspacePathIfNeeded(
  target: { workspacePath?: string; workspaceId?: string },
  context?: SkillsHandlerContext,
): Promise<string | undefined> {
  if (target.workspacePath) return target.workspacePath;
  if (!target.workspaceId) return undefined;
  const baseDir = context?.baseDir || context?.store?.readRuntimeConfig?.()?.baseDir;
  if (!baseDir) return undefined;

  if (context?.workspaceRouter) {
    try {
      const resolved = await context.workspaceRouter.resolveWorkspacePath(target.workspaceId);
      if (resolved && existsSync(resolved)) return resolved;
    } catch {
      // Fallback to mesh persistent storage
    }
  }
  return resolveMeshWorkspaceSkillsPath(baseDir, toSafeWorkspaceId(target.workspaceId));
}

/**
 * Fills in `workspacePath` from `workspaceId` before a skill mutation.
 * `gateField` names the route's own contract field (`scope` or `targetScope`)
 * that must be explicitly 'workspace' for resolution to happen; omit it for
 * routes whose contracts have no scope field (toggle/update).
 */
async function applyWorkspacePathResolution(
  body: { workspacePath?: string; workspaceId?: string; scope?: string; targetScope?: string },
  context?: SkillsHandlerContext,
  gateField?: 'scope' | 'targetScope',
): Promise<void> {
  if (body.workspacePath || !body.workspaceId) return;
  if (gateField && body[gateField] !== 'workspace') return;
  body.workspacePath = await resolveWorkspacePathIfNeeded(body, context);
}

async function syncSkillMounts(
  catalog: ManagedSkillCatalog,
  context?: SkillsHandlerContext,
  target?: { workspacePath?: string; workspaceId?: string },
): Promise<void> {
  const baseDir = context?.baseDir || context?.store?.readRuntimeConfig?.()?.baseDir;
  const workspacePath = target ? await resolveWorkspacePathIfNeeded(target, context) : undefined;

  await mountActiveSkillsForAgent({ workspacePath, catalog });

  if (baseDir) {
    refreshMeshShadowSkillMounts({
      baseDir,
      workspaceId: target?.workspaceId,
      workspacePath,
      catalog,
    });
  }
}

export function registerSkillsHandlers(
  map: Map<string, RouteHandler>,
  catalog = new ManagedSkillCatalog(),
  context?: SkillsHandlerContext,
) {
  registerSkillQueryHandlers(map, catalog, context);
  registerSkillMutationHandlers(map, catalog, context);
  registerSkillDistributionHandlers(map, catalog, context);
}

async function parseSkillRouteParams(req: any): Promise<{
  query: string;
  workspacePath?: string;
  workspaceId?: string;
  maxMatches?: number;
}> {
  if (req.method === 'POST') {
    const body = (await readJsonBody(req)) as unknown as SkillRouteInput | null;
    return {
      query: body?.query || '',
      workspacePath: body?.workspacePath,
      workspaceId: body?.workspaceId,
      maxMatches: body?.maxMatches,
    };
  }
  const url = new URL(req.url || '/', 'http://localhost');
  const m = url.searchParams.get('maxMatches');
  return {
    query: url.searchParams.get('query') || url.searchParams.get('q') || '',
    workspacePath: url.searchParams.get('workspacePath') || undefined,
    workspaceId: url.searchParams.get('workspaceId') || undefined,
    maxMatches: m ? Number.parseInt(m, 10) : undefined,
  };
}

function registerSkillQueryHandlers(
  map: Map<string, RouteHandler>,
  catalog: ManagedSkillCatalog,
  context?: SkillsHandlerContext,
) {
  map.set('skills.list', async (_route, req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    let workspacePath = url.searchParams.get('workspacePath') || undefined;
    const workspaceId = url.searchParams.get('workspaceId') || undefined;
    workspacePath = await resolveWorkspacePathIfNeeded({ workspacePath, workspaceId }, context);
    const skills = catalog.listSkills({ workspacePath, workspaceId });
    json(res, 200, { skills });
  });

  map.set('skills.get', async (route, req, res) => {
    const skillId = (route as { skillId: string }).skillId;
    const url = new URL(req.url || '/', 'http://localhost');
    let workspacePath = url.searchParams.get('workspacePath') || undefined;
    const workspaceId = url.searchParams.get('workspaceId') || undefined;
    workspacePath = await resolveWorkspacePathIfNeeded({ workspacePath, workspaceId }, context);
    const skill = catalog.getDetail(skillId, { workspacePath, workspaceId });
    if (!skill) {
      json(res, 404, { error: `Skill ${skillId} not found.` });
      return;
    }
    json(res, 200, skill);
  });

  map.set('skills.verify', async (_route, req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    let workspacePath = url.searchParams.get('workspacePath') || undefined;
    const workspaceId = url.searchParams.get('workspaceId') || undefined;
    const skillId = url.searchParams.get('skillId') || undefined;
    workspacePath = await resolveWorkspacePathIfNeeded({ workspacePath, workspaceId }, context);
    const result = catalog.verifySkills({ workspacePath, workspaceId, skillId });
    json(res, 200, result);
  });

  map.set('skills.sources', async (_route, req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const workspaceId = url.searchParams.get('workspaceId') || undefined;
    const sources = catalog.store ? catalog.store.listSources({ workspaceId }) : [];
    json(res, 200, { sources });
  });

  map.set('skills.scan', async (_route, req, res) => {
    if (req.method === 'POST') {
      return await handleScanPost(req, res);
    }
    return await handleScanGet(req, res, catalog, context);
  });

  map.set('skills.route', async (_route, req, res) => {
    const params = await parseSkillRouteParams(req);
    const workspacePath = await resolveWorkspacePathIfNeeded(
      { workspacePath: params.workspacePath, workspaceId: params.workspaceId },
      context,
    );

    const skills = catalog.listSkills({ workspacePath, workspaceId: params.workspaceId });
    const router = new SkillRouter(params.maxMatches ? { maxMatches: params.maxMatches } : {});
    const result = router.route(params.query, skills);
    json(res, 200, result);
  });
}

async function handleScanPost(req: any, res: any) {
  const raw = await readJsonBody(req);
  if (!raw || typeof raw !== 'object') return json(res, 400, { error: 'Invalid JSON body' });
  const body = raw as { content?: string; name?: string; path?: string; id?: string };
  if (body.content) {
    const findings = scanSkillContent(body.content, body.name || 'SKILL.md');
    const summary = summarizeFindings(findings);
    const highestSeverity = calculateHighestSeverity(findings);
    const passed = summary.critical === 0 && summary.high === 0;
    return json(res, 200, {
      report: {
        skillId: body.id || body.name || 'skill',
        scannedAt: new Date().toISOString(),
        passed,
        highestSeverity,
        findings,
        summary,
      },
    });
  }
  if (body.path) {
    const report = scanSkillDirectory(body.path, body.id || 'skill');
    return json(res, 200, { report });
  }
  return json(res, 400, { error: 'content or path is required for scanning.' });
}

async function handleScanGet(req: any, res: any, catalog: ManagedSkillCatalog, context?: SkillsHandlerContext) {
  const url = new URL(req.url || '/', 'http://localhost');
  let workspacePath = url.searchParams.get('workspacePath') || undefined;
  const workspaceId = url.searchParams.get('workspaceId') || undefined;
  const skillId = url.searchParams.get('skillId') || undefined;

  workspacePath = await resolveWorkspacePathIfNeeded({ workspacePath, workspaceId }, context);

  if (skillId) {
    const report = catalog.scanSkill(skillId, { workspacePath, workspaceId });
    if (!report) {
      return json(res, 404, { error: `Skill ${skillId} not found.` });
    }
    return json(res, 200, { report });
  }

  const result = catalog.scanAllSkills({ workspacePath, workspaceId });
  json(res, 200, result);
}

function registerSkillMutationHandlers(
  map: Map<string, RouteHandler>,
  catalog: ManagedSkillCatalog,
  context?: SkillsHandlerContext,
) {
  map.set('skills.save', async (_route, req, res) => {
    const raw = await readJsonBody(req);
    if (!raw || typeof raw !== 'object') return json(res, 400, { error: 'Invalid JSON body' });
    const body = raw as unknown as SaveSkillInput;
    if (!body.id || typeof body.id !== 'string') return json(res, 400, { error: 'Skill ID is required and must be a string.' });
    if (body.scope !== 'user' && body.scope !== 'workspace') return json(res, 400, { error: 'scope must be "user" or "workspace".' });

    await applyWorkspacePathResolution(body, context, 'scope');

    try {
      const skill = catalog.saveSkill(body);
      await syncSkillMounts(catalog, context, body as { workspacePath?: string; workspaceId?: string });
      json(res, 200, skill);
    } catch (err) {
      json(res, 400, { error: String(err) });
    }
  });

  map.set('skills.delete', async (_route, req, res) => {
    const raw = await readJsonBody(req);
    if (!raw || typeof raw !== 'object') return json(res, 400, { error: 'Invalid JSON body' });
    const body = raw as unknown as DeleteSkillInput;
    if (!body.id || typeof body.id !== 'string') return json(res, 400, { error: 'Skill ID is required and must be a string.' });

    await applyWorkspacePathResolution(body, context, 'scope');

    try {
      const success = catalog.deleteSkill(body);
      await syncSkillMounts(catalog, context, body);
      json(res, 200, { success });
    } catch (err) {
      json(res, 400, { error: String(err) });
    }
  });

  map.set('skills.toggle', async (_route, req, res) => {
    const raw = await readJsonBody(req);
    if (!raw || typeof raw !== 'object') return json(res, 400, { error: 'Invalid JSON body' });
    const body = raw as unknown as ToggleSkillInput;
    if (!body.id || typeof body.id !== 'string') return json(res, 400, { error: 'Skill ID is required and must be a string.' });

    await applyWorkspacePathResolution(body, context);

    try {
      const success = catalog.toggleSkill(body);
      await syncSkillMounts(catalog, context, body as { workspacePath?: string; workspaceId?: string });
      json(res, 200, { success });
    } catch (err) {
      json(res, 400, { error: String(err) });
    }
  });
}

function registerSkillDistributionHandlers(
  map: Map<string, RouteHandler>,
  catalog: ManagedSkillCatalog,
  context?: SkillsHandlerContext,
) {
  map.set('skills.install', async (_route, req, res) => {
    const raw = await readJsonBody(req);
    if (!raw || typeof raw !== 'object') return json(res, 400, { error: 'Invalid JSON body' });
    const body = raw as unknown as InstallSkillInput;
    if (!body.url && !body.repo) return json(res, 400, { error: 'Git URL or repository is required.' });

    await applyWorkspacePathResolution(body, context, 'targetScope');

    try {
      const skill = await catalog.installSkillFromGit(body);
      await syncSkillMounts(catalog, context, body);
      json(res, 200, skill);
    } catch (err) {
      json(res, 400, { error: String(err) });
    }
  });

  map.set('skills.installBundle', async (_route, req, res) => {
    const raw = await readJsonBody(req);
    if (!raw || typeof raw !== 'object') return json(res, 400, { error: 'Invalid JSON body' });
    const body = raw as unknown as InstallSkillBundleInput;
    if (!body.url && !body.repo) return json(res, 400, { error: 'Git URL or repository is required.' });
    if (body.targetScope !== 'user' && body.targetScope !== 'workspace') return json(res, 400, { error: 'targetScope must be "user" or "workspace".' });

    await applyWorkspacePathResolution(body, context, 'targetScope');

    try {
      const result = await catalog.installSkillBundleFromGit(body);
      await syncSkillMounts(catalog, context, body);
      json(res, 200, result);
    } catch (err) {
      json(res, 400, { error: String(err) });
    }
  });

  map.set('skills.add', async (_route, req, res) => {
    const raw = await readJsonBody(req);
    if (!raw || typeof raw !== 'object') return json(res, 400, { error: 'Invalid JSON body' });
    const body = raw as unknown as InstallSkillInput;
    if (!body.repo && !body.url) return json(res, 400, { error: 'Repository or URL is required.' });

    await applyWorkspacePathResolution(body, context, 'targetScope');

    try {
      const result = await catalog.installSkillFromSource(body);
      await syncSkillMounts(catalog, context, body);
      json(res, 200, result);
    } catch (err) {
      json(res, 400, { error: String(err) });
    }
  });

  map.set('skills.update', async (_route, req, res) => {
    const raw = await readJsonBody(req);
    if (!raw || typeof raw !== 'object') return json(res, 400, { error: 'Invalid JSON body' });
    const body = raw as unknown as UpdateSkillInput;

    await applyWorkspacePathResolution(body, context);

    try {
      const result = await catalog.updateSkill(body);
      await syncSkillMounts(catalog, context, body);
      json(res, 200, result);
    } catch (err) {
      json(res, 400, { error: String(err) });
    }
  });
}
