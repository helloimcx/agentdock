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
