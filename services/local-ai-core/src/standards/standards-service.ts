import { existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { atomicWriteFileSync } from '../kernel/atomic-write.js';
import { resolve, join, basename } from 'node:path';
import { homedir } from 'node:os';
import type {
  StandardPackMetadata,
  StandardPackInfo,
  StandardPackScanReport,
  WorkspaceStandardsConfig,
  MaterializeStandardsResult,
  RulePackScope,
} from '@cc/superai-contracts/standards';
import { DEFAULT_STANDARDS_TARGET_FILES, DEFAULT_STANDARDS_INTENSITY, DEFAULT_STANDARDS_ACTIVE_PACKS } from '@cc/superai-contracts/standards';
import type { DesktopProjectConfig, DesktopStandardsOptions } from '@cc/superai-contracts';
import {
  scanSkillContent,
  summarizeFindings,
  calculateHighestSeverity,
} from '../security/skill-content-scan.js';
import { CURATED_STANDARD_PACKS } from './curated-standards.js';
import { parseStandardPack } from './standards-rule-parser.js';
import { materializeWorkspaceStandards } from './standards-materializer.js';
import { detectWorkspaceTechStack } from './standards-detector.js';

export class StandardSecurityError extends Error {
  constructor(
    message: string,
    public readonly report: StandardPackScanReport,
  ) {
    super(message);
    this.name = 'StandardSecurityError';
  }
}

const VALID_PACK_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

function validatePackId(packId: string): string {
  const normalized = String(packId || '').trim();
  if (!normalized || !VALID_PACK_ID_REGEX.test(normalized) || normalized.includes('..')) {
    throw new Error(`Invalid standard pack id "${packId}". Pack IDs must contain only alphanumeric characters, underscores, and hyphens.`);
  }
  return normalized;
}

export interface StandardsServiceOptions {
  userStandardsDir?: string;
}

// Single mapping from the desktop project's snake_case standards options to
// the runtime WorkspaceStandardsConfig; callers previously duplicated this
// (with drifting targetFiles defaults) across handler and service code.
export function standardsConfigFromOptions(
  rawOptions?: DesktopStandardsOptions,
): WorkspaceStandardsConfig | undefined {
  if (!rawOptions) return undefined;
  return {
    enabled: rawOptions.enabled !== false,
    intensity: rawOptions.intensity || DEFAULT_STANDARDS_INTENSITY,
    activePacks: rawOptions.active_packs || [...DEFAULT_STANDARDS_ACTIVE_PACKS],
    autoDetectStack: rawOptions.auto_detect_stack !== false,
    customRules: rawOptions.custom_rules,
    targetFiles: rawOptions.target_files || [...DEFAULT_STANDARDS_TARGET_FILES],
  };
}

export class StandardsService {
  private readonly userStandardsDir: string;

  constructor(options: StandardsServiceOptions = {}) {
    this.userStandardsDir = resolve(options.userStandardsDir || join(homedir(), '.agentdock', 'standards'));
  }

  scanStandardPack(content: string, packId = 'rulepack'): StandardPackScanReport {
    const findings = scanSkillContent(content, `${packId}.md`);
    const summary = summarizeFindings(findings);
    const highestSeverity = calculateHighestSeverity(findings);
    const passed = summary.critical === 0 && summary.high === 0;

    return {
      packId,
      passed,
      highestSeverity: highestSeverity === 'none' ? 'none' : highestSeverity,
      findings: findings.map((f) => ({
        id: f.id,
        category: f.category,
        severity: f.severity,
        message: f.message,
        file: f.file,
        line: f.line,
        snippet: f.snippet,
      })),
      summary: {
        critical: summary.critical,
        high: summary.high,
        medium: summary.medium,
        low: summary.low,
      },
    };
  }

  listPacks(options: { workspacePath?: string; workspaceConfig?: WorkspaceStandardsConfig } = {}): StandardPackInfo[] {
    const packMap = new Map<string, StandardPackInfo>();

    // 1. Builtin curated packs
    for (const pack of CURATED_STANDARD_PACKS) {
      packMap.set(pack.id, {
        id: pack.id,
        name: pack.name,
        language: pack.language,
        description: pack.description,
        version: pack.version,
        scope: 'builtin',
        enabled: true,
        ruleCount: pack.rules?.length || 0,
        tags: pack.tags,
      });
    }

    // 2. User global packs (~/.agentdock/standards/)
    this.scanDirectoryPacks(this.userStandardsDir, 'user', packMap);

    // 3. Workspace local packs (<workspace>/.agentdock/standards/)
    if (options.workspacePath) {
      const workspaceStandardsDir = join(options.workspacePath, '.agentdock', 'standards');
      this.scanDirectoryPacks(workspaceStandardsDir, 'workspace', packMap);
    }

    const activeSet = options.workspaceConfig?.activePacks
      ? new Set(options.workspaceConfig.activePacks)
      : null;

    return Array.from(packMap.values()).map((p) => ({
      ...p,
      enabled: activeSet ? activeSet.has(p.id) : p.enabled,
      intensity: options.workspaceConfig?.intensity || DEFAULT_STANDARDS_INTENSITY,
    }));
  }

  getPackMetadata(packId: string, options: { workspacePath?: string } = {}): StandardPackMetadata | null {
    let safePackId: string;
    try {
      safePackId = validatePackId(packId);
    } catch {
      return null;
    }

    // 1. Check workspace
    if (options.workspacePath) {
      const wsFile = join(options.workspacePath, '.agentdock', 'standards', `${safePackId}.md`);
      if (existsSync(wsFile)) {
        return parseStandardPack(readFileSync(wsFile, 'utf8'));
      }
    }

    // 2. Check user
    const userFile = join(this.userStandardsDir, `${safePackId}.md`);
    if (existsSync(userFile)) {
      return parseStandardPack(readFileSync(userFile, 'utf8'));
    }

    // 3. Check builtin
    const builtin = CURATED_STANDARD_PACKS.find((p) => p.id === safePackId);
    if (builtin) return builtin;

    return null;
  }

  getAllPacksMetadata(options: { workspacePath?: string } = {}): StandardPackMetadata[] {
    const map = new Map<string, StandardPackMetadata>();
    for (const p of CURATED_STANDARD_PACKS) {
      map.set(p.id, p);
    }
    // user
    this.loadPacksFromDir(this.userStandardsDir, map);
    // workspace
    if (options.workspacePath) {
      this.loadPacksFromDir(join(options.workspacePath, '.agentdock', 'standards'), map);
    }
    return Array.from(map.values());
  }

  async installStandardPack(input: {
    repoOrUrl: string;
    scope?: 'user' | 'workspace';
    workspacePath?: string;
    rawContent?: string;
    force?: boolean;
  }): Promise<StandardPackInfo> {
    const rawContent = input.rawContent || '';
    if (!rawContent) {
      throw new Error('No content provided for standard pack installation.');
    }

    const tempParsed = parseStandardPack(rawContent);
    const packId = validatePackId(tempParsed.id || 'custom-pack');

    const report = this.scanStandardPack(rawContent, packId);
    if (!report.passed && !input.force) {
      throw new StandardSecurityError(
        `Standard pack "${packId}" contains high-risk findings and was blocked by security gate. Pass force: true to override.`,
        report,
      );
    }

    const targetDir =
      input.scope === 'workspace' && input.workspacePath
        ? join(input.workspacePath, '.agentdock', 'standards')
        : this.userStandardsDir;

    const filePath = join(targetDir, `${packId}.md`);
    atomicWriteFileSync(filePath, rawContent);

    return {
      id: packId,
      name: tempParsed.name,
      language: tempParsed.language,
      description: tempParsed.description,
      version: tempParsed.version,
      scope: input.scope === 'workspace' ? 'workspace' : 'user',
      path: filePath,
      enabled: true,
      ruleCount: tempParsed.rules?.length || 0,
      tags: tempParsed.tags,
    };
  }

  removeStandardPack(packId: string, options: { scope?: 'user' | 'workspace'; workspacePath?: string } = {}): boolean {
    let safePackId: string;
    try {
      safePackId = validatePackId(packId);
    } catch {
      return false;
    }

    const targetDir =
      options.scope === 'workspace' && options.workspacePath
        ? join(options.workspacePath, '.agentdock', 'standards')
        : this.userStandardsDir;

    const filePath = join(targetDir, `${safePackId}.md`);
    if (existsSync(filePath)) {
      try {
        unlinkSync(filePath);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  materialize(options: {
    workspacePath: string;
    workspaceId?: string;
    config?: WorkspaceStandardsConfig;
    unattended?: boolean;
    force?: boolean;
  }): MaterializeStandardsResult {
    if (options.config?.customRules && options.config.customRules.trim()) {
      const scan = this.scanStandardPack(options.config.customRules, 'custom-rules');
      if (!scan.passed && !options.force) {
        throw new StandardSecurityError(
          'Workspace custom rules contain high-risk findings and were blocked by the security gate. Pass force: true to override.',
          scan,
        );
      }
    }

    const allPacks = this.getAllPacksMetadata({ workspacePath: options.workspacePath });
    return materializeWorkspaceStandards({
      workspacePath: options.workspacePath,
      workspaceId: options.workspaceId,
      config: options.config,
      packs: allPacks,
      unattended: options.unattended,
    });
  }

  ensureWorkspaceMaterialized(workspacePath: string, project?: DesktopProjectConfig): MaterializeStandardsResult | null {
    const rawOptions = project?.agent?.options?.standards;
    if (!rawOptions || rawOptions.enabled === false) {
      return null;
    }

    return this.materialize({
      workspacePath,
      workspaceId: project?.workspace_id || project?.name,
      config: standardsConfigFromOptions(rawOptions),
    });
  }

  private scanDirectoryPacks(dir: string, scope: RulePackScope, map: Map<string, StandardPackInfo>) {
    this.forEachPackFileInDir(dir, (meta, filePath) => {
      map.set(meta.id, {
        id: meta.id,
        name: meta.name,
        language: meta.language,
        description: meta.description,
        version: meta.version,
        scope,
        path: filePath,
        enabled: true,
        ruleCount: meta.rules?.length || 0,
        tags: meta.tags,
      });
    });
  }

  private loadPacksFromDir(dir: string, map: Map<string, StandardPackMetadata>) {
    this.forEachPackFileInDir(dir, (meta) => {
      map.set(meta.id, meta);
    });
  }

  // Later callers overwrite earlier map entries, which is what gives
  // workspace-scope packs precedence over user-scope packs with the same id.
  private forEachPackFileInDir(dir: string, visit: (meta: StandardPackMetadata, filePath: string) => void): void {
    if (!existsSync(dir)) return;
    try {
      const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
      for (const file of files) {
        try {
          const filePath = join(dir, file);
          visit(parseStandardPack(readFileSync(filePath, 'utf8')), filePath);
        } catch {
          // ignore corrupt pack files
        }
      }
    } catch {
      // ignore readdir errors
    }
  }
}
