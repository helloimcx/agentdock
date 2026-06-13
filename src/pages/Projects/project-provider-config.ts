import type { DesktopConnectConfig } from '../../../shared/desktop';

function cloneConfig(config: DesktopConnectConfig): DesktopConnectConfig {
  return JSON.parse(JSON.stringify(config || {})) as DesktopConnectConfig;
}

export function getProjectProviderId(config: DesktopConnectConfig | null | undefined, projectName: string) {
  const project = config?.projects?.find((entry) => entry.name === projectName);
  return String(project?.agent?.options?.provider_id || '');
}

export function selectProjectProvider(
  config: DesktopConnectConfig,
  projectName: string,
  providerId: string,
): DesktopConnectConfig {
  const next = cloneConfig(config);
  const projects = Array.isArray(next.projects) ? next.projects : [];
  const index = projects.findIndex((entry) => entry.name === projectName);
  if (index < 0) {
    throw new Error(`Project not found in config: ${projectName}`);
  }
  const project = projects[index];
  projects[index] = {
    ...project,
    agent: {
      ...project.agent,
      options: {
        ...(project.agent?.options || {}),
        provider_id: providerId,
      },
    },
  };
  next.projects = projects;
  return next;
}

export function selectProjectModel(
  config: DesktopConnectConfig,
  projectName: string,
  model: string,
): DesktopConnectConfig {
  const next = cloneConfig(config);
  const projects = Array.isArray(next.projects) ? next.projects : [];
  const index = projects.findIndex((entry) => entry.name === projectName);
  if (index < 0) {
    throw new Error(`Project not found in config: ${projectName}`);
  }
  const project = projects[index];
  projects[index] = {
    ...project,
    agent: {
      ...project.agent,
      options: {
        ...(project.agent?.options || {}),
        model,
      },
    },
  };
  next.projects = projects;
  return next;
}

export function removeProviderReferences(
  config: DesktopConnectConfig,
  providerId: string,
): DesktopConnectConfig {
  const next = cloneConfig(config);
  const projects = Array.isArray(next.projects) ? next.projects : [];
  next.projects = projects.map((project) => {
    if (project.agent?.options?.provider_id !== providerId) {
      return project;
    }
    return {
      ...project,
      agent: {
        ...project.agent,
        options: {
          ...(project.agent?.options || {}),
          provider_id: '',
        },
      },
    };
  });
  return next;
}
