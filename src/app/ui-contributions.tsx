import type { ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  Clock,
  FileCode,
  FolderKanban,
  LayoutDashboard,
  Library,
  MessageSquare,
  MessagesSquare,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Settings,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { useAuthStore } from '@/store/auth';
import Dashboard from '@/pages/Dashboard';
import ThreadChat from '@/pages/Threads/ThreadChat';
import WebChat from '@/pages/Web/Chat';
import DesktopWorkspace from '@/pages/Desktop/Workspace';
import ProjectList from '@/pages/Projects/ProjectList';
import ProjectDetail from '@/pages/Projects/ProjectDetail';
import SessionList from '@/pages/Sessions/SessionList';
import SessionChat from '@/pages/Sessions/SessionChat';
import CronList from '@/pages/Cron/CronList';
import SystemConfig from '@/pages/System/Config';
import SystemLogs from '@/pages/System/Logs';
import KnowledgeHome from '@/pages/Knowledge/KnowledgeHome';
import KnowledgeDetail from '@/pages/Knowledge/KnowledgeDetail';
import type { RuntimeFeatureSupport } from '@/app/runtime';
import type { LocalCorePluginDiagnostics } from '../../packages/contracts/src';

export type UiContributionContext = {
  desktopManaged: boolean;
  features: RuntimeFeatureSupport;
};

export type UiRouteContribution = {
  id: string;
  path?: string;
  index?: boolean;
  titleKey: string;
  order: number;
  element: (context: UiContributionContext) => ReactNode;
};

export type UiNavContribution = {
  id: string;
  path: string;
  labelKey: string;
  icon: LucideIcon;
  order: number;
  end?: boolean;
  visible?: (context: UiContributionContext) => boolean;
  resolveLabelKey?: (context: UiContributionContext & { runtimeProvider: string }) => string;
};

export type SystemSettingsPanelContext = {
  t: (key: string) => string;
  config: unknown;
  loading: boolean;
  actionMsg: string;
  pluginDiagnostics: LocalCorePluginDiagnostics | null;
  onReload: () => void;
  onRestart: () => void;
  onTogglePlugin: (pluginId: string, enabled: boolean) => void;
};

export type UiSettingsPanelContribution = {
  id: string;
  titleKey: string;
  order: number;
  render: (context: SystemSettingsPanelContext) => ReactNode;
};

class RendererUiContributionRegistry {
  private readonly routes = new Map<string, UiRouteContribution>();
  private readonly navItems = new Map<string, UiNavContribution>();
  private readonly settingsPanels = new Map<string, UiSettingsPanelContribution>();

  registerRoute(contribution: UiRouteContribution) {
    this.routes.set(contribution.id, contribution);
  }

  registerNavItem(contribution: UiNavContribution) {
    this.navItems.set(contribution.id, contribution);
  }

  registerSettingsPanel(contribution: UiSettingsPanelContribution) {
    this.settingsPanels.set(contribution.id, contribution);
  }

  listRoutes() {
    return [...this.routes.values()].sort((a, b) => a.order - b.order);
  }

  listNavItems() {
    return [...this.navItems.values()].sort((a, b) => a.order - b.order);
  }

  listSettingsPanels() {
    return [...this.settingsPanels.values()].sort((a, b) => a.order - b.order);
  }
}

function guarded(allowed: boolean, element: ReactNode, redirect = '/') {
  return allowed ? element : <Navigate to={redirect} replace />;
}

function DesktopProjectRedirect() {
  const { name } = useParams<{ name: string }>();
  const desktopManaged = useAuthStore((s) => s.desktopManaged);
  if (!desktopManaged) {
    return <ProjectDetail />;
  }
  return <Navigate to={name ? `/workspace?project=${encodeURIComponent(name)}` : '/workspace'} replace />;
}

function DesktopSessionsRedirect() {
  const { project, id } = useParams<{ project?: string; id?: string }>();
  const desktopManaged = useAuthStore((s) => s.desktopManaged);
  if (!desktopManaged) {
    return id && project ? <SessionChat /> : <SessionList />;
  }

  const query = new URLSearchParams();
  if (project) {
    query.set('project', project);
  }
  if (id) {
    query.set('session', id);
  }
  return <Navigate to={`/chat${query.toString() ? `?${query.toString()}` : ''}`} replace />;
}

function registerBuiltinRoutes(registry: RendererUiContributionRegistry) {
  const routes: UiRouteContribution[] = [
    {
      id: 'dashboard',
      index: true,
      titleKey: 'nav.dashboard',
      order: 10,
      element: () => <Dashboard />,
    },
    {
      id: 'chat',
      path: 'chat',
      titleKey: 'nav.chat',
      order: 20,
      element: ({ features }) => guarded(
        features.chatRoute,
        features.desktopChat ? <ThreadChat /> : <WebChat />,
      ),
    },
    {
      id: 'workspace',
      path: 'workspace',
      titleKey: 'nav.workspace',
      order: 30,
      element: ({ features }) => guarded(features.desktopWorkspace, <DesktopWorkspace />),
    },
    {
      id: 'knowledge',
      path: 'knowledge',
      titleKey: 'nav.knowledge',
      order: 40,
      element: ({ features }) => guarded(features.knowledgeModule, <KnowledgeHome />),
    },
    {
      id: 'knowledge-detail',
      path: 'knowledge/:knowledgebaseId',
      titleKey: 'nav.knowledge',
      order: 41,
      element: ({ features }) => guarded(features.knowledgeModule, <KnowledgeDetail />),
    },
    {
      id: 'projects',
      path: 'projects',
      titleKey: 'nav.projects',
      order: 50,
      element: ({ desktopManaged, features }) =>
        desktopManaged && features.desktopWorkspace
          ? <Navigate to="/workspace" replace />
          : <ProjectList />,
    },
    {
      id: 'project-detail',
      path: 'projects/:name',
      titleKey: 'nav.projects',
      order: 51,
      element: () => <DesktopProjectRedirect />,
    },
    {
      id: 'sessions',
      path: 'sessions',
      titleKey: 'nav.sessions',
      order: 60,
      element: () => <DesktopSessionsRedirect />,
    },
    {
      id: 'session-detail',
      path: 'sessions/:project/:id',
      titleKey: 'nav.sessions',
      order: 61,
      element: () => <DesktopSessionsRedirect />,
    },
    {
      id: 'cron',
      path: 'cron',
      titleKey: 'nav.cron',
      order: 70,
      element: ({ features }) => guarded(features.schedulerModule, <CronList />),
    },
    {
      id: 'system',
      path: 'system',
      titleKey: 'nav.system',
      order: 80,
      element: () => <SystemConfig />,
    },
    {
      id: 'system-logs',
      path: 'system/logs',
      titleKey: 'nav.system',
      order: 81,
      element: () => <SystemLogs />,
    },
  ];
  routes.forEach((route) => registry.registerRoute(route));
}

function registerBuiltinNavItems(registry: RendererUiContributionRegistry) {
  const navItems: UiNavContribution[] = [
    { id: 'dashboard', path: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard, order: 10, end: true },
    {
      id: 'chat',
      path: '/chat',
      labelKey: 'nav.chat',
      icon: MessagesSquare,
      order: 20,
      visible: ({ features }) => features.chatRoute,
      resolveLabelKey: ({ features, runtimeProvider }) =>
        !features.desktopChat
          ? 'nav.chatWeb'
          : runtimeProvider === 'electron'
            ? 'nav.chatDesktop'
            : 'nav.chat',
    },
    {
      id: 'workspace',
      path: '/workspace',
      labelKey: 'nav.workspace',
      icon: Wrench,
      order: 30,
      visible: ({ features }) => features.desktopWorkspace,
    },
    {
      id: 'knowledge',
      path: '/knowledge',
      labelKey: 'nav.knowledge',
      icon: Library,
      order: 40,
      visible: ({ features }) => features.knowledgeModule,
    },
    {
      id: 'projects',
      path: '/projects',
      labelKey: 'nav.projects',
      icon: FolderKanban,
      order: 50,
      visible: ({ desktopManaged }) => !desktopManaged,
    },
    {
      id: 'sessions',
      path: '/sessions',
      labelKey: 'nav.sessions',
      icon: MessageSquare,
      order: 60,
      visible: ({ desktopManaged }) => !desktopManaged,
    },
    {
      id: 'cron',
      path: '/cron',
      labelKey: 'nav.cron',
      icon: Clock,
      order: 70,
      visible: ({ features }) => features.schedulerModule,
    },
    { id: 'system', path: '/system', labelKey: 'nav.system', icon: Settings, order: 80 },
  ];
  navItems.forEach((item) => registry.registerNavItem(item));
}

function registerBuiltinSettingsPanels(registry: RendererUiContributionRegistry) {
  registry.registerSettingsPanel({
    id: 'system-actions',
    titleKey: 'system.actions',
    order: 10,
    render: ({ t, onReload, onRestart }) => (
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={onReload}><RefreshCw size={16} /> {t('system.reload')}</Button>
        <Button variant="danger" onClick={onRestart}><RotateCcw size={16} /> {t('system.restart')}</Button>
        <Link to="/system/logs">
          <Button variant="secondary"><ScrollText size={16} /> {t('system.logs')}</Button>
        </Link>
      </div>
    ),
  });
  registry.registerSettingsPanel({
    id: 'system-action-message',
    titleKey: 'system.actionMessage',
    order: 20,
    render: ({ actionMsg }) => actionMsg ? (
      <div className="text-sm text-accent bg-accent/10 border border-accent/20 rounded-lg px-4 py-2">
        {actionMsg}
      </div>
    ) : null,
  });
  registry.registerSettingsPanel({
    id: 'system-config',
    titleKey: 'system.config',
    order: 30,
    render: ({ t, config, loading }) => (
      <Card>
        <div className="flex items-center gap-2 mb-3">
          <FileCode size={16} className="text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('system.config')}</h3>
        </div>
        {loading ? (
          <div className="text-gray-400 animate-pulse text-sm">Loading...</div>
        ) : (
          <pre className="text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4 overflow-auto max-h-[60vh] font-mono">
            {JSON.stringify(config, null, 2)}
          </pre>
        )}
      </Card>
    ),
  });
  registry.registerSettingsPanel({
    id: 'system-plugins',
    titleKey: 'system.plugins',
    order: 40,
    render: ({ t, pluginDiagnostics, onTogglePlugin }) => (
      <Card>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('system.plugins')}</h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {pluginDiagnostics
                ? `${pluginDiagnostics.enabledPluginCount}/${pluginDiagnostics.pluginCount} enabled`
                : 'Loading...'}
            </p>
          </div>
        </div>
        <div className="space-y-2">
          {(pluginDiagnostics?.plugins || []).map((plugin) => (
            <div
              key={plugin.pluginId}
              className="rounded-2xl border border-gray-200 dark:border-white/[0.08] px-4 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-gray-900 dark:text-white break-all">{plugin.pluginId}</p>
                    <span className="rounded-full bg-gray-100 dark:bg-white/[0.06] px-2 py-0.5 text-[11px] text-gray-600 dark:text-gray-300">
                      {plugin.manifest.kind}
                    </span>
                    <span
                      className={[
                        'rounded-full px-2 py-0.5 text-[11px]',
                        plugin.health.status === 'healthy'
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                          : plugin.health.status === 'degraded'
                            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-300'
                            : 'bg-red-500/10 text-red-600 dark:text-red-300',
                      ].join(' ')}
                    >
                      {plugin.health.status}
                    </span>
                  </div>
                  {plugin.health.summary && (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{plugin.health.summary}</p>
                  )}
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    {plugin.manifest.provides.join(', ') || 'No declared capabilities'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onTogglePlugin(plugin.pluginId, !plugin.enabled)}
                  className={[
                    'shrink-0 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors',
                    plugin.enabled
                      ? 'bg-accent/15 text-gray-900 dark:text-white hover:bg-accent/25'
                      : 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/[0.1]',
                  ].join(' ')}
                >
                  {plugin.enabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    ),
  });
}

export const rendererUiContributions = new RendererUiContributionRegistry();

registerBuiltinRoutes(rendererUiContributions);
registerBuiltinNavItems(rendererUiContributions);
registerBuiltinSettingsPanels(rendererUiContributions);

export function resolveRouteTitleKey(
  pathname: string,
  context: UiContributionContext & { runtimeProvider: string },
) {
  const matchedRoute = rendererUiContributions
    .listRoutes()
    .filter((route) => route.path)
    .map((route) => ({
      route,
      absolutePath: `/${route.path?.replace(/:[^/]+/g, '') || ''}`.replace(/\/+$/, ''),
    }))
    .filter(({ absolutePath }) => pathname.startsWith(absolutePath || '/'))
    .sort((a, b) => b.absolutePath.length - a.absolutePath.length)[0]?.route;

  if (matchedRoute?.id === 'chat') {
    return !context.features.desktopChat
      ? 'nav.chatWeb'
      : context.runtimeProvider === 'electron'
        ? 'nav.chatDesktop'
        : 'nav.chat';
  }
  return matchedRoute?.titleKey || 'nav.dashboard';
}
