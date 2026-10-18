import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CheckCheck, Send } from 'lucide-react';
import type { ButlerDelegation, ButlerTask, WorkspaceSummary } from '@cc/superai-contracts';
import { Badge, Button, Card, Textarea } from '@/components/ui';
import { butlerChatHref, canCancelButlerTask, canCompleteButlerTask, canFollowupButlerTask } from './butler-page-model';

type Props = {
  task: ButlerTask;
  workspaces: WorkspaceSummary[];
  busy: boolean;
  onFollowup: (task: ButlerTask, delegationId: string, content: string) => Promise<boolean>;
  onCancel: (task: ButlerTask) => Promise<boolean>;
  onComplete: (task: ButlerTask, summary: string) => Promise<boolean>;
};

function ButlerStatus({ status }: { status: string }) {
  const { t } = useTranslation();
  const variant = status === 'completed' ? 'success' : status === 'failed' ? 'danger'
    : ['waiting_for_user', 'reviewing'].includes(status) ? 'warning' : 'secondary';
  return <Badge variant={variant}>{t(`butler.status.${status}`)}</Badge>;
}

function DelegationCard({ delegation, task, workspaces, busy, onFollowup }: Pick<Props, 'task' | 'workspaces' | 'busy' | 'onFollowup'> & { delegation: ButlerDelegation }) {
  const { t } = useTranslation();
  const [content, setContent] = useState('');
  const workspace = workspaces.find((entry) => entry.id === delegation.workspaceId);
  const canFollowup = canFollowupButlerTask(task) && !task.cancellationRequested && delegation.status !== 'cancelled';
  const submit = async () => { if (await onFollowup(task, delegation.id, content.trim())) setContent(''); };
  return <div className="rounded-lg border border-border bg-background/50 p-4 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0"><p className="font-medium break-words">{delegation.title}</p><p className="text-xs text-muted-foreground">{delegation.targetBot.displayName} · {workspace?.name || delegation.workspaceId}{workspace?.agentType ? ` · ${workspace.agentType}` : ''}</p></div>
      <ButlerStatus status={delegation.status} />
    </div>
    {delegation.summary && <p className="text-sm whitespace-pre-wrap break-words">{delegation.summary}</p>}
    {delegation.error && <p className="text-sm text-destructive whitespace-pre-wrap break-words">{delegation.error}</p>}
    {delegation.status === 'waiting_for_user' && <p className="text-sm text-amber-600 dark:text-amber-400">{t('butler.approvalHint')}</p>}
    {delegation.pendingFollowups.length > 0 && <p className="text-xs text-muted-foreground">{t('butler.followupQueued', { count: delegation.pendingFollowups.length })}</p>}
    {delegation.threadId && <Button asChild variant="secondary" size="sm"><Link to={butlerChatHref(delegation.workspaceId, delegation.threadId)}><ArrowUpRight size={14} />{t(delegation.status === 'waiting_for_user' ? 'butler.handleDecision' : 'butler.openAgent')}</Link></Button>}
    {canFollowup && <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <Textarea aria-label={t('butler.followup')} placeholder={t('butler.followupPlaceholder')} value={content} onChange={(event) => setContent(event.target.value)} disabled={busy} rows={2} />
      <Button type="submit" variant="ghost" size="sm" disabled={busy || !content.trim()}><Send size={14} />{t('butler.followup')}</Button>
    </form>}
  </div>;
}

export default function ButlerTaskCard(props: Props) {
  const { t } = useTranslation();
  const { task, busy } = props;
  const [summary, setSummary] = useState('');
  return <Card className="app-panel space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1"><h3 className="font-semibold text-lg break-words">{task.title}</h3>{task.completionCriteria && <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{task.completionCriteria}</p>}<p className="mt-2 text-xs text-muted-foreground">{t('butler.updatedAt')}: {new Date(task.updatedAt).toLocaleString()}</p></div>
      <ButlerStatus status={task.status} />
    </div>
    {task.summary && <p className="text-sm whitespace-pre-wrap break-words">{task.summary}</p>}
    {task.error && <p className="text-sm text-destructive whitespace-pre-wrap break-words">{task.error}</p>}
    {task.cancellationRequested && <p className="text-sm text-muted-foreground">{t('butler.cancelling')}</p>}
    <div className="grid gap-3 lg:grid-cols-2">{task.delegations.map((delegation) => <DelegationCard key={delegation.id} {...props} delegation={delegation} />)}</div>
    {canCompleteButlerTask(task) && <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
      <p className="text-sm">{t('butler.reviewHint')}</p>
      <Textarea aria-label={t('butler.acceptanceSummary')} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder={t('butler.acceptanceSummary')} disabled={busy} rows={2} />
      <Button size="sm" disabled={busy || !summary.trim()} onClick={() => void props.onComplete(task, summary.trim())}><CheckCheck size={14} />{t('butler.accept')}</Button>
    </div>}
    {canCancelButlerTask(task) && <Button size="sm" variant="ghost" disabled={busy || task.cancellationRequested} onClick={() => void props.onCancel(task)}>{t('butler.cancel')}</Button>}
  </Card>;
}
