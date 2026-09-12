export type RuleIntensityLevel = 'off' | 'lite' | 'full' | 'ultra';

export type RulePackScope = 'builtin' | 'user' | 'workspace';

export interface StandardRule {
  id: string;
  title: string;
  condition?: string; // Extracted from <important if="...">
  content: string;
  minIntensity: RuleIntensityLevel;
  isSafetyCarveOut: boolean; // Non-negotiable safety clause (retained in all intensities except 'off')
}

export interface StandardPackMetadata {
  id: string;
  name: string;
  language: string; // e.g. 'general', 'design-system', 'typescript', 'golang', 'python'
  description: string;
  version: string;
  author?: string;
  source?: RulePackScope | string;
  tags?: string[];
  rules?: StandardRule[];
  rawMarkdown?: string;
}

export interface StandardPackInfo {
  id: string;
  name: string;
  language: string;
  description: string;
  version: string;
  scope: RulePackScope;
  path?: string;
  enabled: boolean;
  intensity?: RuleIntensityLevel;
  ruleCount?: number;
  tags?: string[];
}

export interface WorkspaceStandardsConfig {
  enabled: boolean;
  intensity: RuleIntensityLevel; // 'off' | 'lite' | 'full' | 'ultra'
  activePacks: string[]; // Enabled pack IDs (e.g. ['general', 'typescript'])
  autoDetectStack?: boolean; // Auto-detect tech stack
  customRules?: string; // User-defined markdown rules (supports <important if>)
  targetFiles?: string[]; // Target files to materialize into (default: ['AGENTS.md', 'CLAUDE.md'])
  lastMaterializedAt?: string;
  lastContentHash?: string;
}

export interface MaterializeFileResult {
  filePath: string;
  targetFile: string;
  action: 'created' | 'updated' | 'unchanged' | 'cleaned';
  error?: string;
}

export interface MaterializeStandardsResult {
  workspaceId?: string;
  workspacePath: string;
  intensity: RuleIntensityLevel;
  appliedPacks: string[];
  files: MaterializeFileResult[];
  totalRules: number;
  tokenEstimate: number;
  warnings?: string[];
}

export interface InstallStandardPackInput {
  repoOrUrl: string;
  ref?: string;
  scope?: 'user' | 'workspace';
  workspacePath?: string;
  workspaceId?: string;
  force?: boolean;
}

export interface StandardPackScanFinding {
  id?: string;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  message: string;
  file: string;
  line?: number;
  snippet?: string;
}

export interface StandardPackScanReport {
  packId: string;
  passed: boolean;
  highestSeverity: 'critical' | 'high' | 'medium' | 'low' | 'info' | 'none';
  findings: StandardPackScanFinding[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info?: number;
  };
}

export interface DetectedTechStack {
  primaryLanguage?: string;
  languages: string[];
  frameworks: string[];
  detectedFiles: string[];
  recommendedPacks: string[];
}

export const DEFAULT_STANDARDS_INTENSITY: RuleIntensityLevel = 'full';
export const DEFAULT_STANDARDS_TARGET_FILES: readonly string[] = ['AGENTS.md', 'CLAUDE.md'] as const;
export const STANDARDS_MARKER_START = '<!-- agentdock:standards:start -->';
export const STANDARDS_MARKER_END = '<!-- agentdock:standards:end -->';
