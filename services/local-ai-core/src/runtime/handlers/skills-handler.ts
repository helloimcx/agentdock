import type { RouteHandler } from '../server-helpers.js';
import { json, readJsonBody } from '../server-helpers.js';
import type { SaveSkillInput, InstallSkillInput, InstallSkillBundleInput, DeleteSkillInput, ToggleSkillInput } from '@cc/superai-contracts';
import { ManagedSkillCatalog } from '../managed-skill-catalog.js';
import { mountActiveSkillsForAgent } from '../skill-mounter.js';

export function registerSkillsHandlers(
  map: Map<string, RouteHandler>,
  catalog = new ManagedSkillCatalog(),
) {
  map.set('skills.list', async (_route, req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const workspacePath = url.searchParams.get('workspacePath') || undefined;
    const skills = catalog.listSkills({ workspacePath });
    json(res, 200, { skills });
  });

  map.set('skills.get', async (route, req, res) => {
    const skillId = (route as { skillId: string }).skillId;
    const url = new URL(req.url || '/', 'http://localhost');
    const workspacePath = url.searchParams.get('workspacePath') || undefined;
    const skill = catalog.getDetail(skillId, { workspacePath });
    if (!skill) {
      json(res, 404, { error: `Skill ${skillId} not found.` });
      return;
    }
    json(res, 200, skill);
  });

  map.set('skills.save', async (_route, req, res) => {
    const raw = await readJsonBody(req);
    if (!raw || typeof raw !== 'object') {
      json(res, 400, { error: 'Invalid JSON body' });
      return;
    }
    const body = raw as unknown as SaveSkillInput;
    if (!body.id || typeof body.id !== 'string') {
      json(res, 400, { error: 'Skill ID is required and must be a string.' });
      return;
    }
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
    if (!raw || typeof raw !== 'object') {
      json(res, 400, { error: 'Invalid JSON body' });
      return;
    }
    const body = raw as unknown as DeleteSkillInput;
    if (!body.id || typeof body.id !== 'string') {
      json(res, 400, { error: 'Skill ID is required and must be a string.' });
      return;
    }
    try {
      const success = catalog.deleteSkill(body);
      await mountActiveSkillsForAgent({ workspacePath: body.workspacePath, catalog });
      json(res, 200, { success });
    } catch (err) {
      json(res, 400, { error: String(err) });
    }
  });

  map.set('skills.install', async (_route, req, res) => {
    const raw = await readJsonBody(req);
    if (!raw || typeof raw !== 'object') {
      json(res, 400, { error: 'Invalid JSON body' });
      return;
    }
    const body = raw as unknown as InstallSkillInput;
    if (!body.url || typeof body.url !== 'string') {
      json(res, 400, { error: 'Git URL is required and must be a string.' });
      return;
    }
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
    if (!raw || typeof raw !== 'object') {
      json(res, 400, { error: 'Invalid JSON body' });
      return;
    }
    const body = raw as unknown as InstallSkillBundleInput;
    if (!body.url || typeof body.url !== 'string') {
      json(res, 400, { error: 'Git URL is required and must be a string.' });
      return;
    }
    if (body.targetScope !== 'user' && body.targetScope !== 'workspace') {
      json(res, 400, { error: 'targetScope must be "user" or "workspace".' });
      return;
    }
    try {
      const result = await catalog.installSkillBundleFromGit(body);
      await mountActiveSkillsForAgent({ workspacePath: body.workspacePath, catalog });
      json(res, 200, result);
    } catch (err) {
      json(res, 400, { error: String(err) });
    }
  });

  map.set('skills.toggle', async (_route, req, res) => {
    const raw = await readJsonBody(req);
    if (!raw || typeof raw !== 'object') {
      json(res, 400, { error: 'Invalid JSON body' });
      return;
    }
    const body = raw as unknown as ToggleSkillInput;
    if (!body.id || typeof body.id !== 'string') {
      json(res, 400, { error: 'Skill ID is required and must be a string.' });
      return;
    }
    try {
      const success = catalog.toggleSkill(body);
      await mountActiveSkillsForAgent({ workspacePath: body.workspacePath, catalog });
      json(res, 200, { success });
    } catch (err) {
      json(res, 400, { error: String(err) });
    }
  });
}
