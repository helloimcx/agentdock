import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import type { ManagedSkillCatalog } from './managed-skill-catalog.js';
import { mountActiveSkillsSync } from './skill-mounter.js';

export const MESH_SHADOW_META_FILENAME = '.mesh-shadow.json';

export interface MeshShadowMeta {
  nodeId?: string;
  platform?: string;
  workspaceId?: string;
  workspacePath?: string;
}

/** Converts a workspace ID to a filesystem-safe directory name. */
export function toSafeWorkspaceId(rawWorkspaceId: string): string {
  return rawWorkspaceId.replace(/[^a-zA-Z0-9_.-]/g, '_').replace(/^\.+/, '') || 'workspace';
}

/**
 * Resolves the durable workspace skills root directory for a mesh session.
 * Prioritizes a host-configured workspace folder if it exists and contains skills roots.
 * Otherwise falls back to durable core storage `{baseDir}/workspace-skills/{safeWorkspaceId}/`.
 */
export function resolveMeshWorkspaceSkillsPath(
  baseDir: string,
  safeWorkspaceId: string,
  configuredWorkDir?: string,
): string {
  if (configuredWorkDir && existsSync(configuredWorkDir) && !configuredWorkDir.includes('remote-shadow')) {
    const hasSkills = existsSync(join(configuredWorkDir, '.agentdock', 'skills'))
      || existsSync(join(configuredWorkDir, '.agents', 'skills'))
      || existsSync(join(configuredWorkDir, '.agents'));
    if (hasSkills) {
      return configuredWorkDir;
    }
  }

  const persistentDir = resolve(baseDir, 'workspace-skills', safeWorkspaceId);
  mkdirSync(persistentDir, { recursive: true });
  return persistentDir;
}

export interface RefreshMeshShadowOptions {
  baseDir?: string;
  workspaceId?: string;
  workspacePath?: string;
  catalog?: ManagedSkillCatalog;
}

function resolveShadowTargetDirs(shadowRoot: string, safeTargetWorkspaceId?: string): string[] {
  if (safeTargetWorkspaceId) {
    const targetDir = join(shadowRoot, safeTargetWorkspaceId);
    return existsSync(targetDir) ? [targetDir] : [];
  }
  try {
    return readdirSync(shadowRoot)
      .map((entry) => join(shadowRoot, entry))
      .filter((dirPath) => {
        try {
          return statSync(dirPath).isDirectory();
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

function readShadowMeta(shadowDir: string): MeshShadowMeta {
  const metaPath = join(shadowDir, MESH_SHADOW_META_FILENAME);
  if (existsSync(metaPath)) {
    try {
      const data = JSON.parse(readFileSync(metaPath, 'utf8'));
      if (data && typeof data === 'object') return data as MeshShadowMeta;
    } catch {
      // Best-effort metadata read
    }
  }
  return {};
}

function remountSingleShadowDirectory(
  shadowDir: string,
  baseDir: string,
  meta: MeshShadowMeta,
  fallbackWorkspacePath?: string,
  catalog?: ManagedSkillCatalog,
): void {
  const safeWsId = meta.workspaceId || basename(shadowDir);
  const platform = meta.platform || 'unknown';
  const resolvedWsPath = meta.workspacePath
    || fallbackWorkspacePath
    || resolveMeshWorkspaceSkillsPath(baseDir, safeWsId);

  try {
    mountActiveSkillsSync({
      targetDir: join(shadowDir, '.agents', 'skills'),
      workspacePath: resolvedWsPath,
      platform,
      catalog,
    });
    mountActiveSkillsSync({
      targetDir: join(shadowDir, '.claude', 'skills'),
      workspacePath: resolvedWsPath,
      platform,
      catalog,
    });
  } catch {
    // Best-effort shadow remount
  }
}

/**
 * Refreshes mesh shadow mounts (`.agents/skills` and `.claude/skills`) when skills are mutated.
 * If `workspaceId` is given, only the matching shadow directory is refreshed.
 * Otherwise (e.g. for user-scoped skill mutations), all shadow directories are refreshed.
 */
export function refreshMeshShadowSkillMounts(options: RefreshMeshShadowOptions): void {
  if (!options.baseDir) return;
  const shadowRoot = join(options.baseDir, 'remote-shadow');
  if (!existsSync(shadowRoot)) return;

  const safeTargetWorkspaceId = options.workspaceId ? toSafeWorkspaceId(options.workspaceId) : undefined;
  const targetDirs = resolveShadowTargetDirs(shadowRoot, safeTargetWorkspaceId);

  for (const shadowDir of targetDirs) {
    const meta = readShadowMeta(shadowDir);
    remountSingleShadowDirectory(
      shadowDir,
      options.baseDir,
      meta,
      options.workspacePath,
      options.catalog,
    );
  }
}
