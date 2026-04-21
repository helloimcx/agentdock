import type { DesktopConnectConfig, DesktopProjectConfig } from '../../../../shared/desktop.js';
import { normalizeDesktopPlatformType } from '../../../../shared/desktop.js';

export type PlatformGatewayBinding = {
  workspaceId: string;
  platformType: string;
  adapter: 'cc-connect' | 'localcore-lark';
};

export interface PlatformIngressAdapter {
  id: string;
  listBindings(config: DesktopConnectConfig | null | undefined): PlatformGatewayBinding[];
  hasBindings(project: DesktopProjectConfig | null | undefined): boolean;
}

export function hasPlatformGatewayBindings(project: DesktopProjectConfig | null | undefined) {
  return Array.isArray(project?.platforms) && project.platforms.some((platform) => {
    const type = normalizeDesktopPlatformType(platform?.type);
    return Boolean(type);
  });
}

export function hasNativeLarkBindings(project: DesktopProjectConfig | null | undefined) {
  return Array.isArray(project?.platforms) && project.platforms.some((platform) => normalizeDesktopPlatformType(platform?.type) === 'lark');
}

export function hasCcConnectPlatformBindings(project: DesktopProjectConfig | null | undefined) {
  return Array.isArray(project?.platforms) && project.platforms.some((platform) => {
    const type = normalizeDesktopPlatformType(platform?.type);
    return Boolean(type) && type !== 'lark';
  });
}

export class CcConnectPlatformGatewayAdapter implements PlatformIngressAdapter {
  readonly id = 'cc-connect';

  listBindings(config: DesktopConnectConfig | null | undefined): PlatformGatewayBinding[] {
    const projects = Array.isArray(config?.projects) ? config!.projects! : [];
    return projects.flatMap((project) => {
      if (!hasCcConnectPlatformBindings(project)) {
        return [];
      }
      return (project.platforms || [])
        .map((platform) => normalizeDesktopPlatformType(platform?.type))
        .filter((platformType) => platformType !== 'lark')
        .filter(Boolean)
        .map((platformType) => ({
          workspaceId: project.name,
          platformType,
          adapter: this.id,
        }));
    });
  }

  hasBindings(project: DesktopProjectConfig | null | undefined) {
    return hasCcConnectPlatformBindings(project);
  }
}

export class LocalCoreLarkGatewayAdapter implements PlatformIngressAdapter {
  readonly id = 'localcore-lark';

  listBindings(config: DesktopConnectConfig | null | undefined): PlatformGatewayBinding[] {
    const projects = Array.isArray(config?.projects) ? config!.projects! : [];
    return projects.flatMap((project) => {
      if (!hasNativeLarkBindings(project)) {
        return [];
      }
      return (project.platforms || [])
        .map((platform) => normalizeDesktopPlatformType(platform?.type))
        .filter((platformType) => platformType === 'lark')
        .filter(Boolean)
        .map((platformType) => ({
          workspaceId: project.name,
          platformType,
          adapter: this.id,
        }));
    });
  }

  hasBindings(project: DesktopProjectConfig | null | undefined) {
    return hasNativeLarkBindings(project);
  }
}
