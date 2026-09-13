import type {
  RuleIntensityLevel,
  RulePackScope,
  StandardRule,
  StandardPackMetadata,
  StandardPackInfo,
  WorkspaceStandardsConfig,
  MaterializeStandardsResult,
  StandardPackScanReport,
} from '@cc/superai-contracts/standards';

export interface RenderStandardsOptions {
  intensity: RuleIntensityLevel;
  packs: StandardPackMetadata[];
  customRules?: string;
  unattended?: boolean;
}

export interface DetectedTechStack {
  primaryLanguage?: string;
  languages: string[];
  frameworks: string[];
  detectedFiles: string[];
  recommendedPacks: string[];
}
