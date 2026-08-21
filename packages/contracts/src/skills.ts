export type SkillScope = 'builtin' | 'user' | 'workspace';

export type SkillSourceStatus = 'clean' | 'locally-modified' | 'missing';

export interface SkillSource {
  skillId: string;
  scope: SkillScope;
  workspaceId?: string;
  workspacePath?: string;
  sourceRepo: string;
  sourceRef?: string;
  sourceType?: 'github' | 'git';
  contentHash: string;
  installedAt: string;
  status?: SkillSourceStatus;
}

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
  source?: SkillSource;
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
  id?: string;
  url?: string;
  repo?: string;
  ref?: string;
  skillsDir?: string;
  targetScope: 'user' | 'workspace';
  workspacePath?: string;
  workspaceId?: string;
  force?: boolean;
}

export interface InstallSkillBundleInput {
  url: string;
  /** Subdirectory inside the repo containing per-skill folders. Defaults to 'skills'. */
  skillsDir?: string;
  targetScope: 'user' | 'workspace';
  workspacePath?: string;
  workspaceId?: string;
  ref?: string;
  repo?: string;
}

export interface InstallSkillBundleResult {
  installed: SkillInfo[];
  skipped: string[];
}

export interface UpdateSkillInput {
  id?: string;
  all?: boolean;
  force?: boolean;
  workspacePath?: string;
  workspaceId?: string;
}

export interface UpdateSkillResult {
  updated: SkillInfo[];
  unchanged: string[];
  conflicts: Array<{ id: string; reason: string }>;
}

export interface VerifySkillItem {
  id: string;
  name: string;
  scope: SkillScope;
  sourceRepo: string;
  sourceRef?: string;
  status: SkillSourceStatus;
  path: string;
}

export interface VerifySkillResult {
  skills: VerifySkillItem[];
}

export interface DeleteSkillInput {
  id: string;
  scope: 'user' | 'workspace';
  workspacePath?: string;
  workspaceId?: string;
}

export interface ToggleSkillInput {
  id: string;
  enabled: boolean;
  workspacePath?: string;
}

export interface CuratedSkillPack {
  id: string;
  repo: string;
  name: string;
  description: string;
  stars: string;
  skillsCount?: number;
  tags: string[];
  defaultRef?: string;
}

