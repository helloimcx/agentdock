import type { DesktopConnectConfig, DesktopProjectConfig, WorkspaceRegistryEntry } from '@cc/superai-contracts';
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

export function listRegistryProjects(store: Pick<LocalCoreAcpStore, 'listWorkspaceRegistry'>) {
  return store.listWorkspaceRegistry()
    .map(projectFromEntry)
    .filter((project): project is DesktopProjectConfig => Boolean(project));
}

export function persistProjectsInRegistry(
  store: Pick<LocalCoreAcpStore, 'listWorkspaceRegistry' | 'upsertWorkspaceRegistryEntry' | 'deleteWorkspaceRegistryEntry'>,
  projects: DesktopProjectConfig[],
  options: { preserveLegacyIds?: boolean } = {},
) {
  const existing = store.listWorkspaceRegistry();
  const managed = existing.filter((entry) => (entry.metadata as ProjectMetadata | undefined)?.source === PROJECT_SOURCE);
  const byDisplayName = new Map(managed.map((entry) => [entry.displayName, entry]));
  const retainedIds = new Set<string>();

  const normalized = projects.map((project) => {
    const existingByName = byDisplayName.get(project.name);
    const workspaceId = projectWorkspaceId(project)
      || existingByName?.workspaceId
      || project.name;
    const nextProject: DesktopProjectConfig = { ...project, workspace_id: workspaceId };
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

export function withoutRuntimeProjects(config: DesktopConnectConfig): DesktopConnectConfig {
  const next = { ...config };
  delete next.projects;
  return next;
}

function projectFromEntry(entry: WorkspaceRegistryEntry): DesktopProjectConfig | null {
  const project = (entry.metadata as ProjectMetadata | undefined)?.project;
  if (!project?.agent) return null;
  return {
    ...project,
    workspace_id: entry.workspaceId,
    name: entry.displayName,
  };
}
