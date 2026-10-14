import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bot, ConciergeBell, MessageCircle, RefreshCw } from 'lucide-react';
import { Button, Card, EmptyState, PageHeader } from '@/components/ui';
import ButlerTaskCard from './ButlerTaskCard';
import ButlerSetupCard from './ButlerSetupCard';
import { butlerChatHref, orderButlerTasks } from './butler-page-model';
import { useButlerPage } from './useButlerPage';
import type { ButlerProfile, ButlerTask, ButlerBotEndpoint, WorkspaceSummary } from '@cc/superai-contracts';

interface ButlerProfileCardProps {
  profile: ButlerProfile;
  managerBot: ButlerBotEndpoint;
  workspaceName: string;
  busy: boolean;
  onEdit: () => void;
}

function ButlerProfileCard({ profile, managerBot, workspaceName, busy, onEdit }: ButlerProfileCardProps) {
  const { t } = useTranslation();
  return <Card className="app-panel space-y-4 border-primary/25">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
      <div><h2 className="flex items-center gap-2 text-lg font-semibold"><ConciergeBell size={22} className="text-primary" />{t('butler.talkTitle')}</h2><p className="mt-2 text-sm text-muted-foreground">{t('butler.talkHint')}</p><p className="mt-1 text-xs text-muted-foreground">{managerBot.displayName} · {workspaceName}</p></div>
      <Button asChild size="lg"><Link to={butlerChatHref(profile.workspaceId, profile.threadId)}><MessageCircle size={18} />{t('butler.openChat')}</Link></Button>
    </div>
    <div className="flex flex-wrap gap-2" aria-label={t('butler.managedBots')}>
      {profile.managedBots.map((bot) => <span className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-sm" key={bot.id}><Bot size={14} />{bot.displayName}</span>)}
    </div>
    <p className="rounded-lg bg-primary/5 p-3 text-sm">{t('butler.example')}</p>
    <Button variant="link" size="sm" disabled={busy} onClick={onEdit}>{t('butler.changeBots')}</Button>
  </Card>;
}

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
  return <section className="space-y-3" aria-label={t('butler.progress')}>
    <h2 className="text-lg font-semibold">{t('butler.progress')}</h2>
    <p className="text-sm text-muted-foreground">{t('butler.progressHint')}</p>
    {tasks.length ? orderButlerTasks(tasks).map((task) => <ButlerTaskCard key={task.id} task={task} workspaces={workspaces} busy={busy} onFollowup={onFollowup} onCancel={onCancel} onComplete={onComplete} />) : <EmptyState icon={ConciergeBell} message={t('butler.empty')} />}
  </section>;
}

export default function ButlerPage() {
  const { t } = useTranslation();
  const page = useButlerPage();
  const [configuring, setConfiguring] = useState(false);
  const managerBot = page.bots.find((bot) => bot.id === page.profile?.managerBot.id) || page.profile?.managerBot;
  const currentWorkspace = page.workspaces.find((workspace) => workspace.id === page.profile?.workspaceId);
  const configure = async (managerBotId: string, managedBots: Array<{ botId: string; sharedChatId: string }>) => {
    if (await page.configure(managerBotId, managedBots)) setConfiguring(false);
  };
  return <div className="space-y-5 animate-fade-in">
    <PageHeader title={t('butler.title')} description={t('butler.description')} actions={<Button variant="secondary" disabled={page.busy} onClick={() => void page.reload()}><RefreshCw size={16} />{t('butler.refresh')}</Button>} />
    {page.error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{page.error}</div>}
    {page.loading ? <div className="p-8 text-center text-muted-foreground animate-pulse">{t('common.loading')}</div> : <>
      {page.profile && managerBot && <ButlerProfileCard profile={page.profile} managerBot={managerBot} workspaceName={currentWorkspace?.name || page.profile.workspaceId} busy={page.busy} onEdit={() => setConfiguring((value) => !value)} />}
      {(!page.profile || configuring) && <ButlerSetupCard profile={page.profile} bots={page.bots} busy={page.busy} onConfigure={configure} />}
      {page.profile && <ButlerProgress tasks={page.tasks} workspaces={page.workspaces} busy={page.busy} onFollowup={page.followup} onCancel={page.cancel} onComplete={page.complete} />}
    </>}
  </div>;
}
