import { lazy, type ReactNode } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import {
  Activity,
  Cpu,
  FolderKanban,
  LayoutDashboard,
  Library,
  MessageSquare,
  MessagesSquare,
  Settings,
  Sparkles,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { RuntimeFeatureSupport } from '@/app/runtime';

const Dashboard = lazy(() => import('@/pages/Dashboard'));
const ThreadChat = lazy(() => import('@/pages/Threads/ThreadChat'));
const DesktopWorkspace = lazy(() => import('@/pages/Desktop/Workspace'));
const ProvidersPage = lazy(() => import('@/pages/Providers'));
const AutomationList = lazy(() => import('@/pages/Automation/AutomationList'));
const SystemConfig = lazy(() => import('@/pages/System/Config'));
const SystemLogs = lazy(() => import('@/pages/System/Logs'));
const KnowledgeHome = lazy(() => import('@/pages/Knowledge/KnowledgeHome'));
const KnowledgeDetail = lazy(() => import('@/pages/Knowledge/KnowledgeDetail'));
const SkillsPage = lazy(() => import('@/pages/Skills/SkillsPage'));

export type UiContributionContext = {
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
  resolveLabelKey?: (context: UiContributionContext) => string;
};

class RendererUiContributionRegistry {
  private readonly routes = new Map<string, UiRouteContribution>();
  private readonly navItems = new Map<string, UiNavContribution>();

  registerRoute(contribution: UiRouteContribution) {
    this.routes.set(contribution.id, contribution);
  }

  registerNavItem(contribution: UiNavContribution) {
    this.navItems.set(contribution.id, contribution);
  }

  listRoutes() {
    return [...this.routes.values()].sort((a, b) => a.order - b.order);
  }

  listNavItems() {
    return [...this.navItems.values()].sort((a, b) => a.order - b.order);
  }

}

function guarded(allowed: boolean, element: ReactNode, redirect = '/') {
  return allowed ? element : <Navigate to={redirect} replace />;
}

function WorkspaceRedirect() {
  const { name } = useParams<{ name: string }>();
  return <Navigate to={name ? `/workspace?project=${encodeURIComponent(name)}` : '/workspace'} replace />;
}

function DesktopSessionsRedirect() {
  const { project, id } = useParams<{ project?: string; id?: string }>();
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
        <ThreadChat />,
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
      id: 'providers',
      path: 'providers',
      titleKey: 'nav.providers',
      order: 35,
      element: ({ features }) => guarded(features.desktopWorkspace, <ProvidersPage />),
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
      id: 'skills',
      path: 'skills',
      titleKey: 'nav.skills',
      order: 42,
      element: () => <SkillsPage />,
    },
    {
      id: 'projects',
      path: 'projects',
      titleKey: 'nav.projects',
      order: 50,
      element: ({ features }) => guarded(features.desktopWorkspace, <Navigate to="/workspace" replace />),
    },
    {
      id: 'project-detail',
      path: 'projects/:name',
      titleKey: 'nav.projects',
      order: 51,
      element: () => <WorkspaceRedirect />,
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
      id: 'automations',
      path: 'automations',
      titleKey: 'nav.automations',
      order: 70,
      element: ({ features }) => guarded(features.schedulerModule || features.monitorModule, <AutomationList />),
    },
    {
      id: 'cron-legacy',
      path: 'cron',
      titleKey: 'nav.automations',
      order: 71,
      element: ({ features }) => guarded(features.schedulerModule || features.monitorModule, <Navigate to="/automations?origin=scheduled-job" replace />),
    },
    {
      id: 'monitors-legacy',
      path: 'monitors',
      titleKey: 'nav.automations',
      order: 72,
      element: ({ features }) => guarded(features.schedulerModule || features.monitorModule, <Navigate to="/automations?origin=automation-monitor" replace />),
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
      resolveLabelKey: ({ features }) => features.desktopChat ? 'nav.chat' : 'nav.chatWeb',
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
      id: 'providers',
      path: '/providers',
      labelKey: 'nav.providers',
      icon: Cpu,
      order: 35,
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
      id: 'skills',
      path: '/skills',
      labelKey: 'nav.skills',
      icon: Sparkles,
      order: 42,
    },
    {
      id: 'projects',
      path: '/projects',
      labelKey: 'nav.projects',
      icon: FolderKanban,
      order: 50,
      visible: () => false,
    },
    {
      id: 'sessions',
      path: '/sessions',
      labelKey: 'nav.sessions',
      icon: MessageSquare,
      order: 60,
      visible: () => false,
    },
    {
      id: 'automations',
      path: '/automations',
      labelKey: 'nav.automations',
      icon: Activity,
      order: 70,
      visible: ({ features }) => features.schedulerModule || features.monitorModule,
    },
    { id: 'system', path: '/system', labelKey: 'nav.system', icon: Settings, order: 80 },
  ];
  navItems.forEach((item) => registry.registerNavItem(item));
}

export const rendererUiContributions = new RendererUiContributionRegistry();

registerBuiltinRoutes(rendererUiContributions);
registerBuiltinNavItems(rendererUiContributions);

export function resolveRouteTitleKey(
  pathname: string,
  context: UiContributionContext,
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
    return context.features.desktopChat ? 'nav.chat' : 'nav.chatWeb';
  }
  return matchedRoute?.titleKey || 'nav.dashboard';
}
