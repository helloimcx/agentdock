import type { RouteHandler } from '../server-helpers.js';
import { json, readJsonBody } from '../server-helpers.js';
import type {
  SaveSkillInput,
  InstallSkillInput,
  InstallSkillBundleInput,
  DeleteSkillInput,
  ToggleSkillInput,
  UpdateSkillInput,
} from '@cc/superai-contracts/skills';
import { ManagedSkillCatalog } from '../managed-skill-catalog.js';
import { mountActiveSkillsForAgent } from '../skill-mounter.js';
import {
  scanSkillContent,
  scanSkillDirectory,
  summarizeFindings,
  calculateHighestSeverity,
} from '../../security/skill-content-scan.js';

export function registerSkillsHandlers(
  map: Map<string, RouteHandler>,
  catalog = new ManagedSkillCatalog(),
) {
  registerSkillQueryHandlers(map, catalog);
  registerSkillMutationHandlers(map, catalog);
  registerSkillDistributionHandlers(map, catalog);
}

function registerSkillQueryHandlers(map: Map<string, RouteHandler>, catalog: ManagedSkillCatalog) {
  map.set('skills.list', async (_route, req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const workspacePath = url.searchParams.get('workspacePath') || undefined;
    const workspaceId = url.searchParams.get('workspaceId') || undefined;
    const skills = catalog.listSkills({ workspacePath, workspaceId });
    json(res, 200, { skills });
  });

  map.set('skills.get', async (route, req, res) => {
    const skillId = (route as { skillId: string }).skillId;
    const url = new URL(req.url || '/', 'http://localhost');
    const workspacePath = url.searchParams.get('workspacePath') || undefined;
    const workspaceId = url.searchParams.get('workspaceId') || undefined;
    const skill = catalog.getDetail(skillId, { workspacePath, workspaceId });
    if (!skill) {
      json(res, 404, { error: `Skill ${skillId} not found.` });
      return;
    }
    json(res, 200, skill);
  });

  map.set('skills.verify', async (_route, req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const workspacePath = url.searchParams.get('workspacePath') || undefined;
    const workspaceId = url.searchParams.get('workspaceId') || undefined;
    const skillId = url.searchParams.get('skillId') || undefined;
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
    return await handleScanGet(req, res, catalog);
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

async function handleScanGet(req: any, res: any, catalog: ManagedSkillCatalog) {
  const url = new URL(req.url || '/', 'http://localhost');
  const workspacePath = url.searchParams.get('workspacePath') || undefined;
  const workspaceId = url.searchParams.get('workspaceId') || undefined;
  const skillId = url.searchParams.get('skillId') || undefined;

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

function registerSkillMutationHandlers(map: Map<string, RouteHandler>, catalog: ManagedSkillCatalog) {
  map.set('skills.save', async (_route, req, res) => {
    const raw = await readJsonBody(req);
    if (!raw || typeof raw !== 'object') return json(res, 400, { error: 'Invalid JSON body' });
    const body = raw as unknown as SaveSkillInput;
    if (!body.id || typeof body.id !== 'string') return json(res, 400, { error: 'Skill ID is required and must be a string.' });
    if (body.scope !== 'user' && body.scope !== 'workspace') return json(res, 400, { error: 'scope must be "user" or "workspace".' });
    try {
      const skill = catalog.saveSkill(body);
      await mountActiveSkillsForAgent({ workspacePath: body.workspacePath, catalog });
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
    try {
      const success = catalog.deleteSkill(body);
      await mountActiveSkillsForAgent({ workspacePath: body.workspacePath, catalog });
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
    try {
      const success = catalog.toggleSkill(body);
      await mountActiveSkillsForAgent({ workspacePath: body.workspacePath, catalog });
      json(res, 200, { success });
    } catch (err) {
      json(res, 400, { error: String(err) });
    }
  });
}

function registerSkillDistributionHandlers(map: Map<string, RouteHandler>, catalog: ManagedSkillCatalog) {
  map.set('skills.install', async (_route, req, res) => {
    const raw = await readJsonBody(req);
    if (!raw || typeof raw !== 'object') return json(res, 400, { error: 'Invalid JSON body' });
    const body = raw as unknown as InstallSkillInput;
    if (!body.url && !body.repo) return json(res, 400, { error: 'Git URL or repository is required.' });
    try {
      const skill = await catalog.installSkillFromGit(body);
      await mountActiveSkillsForAgent({ workspacePath: body.workspacePath, catalog });
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
    try {
      const result = await catalog.installSkillBundleFromGit(body);
      await mountActiveSkillsForAgent({ workspacePath: body.workspacePath, catalog });
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
    try {
      const result = await catalog.installSkillFromSource(body);
      await mountActiveSkillsForAgent({ workspacePath: body.workspacePath, catalog });
      json(res, 200, result);
    } catch (err) {
      json(res, 400, { error: String(err) });
    }
  });

  map.set('skills.update', async (_route, req, res) => {
    const raw = await readJsonBody(req);
    if (!raw || typeof raw !== 'object') return json(res, 400, { error: 'Invalid JSON body' });
    const body = raw as unknown as UpdateSkillInput;
    try {
      const result = await catalog.updateSkill(body);
      await mountActiveSkillsForAgent({ workspacePath: body.workspacePath, catalog });
      json(res, 200, result);
    } catch (err) {
      json(res, 400, { error: String(err) });
    }
  });
}
