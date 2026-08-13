import type {
  SkillInfo,
  SkillDetail,
  SaveSkillInput,
  InstallSkillInput,
  InstallSkillBundleInput,
  InstallSkillBundleResult,
  DeleteSkillInput,
  ToggleSkillInput,
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

export function toggleSkill(input: ToggleSkillInput) {
  return coreRequest<{ success: boolean }>('POST', '/skills/toggle', input);
}
