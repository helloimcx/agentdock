import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { resolve, dirname, basename, join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import type {
  RuleIntensityLevel,
  WorkspaceStandardsConfig,
  MaterializeFileResult,
  MaterializeStandardsResult,
  StandardPackMetadata,
} from '@cc/superai-contracts/standards';
import {
  STANDARDS_MARKER_START,
  STANDARDS_MARKER_END,
  DEFAULT_STANDARDS_TARGET_FILES,
} from '@cc/superai-contracts/standards';
import { renderStandardsContent } from './standards-rule-parser.js';
import { CURATED_STANDARD_PACKS } from './curated-standards.js';

const MARKER_REGEX = new RegExp(`${STANDARDS_MARKER_START}[\\s\\S]*?${STANDARDS_MARKER_END}`);

function atomicWriteFileSync(filePath: string, content: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tempPath, content, 'utf8');
  try {
    renameSync(tempPath, filePath);
  } catch (err) {
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch {
      // ignore cleanup error
    }
    throw err;
  }
}

function resolveSafeTargetFilePath(workspacePath: string, filename: string): string {
  const trimmed = filename.trim();
  const base = basename(trimmed);
  if (base !== trimmed || trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error(`Target file "${filename}" is invalid or attempts path traversal.`);
  }
  const fullPath = resolve(workspacePath, base);
  const normalizedRoot = resolve(workspacePath);
  const boundary = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
  if (!fullPath.startsWith(boundary)) {
    throw new Error(`Target file "${filename}" escapes workspace root.`);
  }
  return fullPath;
}

function computeSha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function applyMaterializationToFile(
  filePath: string,
  renderedContent: string,
  intensity: RuleIntensityLevel,
): MaterializeFileResult {
  const targetFile = basename(filePath);
  const fileExists = existsSync(filePath);

  if (intensity === 'off') {
    if (!fileExists) {
      return { filePath, targetFile, action: 'unchanged' };
    }
    const existing = readFileSync(filePath, 'utf8');
    if (!MARKER_REGEX.test(existing)) {
      return { filePath, targetFile, action: 'unchanged' };
    }
    const cleaned = existing.replace(MARKER_REGEX, () => '').trim();
    if (!cleaned) {
      try {
        unlinkSync(filePath);
        return { filePath, targetFile, action: 'cleaned' };
      } catch {
        // ignore delete failure
      }
    }
    atomicWriteFileSync(filePath, cleaned ? `${cleaned}\n` : '');
    return { filePath, targetFile, action: 'cleaned' };
  }

  // Active intensity (lite, full, ultra)
  const managedBlock = [
    STANDARDS_MARKER_START,
    '<!-- Managed by AgentDock Workspace Standards Layer. DO NOT EDIT INSIDE THIS BLOCK. -->',
    renderedContent.trim(),
    STANDARDS_MARKER_END,
  ].join('\n');

  if (!fileExists) {
    const initialContent = [
      '# Agent Guidelines & Workspace Instructions',
      '',
      '> Workspace coding guidelines managed by AgentDock.',
      '> User-defined instructions can be added freely above or below the managed standards block.',
      '',
      managedBlock,
      '',
    ].join('\n');
    atomicWriteFileSync(filePath, initialContent);
    return { filePath, targetFile, action: 'created' };
  }

  const existing = readFileSync(filePath, 'utf8');
  let nextContent = '';

  if (MARKER_REGEX.test(existing)) {
    nextContent = existing.replace(MARKER_REGEX, () => managedBlock);
  } else {
    // Preserve 100% of user existing content, append marker cleanly at end
    const trimmedUserContent = existing.trimEnd();
    nextContent = trimmedUserContent
      ? `${trimmedUserContent}\n\n${managedBlock}\n`
      : `${managedBlock}\n`;
  }

  if (computeSha256(existing) === computeSha256(nextContent)) {
    return { filePath, targetFile, action: 'unchanged' };
  }

  atomicWriteFileSync(filePath, nextContent);
  return { filePath, targetFile, action: 'updated' };
}

export function materializeWorkspaceStandards(options: {
  workspacePath: string;
  workspaceId?: string;
  config?: WorkspaceStandardsConfig;
  packs?: StandardPackMetadata[];
  unattended?: boolean;
}): MaterializeStandardsResult {
  const { workspacePath, workspaceId, config, packs = CURATED_STANDARD_PACKS, unattended } = options;
  const intensity = config?.intensity || 'full';
  const activePackIds = new Set(config?.activePacks || ['general']);
  const activePacks = packs.filter((p) => activePackIds.has(p.id));

  const rendered = renderStandardsContent({
    intensity,
    packs: activePacks,
    customRules: config?.customRules,
    unattended,
  });

  const targetFilenames = config?.targetFiles && config.targetFiles.length > 0
    ? config.targetFiles
    : DEFAULT_STANDARDS_TARGET_FILES;

  const fileResults: MaterializeFileResult[] = [];
  for (const filename of targetFilenames) {
    const fullPath = resolveSafeTargetFilePath(workspacePath, filename);
    const result = applyMaterializationToFile(fullPath, rendered, intensity);
    fileResults.push(result);
  }

  const totalRules = activePacks.reduce((acc, p) => acc + (p.rules?.length || 0), 0);
  const tokenEstimate = Math.round(rendered.length / 3.5);

  return {
    workspaceId,
    workspacePath,
    intensity,
    appliedPacks: activePacks.map((p) => p.id),
    files: fileResults,
    totalRules,
    tokenEstimate,
  };
}
