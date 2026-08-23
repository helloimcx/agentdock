import type {
  SkillInfo,
  SkillDetail,
  SkillSource,
  SaveSkillInput,
  InstallSkillInput,
  InstallSkillBundleInput,
  InstallSkillBundleResult,
  DeleteSkillInput,
  ToggleSkillInput,
  UpdateSkillInput,
  UpdateSkillResult,
  VerifySkillResult,
  SkillScanReport,
  SkillSecurityAuditResult,
} from '@cc/superai-contracts/skills';
import { coreRequest } from './request.js';

export function listSkills(workspacePath?: string) {
  const query = workspacePath ? `?workspacePath=${encodeURIComponent(workspacePath)}` : '';
  return coreRequest<{ skills: SkillInfo[] }>('GET', `/skills${query}`);
}

export function getSkill(skillId: string, workspacePath?: string) {
  const query = workspacePath ? `?workspacePath=${encodeURIComponent(workspacePath)}` : '';
  return coreRequest<SkillDetail>('GET', `/skills/${encodeURIComponent(skillId)}${query}`);
}

export function saveSkill(input: SaveSkillInput) {
  return coreRequest<SkillInfo>('POST', '/skills', input);
}

export function deleteSkill(input: DeleteSkillInput) {
  return coreRequest<{ success: boolean }>('DELETE', '/skills', input);
}

export function installSkill(input: InstallSkillInput) {
  return coreRequest<SkillInfo>('POST', '/skills/install', input);
}

export function installSkillBundle(input: InstallSkillBundleInput) {
  return coreRequest<InstallSkillBundleResult>('POST', '/skills/install-bundle', input);
}

export function addSkill(input: InstallSkillInput) {
  return coreRequest<{ installed: SkillInfo[]; skipped: string[]; source?: SkillSource }>('POST', '/skills/add', input);
}

export function updateSkill(input: UpdateSkillInput) {
  return coreRequest<UpdateSkillResult>('POST', '/skills/update', input);
}

export function verifySkills(options: { workspacePath?: string; skillId?: string } = {}) {
  const params = new URLSearchParams();
  if (options.workspacePath) params.set('workspacePath', options.workspacePath);
  if (options.skillId) params.set('skillId', options.skillId);
  const query = params.toString() ? `?${params.toString()}` : '';
  return coreRequest<VerifySkillResult>('GET', `/skills/verify${query}`);
}

export function listSkillSources(options: { workspacePath?: string } = {}) {
  const query = options.workspacePath ? `?workspacePath=${encodeURIComponent(options.workspacePath)}` : '';
  return coreRequest<{ sources: SkillSource[] }>('GET', `/skills/sources${query}`);
}

export function toggleSkill(input: ToggleSkillInput) {
  return coreRequest<{ success: boolean }>('POST', '/skills/toggle', input);
}

export function scanSkill(skillId: string, options: { workspacePath?: string; workspaceId?: string } = {}) {
  const params = new URLSearchParams();
  params.set('skillId', skillId);
  if (options.workspacePath) params.set('workspacePath', options.workspacePath);
  if (options.workspaceId) params.set('workspaceId', options.workspaceId);
  return coreRequest<{ report: SkillScanReport }>('GET', `/skills/scan?${params.toString()}`);
}

export function scanAllSkills(options: { workspacePath?: string; workspaceId?: string } = {}) {
  const params = new URLSearchParams();
  if (options.workspacePath) params.set('workspacePath', options.workspacePath);
  if (options.workspaceId) params.set('workspaceId', options.workspaceId);
  const query = params.toString() ? `?${params.toString()}` : '';
  return coreRequest<SkillSecurityAuditResult>('GET', `/skills/scan${query}`);
}

export function scanSkillContent(input: { content: string; name?: string; id?: string }) {
  return coreRequest<{ report: SkillScanReport }>('POST', '/skills/scan', input);
}


