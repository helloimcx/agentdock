import { Bot, Cloud, FolderKanban, Plug, Plus, Trash2 } from 'lucide-react';
import { Button, EmptyState, SectionCard } from '@/components/ui';
import type { DesktopProjectConfig } from '../../../shared/desktop';
import { workDirLabel, type SandboxForm } from './workspace-model';

type ProjectListPanelProps = {
  projects: DesktopProjectConfig[];
  selectedIndex: number;
  onAddProject: () => void;
  onSelectProject: (index: number, project: DesktopProjectConfig) => void;
  onRemoveProject: (index: number, project: DesktopProjectConfig) => void;
};

export function ProjectListPanel({
  projects,
  selectedIndex,
  onAddProject,
  onSelectProject,
  onRemoveProject,
}: ProjectListPanelProps) {
  return (
    <SectionCard
      title="项目"
      actions={<Button size="sm" onClick={onAddProject}><Plus size={14} /> 新建项目</Button>}
      className="app-panel lg:self-start"
    >
      {projects.length === 0 ? (
        <EmptyState message="还没有项目。" />
      ) : (
        <div className="space-y-2">
          {projects.map((project, index) => (
            <div
              key={`${project.name}-${index}`}
              className={`flex items-center justify-between gap-2 ${
                index === selectedIndex
                  ? 'app-list-row app-list-row-active'
                  : 'app-list-row'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectProject(index, project)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate text-sm font-medium text-slate-950 dark:text-white">{project.name || `Project ${index + 1}`}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {project.agent?.type || 'unknown'} · {workDirLabel(project)} · {project.platforms?.length || 0} platforms
                </p>
              </button>
              <Button
                variant="ghost"
                size="sm"
                className="app-icon-button shrink-0"
                onClick={() => onRemoveProject(index, project)}
                aria-label={`Remove ${project.name}`}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

type ProjectOverviewCardsProps = {
  project: DesktopProjectConfig;
  sandbox: SandboxForm;
};

export function ProjectOverviewCards({ project, sandbox }: ProjectOverviewCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
      <div className="app-surface p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Bot size={14} /> Agent</div>
        <p className="mt-2 truncate text-sm font-semibold text-foreground">{project.agent?.type || 'unknown'}</p>
      </div>
      <div className="app-surface p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><FolderKanban size={14} /> Workspace</div>
        <p className="mt-2 truncate text-sm font-semibold text-foreground">{workDirLabel(project)}</p>
      </div>
      <div className="app-surface p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Plug size={14} /> Platforms</div>
        <p className="mt-2 truncate text-sm font-semibold text-foreground">{project.platforms?.length || 0} configured</p>
      </div>
      <div className="app-surface p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Cloud size={14} /> Sandbox</div>
        <p className="mt-2 truncate text-sm font-semibold text-foreground">{sandbox.enabled ? 'Cloud enabled' : 'Local runtime'}</p>
      </div>
    </div>
  );
}
