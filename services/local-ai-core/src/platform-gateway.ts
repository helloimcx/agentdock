import type { DesktopConnectConfig, DesktopProjectConfig } from '../../../shared/desktop.js';

export type PlatformGatewayBinding = {
  workspaceId: string;
  platformType: string;
  adapter: 'cc-connect';
};

export interface PlatformIngressAdapter {
  id: string;
  listBindings(config: DesktopConnectConfig | null | undefined): PlatformGatewayBinding[];
  hasBindings(project: DesktopProjectConfig | null | undefined): boolean;
}

export function hasPlatformGatewayBindings(project: DesktopProjectConfig | null | undefined) {
  return Array.isArray(project?.platforms) && project.platforms.some((platform) => {
    const type = String(platform?.type || '').trim();
    return Boolean(type);
  });
}

export class CcConnectPlatformGatewayAdapter implements PlatformIngressAdapter {
  readonly id = 'cc-connect';

  listBindings(config: DesktopConnectConfig | null | undefined): PlatformGatewayBinding[] {
    const projects = Array.isArray(config?.projects) ? config!.projects! : [];
    return projects.flatMap((project) => {
      if (!hasPlatformGatewayBindings(project)) {
        return [];
      }
      return (project.platforms || [])
        .map((platform) => String(platform?.type || '').trim())
        .filter(Boolean)
        .map((platformType) => ({
          workspaceId: project.name,
          platformType,
          adapter: this.id,
        }));
    });
  }

  hasBindings(project: DesktopProjectConfig | null | undefined) {
    return hasPlatformGatewayBindings(project);
  }
}
