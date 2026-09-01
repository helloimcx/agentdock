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

export interface SkillRoutingRule {
  skillId: string;
  priority?: number;
  patterns?: string[];
  keywords?: string[];
  domains?: string[];
  negativePatterns?: string[];
  requiredGroups?: string[][];
  requiresTools?: string[];
}

export interface SkillMetadata {
  name?: string;
  description?: string;
  version?: string;
  author?: string;
  homepage?: string;
  triggers?: string[];
  domains?: string[];
  priority?: number;
  requiresTools?: string[];
  rules?: SkillRoutingRule[];
  [key: string]: unknown;
}

export interface SkillRouteMatch {
  skillId: string;
  name: string;
  score: number;
  matchedRules: string[];
  requiresTools: string[];
  missingTools: string[];
  available: boolean;
}

export interface SkillRouteResult {
  query: string;
  matches: SkillRouteMatch[];
  selectedSkills: SkillRouteMatch[];
}

export interface SkillRouteInput {
  query: string;
  workspacePath?: string;
  workspaceId?: string;
  maxMatches?: number;
}

export type SkillScanSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type SkillScanCategory =
  | 'T01_INSTRUCTION_HIJACK'
  | 'T02_MEMORY_POISONING'
  | 'T03_REMOTE_PAYLOAD'
  | 'T04_MALICIOUS_CODE'
  | 'T05_PRIVILEGE_ESCALATION'
  | 'T06_PERSISTENCE'
  | 'T07_TOOL_HIJACK'
  | 'T08_INSECURE_DEPENDENCIES'
  | 'T09_INSECURE_PRACTICES'
  | 'SCAN_LIMIT_EXCEEDED';

export interface SkillScanFinding {
  id: string;
  category: SkillScanCategory;
  severity: SkillScanSeverity;
  message: string;
  snippet?: string;
  file: string;
  line?: number;
}

export interface SkillScanSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface SkillScanReport {
  skillId: string;
  scope?: SkillScope;
  path?: string;
  scannedAt: string;
  passed: boolean;
  highestSeverity?: SkillScanSeverity | 'none';
  findings: SkillScanFinding[];
  summary: SkillScanSummary;
}

export interface SkillSecurityAuditResult {
  totalSkills: number;
  passedSkills: number;
  failedSkills: number;
  highestSeverity: SkillScanSeverity | 'none';
  reports: SkillScanReport[];
  summary: SkillScanSummary;
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
  scanReport?: SkillScanReport;
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

