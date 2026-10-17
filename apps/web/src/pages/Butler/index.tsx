import { useTranslation } from 'react-i18next';
import { ChevronDown, ConciergeBell, RefreshCw } from 'lucide-react';
import { Badge, Button, EmptyState, PageHeader } from '@/components/ui';
import ButlerTaskCard from './ButlerTaskCard';
import ButlerSetupCard from './ButlerSetupCard';
import { orderButlerTasks } from './butler-page-model';
import { useButlerPage } from './useButlerPage';
import type { ButlerTask, WorkspaceSummary } from '@cc/superai-contracts';

interface ButlerProgressProps {
  tasks: ButlerTask[];
  workspaces: WorkspaceSummary[];
  busy: boolean;
  onFollowup: ReturnType<typeof useButlerPage>['followup'];
  onCancel: ReturnType<typeof useButlerPage>['cancel'];
  onComplete: ReturnType<typeof useButlerPage>['complete'];
}

function ButlerProgress({ tasks, workspaces, busy, onFollowup, onCancel, onComplete }: ButlerProgressProps) {
  const { t } = useTranslation();
  return <details className="group rounded-xl border border-border/70 bg-card/50">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
      <span className="flex min-w-0 items-center gap-2"><ConciergeBell size={17} className="shrink-0 text-muted-foreground" /><span className="font-medium">{t('butler.progress')}</span><Badge variant="secondary">{tasks.length}</Badge></span>
      <ChevronDown size={17} className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
    </summary>
    <section className="space-y-3 border-t border-border/70 px-4 py-4" aria-label={t('butler.progress')}>
    <p className="text-sm text-muted-foreground">{t('butler.progressHint')}</p>
    {tasks.length ? orderButlerTasks(tasks).map((task) => <ButlerTaskCard key={task.id} task={task} workspaces={workspaces} busy={busy} onFollowup={onFollowup} onCancel={onCancel} onComplete={onComplete} />) : <EmptyState icon={ConciergeBell} message={t('butler.empty')} />}
    </section>
  </details>;
}

export default function ButlerPage() {
  const { t } = useTranslation();
  const page = useButlerPage();
  return <div className="space-y-5 animate-fade-in">
    <PageHeader title={t('butler.title')} description={t('butler.description')} actions={<Button variant="secondary" disabled={page.busy} onClick={() => void page.reload()}><RefreshCw size={16} />{t('butler.refresh')}</Button>} />
    {page.error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{page.error}</div>}
    {page.loading ? <div className="p-8 text-center text-muted-foreground animate-pulse">{t('common.loading')}</div> : <>
      <ButlerSetupCard profile={page.profile} bots={page.bots} workspaces={page.workspaces} busy={page.busy} onConfigure={page.configure} />
      {page.profile && <ButlerProgress tasks={page.tasks} workspaces={page.workspaces} busy={page.busy} onFollowup={page.followup} onCancel={page.cancel} onComplete={page.complete} />}
    </>}
  </div>;
}
