export type SkillScope = 'builtin' | 'user' | 'workspace';

export interface SkillMetadata {
  name?: string;
  description?: string;
  version?: string;
  author?: string;
  homepage?: string;
  triggers?: string[];
  [key: string]: unknown;
}

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  scope: SkillScope;
  path: string;
  enabled: boolean;
  overridden: boolean;
  overriddenBy?: SkillScope;
  metadata?: SkillMetadata;
}

export interface SkillDetail extends SkillInfo {
  content: string;
  helpers?: string[];
}

export interface SaveSkillInput {
  id: string;
  scope: 'user' | 'workspace';
  workspacePath?: string;
  content: string;
}

export interface InstallSkillInput {
  url: string;
  targetScope: 'user' | 'workspace';
  workspacePath?: string;
}

export interface DeleteSkillInput {
  id: string;
  scope: 'user' | 'workspace';
  workspacePath?: string;
}

export interface ToggleSkillInput {
  id: string;
  enabled: boolean;
  workspacePath?: string;
}
