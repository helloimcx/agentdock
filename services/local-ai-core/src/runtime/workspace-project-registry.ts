import type { DesktopProjectConfig } from '@cc/superai-contracts';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';

const PROJECT_SOURCE = 'runtime-project';

type ProjectMetadata = {
  source?: string;
  project?: DesktopProjectConfig;
  [key: string]: unknown;
};

export function projectWorkspaceId(project: DesktopProjectConfig) {
  return String(project.workspace_id || '').trim();
}

export function workspacePathFromProject(project: DesktopProjectConfig) {
  const options = project.agent?.options || {};
  for (const key of ['work_dir', 'workDir', 'cwd', 'path', 'workspacePath', 'root']) {
    const value = options[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/**
 * Assign a stable `workspace_id` to every project, reusing the id previously
 * registered under the same display name when the project does not carry one.
 */
export function normalizeWorkspaceIds(
  store: Pick<LocalCoreAcpStore, 'listWorkspaceRegistry'>,
  projects: DesktopProjectConfig[],
): DesktopProjectConfig[] {
  const existing = store.listWorkspaceRegistry();
  const byDisplayName = new Map(existing.map((entry) => [entry.displayName, entry]));
  return projects.map((project) => {
    const existingByName = byDisplayName.get(project.name);
    const workspaceId = projectWorkspaceId(project)
      || existingByName?.workspaceId
      || project.name;
    return { ...project, workspace_id: workspaceId };
  });
}

/**
 * Reconcile the workspace registry so it mirrors the projects from the
 * runtime configuration (the single source of truth stored in SQLite).
 *
 * The registry is a derived read-model: it is written only from here and
 * serves the desktop workspace list and workspace path lookups. Projects that
 * are no longer in the config are removed from the registry.
 */
export function syncWorkspaceRegistry(
  store: Pick<LocalCoreAcpStore, 'listWorkspaceRegistry' | 'upsertWorkspaceRegistryEntry' | 'deleteWorkspaceRegistryEntry'>,
  projects: DesktopProjectConfig[],
): DesktopProjectConfig[] {
  const existing = store.listWorkspaceRegistry();
  const managed = existing.filter((entry) => (entry.metadata as ProjectMetadata | undefined)?.source === PROJECT_SOURCE);
  const retainedIds = new Set<string>();

  const normalized = normalizeWorkspaceIds(store, projects).map((nextProject) => {
    const workspaceId = String(nextProject.workspace_id || '').trim();
    const previous = existing.find((entry) => entry.workspaceId === workspaceId);
    const path = workspacePathFromProject(nextProject);
    retainedIds.add(workspaceId);
    store.upsertWorkspaceRegistryEntry({
      workspaceId,
      displayName: nextProject.name,
      path,
      deviceId: previous?.deviceId || 'local',
      defaultRuntimeId: nextProject.agent?.type,
      git: previous?.git,
      health: previous?.health,
      metadata: {
        ...(previous?.metadata || {}),
        source: PROJECT_SOURCE,
        project: nextProject,
      },
    });
    return nextProject;
  });

  for (const entry of managed) {
    if (!retainedIds.has(entry.workspaceId)) store.deleteWorkspaceRegistryEntry(entry.workspaceId);
  }
  return normalized;
}
