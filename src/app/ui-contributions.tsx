import { lazy, type ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  Clock,
  Bell,
  FolderKanban,
  LayoutDashboard,
  Library,
  MessageSquare,
  MessagesSquare,
  Settings,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import type { RuntimeFeatureSupport } from '@/app/runtime';

const Dashboard = lazy(() => import('@/pages/Dashboard'));
const ThreadChat = lazy(() => import('@/pages/Threads/ThreadChat'));
const WebChat = lazy(() => import('@/pages/Web/Chat'));
const DesktopWorkspace = lazy(() => import('@/pages/Desktop/Workspace'));
const ProjectList = lazy(() => import('@/pages/Projects/ProjectList'));
const ProjectDetail = lazy(() => import('@/pages/Projects/ProjectDetail'));
const SessionList = lazy(() => import('@/pages/Sessions/SessionList'));
const SessionChat = lazy(() => import('@/pages/Sessions/SessionChat'));
const CronList = lazy(() => import('@/pages/Cron/CronList'));
const MonitorList = lazy(() => import('@/pages/Automation/MonitorList'));
const SystemConfig = lazy(() => import('@/pages/System/Config'));
const SystemLogs = lazy(() => import('@/pages/System/Logs'));
const KnowledgeHome = lazy(() => import('@/pages/Knowledge/KnowledgeHome'));
const KnowledgeDetail = lazy(() => import('@/pages/Knowledge/KnowledgeDetail'));

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
      id: 'monitors',
      path: 'monitors',
      titleKey: 'nav.monitors',
      order: 71,
      element: ({ features }) => guarded(features.monitorModule, <MonitorList />),
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
    {
      id: 'monitors',
      path: '/monitors',
      labelKey: 'nav.monitors',
      icon: Bell,
      order: 71,
      visible: ({ features }) => features.monitorModule,
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
