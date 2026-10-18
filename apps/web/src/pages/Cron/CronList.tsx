import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Plus } from 'lucide-react';
import { subscribeEvents } from '@cc/core-sdk/runtime';
import {
  createScheduledJob as createCronJob,
  deleteScheduledJob as deleteCronJob,
  listScheduledJobs as listCronJobs,
  runScheduledJob as runCronJobNow,
  updateScheduledJob as updateCronJob,
} from '@cc/core-sdk/scheduler';
import { listWorkspaces } from '@cc/core-sdk/threads';
import type { ScheduledJob as CronJob, ScheduledJobCreateInput as CronJobCreateInput } from '@cc/superai-contracts';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, RowActions, Select, Textarea } from '@/components/ui';
import { formatTime } from '@/lib/utils';

type SchedulerFormState = {
  workspaceId: string;
  platform: string;
  channelId: string;
  executionMode: 'same-thread' | 'side-thread';
  triggerType: 'cron' | 'once';
  cronExpr: string;
  runAt: string;
  promptTemplate: string;
  description: string;
  platformUserId: string;
  threadId: string;
  enabled: boolean;
};

const DEFAULT_FORM: SchedulerFormState = {
  workspaceId: '',
  platform: 'local',
  channelId: '',
  executionMode: 'same-thread',
  triggerType: 'cron',
  cronExpr: '0 9 * * *',
  runAt: '',
  promptTemplate: '',
  description: '',
  platformUserId: '',
  threadId: '',
  enabled: true,
};

function isoToLocalDateTimeInput(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '';
  const tzOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
}

function localDateTimeInputToIso(localStr: string): string | undefined {
  if (!localStr) return undefined;
  const date = new Date(localStr);
  if (isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function toForm(job?: CronJob | null): SchedulerFormState {
  if (!job) {
    return DEFAULT_FORM;
  }
  return {
    workspaceId: job.workspaceId,
    platform: job.platform || 'local',
    channelId: job.route.channelId || '',
    executionMode: job.executionMode as SchedulerFormState['executionMode'],
    triggerType: job.triggerType as SchedulerFormState['triggerType'],
    cronExpr: job.cronExpr || '0 9 * * *',
    runAt: isoToLocalDateTimeInput(job.runAt),
    promptTemplate: job.promptTemplate,
    description: job.description,
    platformUserId: job.route.participantId || '',
    threadId: job.route.threadId || '',
    enabled: job.enabled,
  };
}

function toPayload(form: SchedulerFormState): CronJobCreateInput {
  const platform = form.platform || 'local';
  const parsedRunAt = form.triggerType === 'once' ? localDateTimeInputToIso(form.runAt) : undefined;
  return {
    workspaceId: form.workspaceId,
    platform,
    channelId: form.channelId || (platform === 'local' ? (form.workspaceId || 'local') : ''),
    route: {
      type: platform === 'local' ? 'local.thread' : 'channel.chat',
      channelId: form.channelId || (platform === 'local' ? (form.workspaceId || 'local') : ''),
      ...(form.platformUserId ? { participantId: form.platformUserId } : {}),
      ...(form.threadId ? { threadId: form.threadId } : {}),
    },
    executionMode: form.executionMode || 'same-thread',
    triggerType: form.triggerType,
    ...(form.triggerType === 'cron'
      ? { cronExpr: form.cronExpr, runAt: undefined }
      : { runAt: parsedRunAt, cronExpr: undefined }),
    promptTemplate: form.promptTemplate,
    description: form.description,
    enabled: form.enabled,
  };
}

export default function CronList() {
  const { t } = useTranslation();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string }>>([]);
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);
  const [form, setForm] = useState<SchedulerFormState>(DEFAULT_FORM);

  const selectedWorkspaceOptions = useMemo(
    () => workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>),
    [workspaces],
  );

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const [jobData, workspaceData] = await Promise.all([listCronJobs(), listWorkspaces().then((data) => data.workspaces)]);
      setJobs(jobData.jobs || []);
      setWorkspaces(workspaceData);
      setForm((current) => {
        if (current.workspaceId || workspaceData.length === 0) {
          return current;
        }
        return {
          ...current,
          workspaceId: workspaceData[0].id,
        };
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchJobs();
    const dispose = subscribeEvents((event) => {
      if (
        event.type === 'scheduler.job.updated' ||
        event.type === 'scheduler.run.updated' ||
        event.type === 'automation.definition.updated'
      ) {
        void fetchJobs();
      }
    });
    return () => dispose();
  }, [fetchJobs]);

  const openCreate = () => {
    setEditingJob(null);
    setForm({
      ...DEFAULT_FORM,
      workspaceId: workspaces[0]?.id || '',
    });
    setShowModal(true);
  };

  const openEdit = (job: CronJob) => {
    setEditingJob(job);
    setForm(toForm(job));
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.workspaceId || !form.promptTemplate.trim()) {
      return;
    }
    if (form.platform !== 'local' && !form.channelId.trim()) {
      alert('Please enter a Channel / Chat ID for external platform delivery.');
      return;
    }
    if (form.triggerType === 'once' && (!form.runAt || !localDateTimeInputToIso(form.runAt))) {
      alert('Please specify a valid execution date and time.');
      return;
    }
    setSubmitting(true);
    try {
      const payload = toPayload(form);
      if (editingJob) {
        await updateCronJob(editingJob.id, payload);
      } else {
        await createCronJob(payload);
      }
      setShowModal(false);
      setEditingJob(null);
      setForm(DEFAULT_FORM);
      await fetchJobs();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('common.confirmDelete'))) {
      return;
    }
    await deleteCronJob(id);
    await fetchJobs();
  };

  const handleRun = async (id: string) => {
    await runCronJobNow(id);
    await fetchJobs();
  };

  const channelFilterOptions = useMemo(() => {
    const channels = new Set<string>();
    for (const job of jobs) {
      if (job.platform === 'local') {
        channels.add('local');
      } else if (job.route.channelId) {
        channels.add(`${job.platform}:${job.route.channelId}`);
      }
    }
    return Array.from(channels);
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    if (channelFilter === 'all') return jobs;
    if (channelFilter === 'local') return jobs.filter((j) => j.platform === 'local');
    return jobs.filter((j) => `${j.platform}:${j.route.channelId}` === channelFilter || j.route.channelId === channelFilter);
  }, [jobs, channelFilter]);

  if (loading && jobs.length === 0) {
    return <div className="flex items-center justify-center h-64 text-gray-400 animate-pulse">{t('common.loading')}</div>;
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        title={t('cron.title')}
        description="Create simple scheduled prompts for a workspace and channel."
        actions={<Button onClick={openCreate}><Plus size={16} /> {t('cron.add')}</Button>}
      />

      <div className="flex items-center gap-3">
        <Select
          value={channelFilter}
          onChange={(event) => setChannelFilter(event.target.value)}
          className="max-w-xs"
        >
          <option value="all">All channels</option>
          <option value="local">Local only</option>
          {channelFilterOptions.filter((c) => c !== 'local').map((ch) => (
            <option key={ch} value={ch}>Channel: {ch}</option>
          ))}
        </Select>
      </div>

      {filteredJobs.length === 0 ? (
        <EmptyState message={t('cron.noJobs')} icon={Clock} />
      ) : (
        <div className="space-y-3">
          {filteredJobs.map((job) => (
            <Card key={job.id} className="app-panel">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-medium text-gray-900 dark:text-white text-sm">{job.description || job.id}</span>
                    <Badge variant={job.enabled ? 'success' : 'default'}>{job.enabled ? t('cron.enabled') : 'disabled'}</Badge>
                    <Badge variant="default">{job.triggerType}</Badge>
                    <Badge variant="secondary">{job.platform}: {job.route.channelId || 'local'}</Badge>
                    {job.lastStatus && <Badge variant={job.lastStatus === 'failed' ? 'danger' : 'default'}>{job.lastStatus}</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400 mt-2">
                    <span><strong>Workspace:</strong> {job.workspaceId}</span>
                    <span><strong>Channel:</strong> {job.platform} · {job.route.channelId || 'local'}</span>
                    <span><strong>Execution:</strong> {job.executionMode}</span>
                    <span><strong>{job.triggerType === 'cron' ? t('cron.expression') : 'Run at'}:</strong> {job.triggerType === 'cron' ? job.cronExpr : formatTime(job.runAt || '')}</span>
                    {job.route.threadId && <span><strong>Thread:</strong> {job.route.threadId}</span>}
                    {job.lastRunAt && <span><strong>{t('cron.lastRun')}:</strong> {formatTime(job.lastRunAt)}</span>}
                  </div>
                  <p className="mt-3 line-clamp-3 rounded-[16px] bg-black/[0.035] px-3 py-2 text-sm leading-6 text-gray-700 dark:bg-white/[0.05] dark:text-gray-300">{job.promptTemplate}</p>
                  {job.lastError && <p className="text-xs text-red-500 mt-2">{job.lastError}</p>}
                </div>
                <RowActions
                  className="lg:pt-0"
                  labels={{ run: 'Run now', edit: 'Edit job', delete: 'Delete job' }}
                  onRun={() => void handleRun(job.id)}
                  onEdit={() => openEdit(job)}
                  onDelete={() => void handleDelete(job.id)}
                />
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editingJob ? 'Edit scheduler job' : t('cron.add')}>
        <div className="space-y-4">
          <Select
            label="Workspace"
            value={form.workspaceId}
            onChange={(event) => setForm({ ...form, workspaceId: event.target.value })}
          >
            <option value="">Select workspace</option>
            {selectedWorkspaceOptions}
          </Select>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Platform / Target"
              value={form.platform}
              onChange={(event) => setForm({ ...form, platform: event.target.value })}
            >
              <option value="local">Local Desktop</option>
              <option value="lark">Lark (Feishu)</option>
              <option value="weixin">WeChat (Weixin)</option>
            </Select>
            {form.platform !== 'local' ? (
              <Input
                label="Channel / Chat ID"
                value={form.channelId}
                onChange={(event) => setForm({ ...form, channelId: event.target.value })}
                placeholder="e.g. oc_xxx or chat id"
              />
            ) : null}
          </div>
          <Select
            label="Schedule type"
            value={form.triggerType}
            onChange={(event) => setForm({ ...form, triggerType: event.target.value as 'cron' | 'once' })}
          >
            <option value="cron">Repeating</option>
            <option value="once">One time</option>
          </Select>
          {form.triggerType === 'cron' ? (
            <div className="space-y-2">
              <Input
                label={t('cron.expression')}
                value={form.cronExpr}
                onChange={(event) => setForm({ ...form, cronExpr: event.target.value })}
                placeholder="0 9 * * *"
              />
              <div className="flex flex-wrap gap-2">
                {[
                  ['0 9 * * *', 'Daily 09:00'],
                  ['0 9 * * 1', 'Weekly Mon'],
                  ['*/30 * * * *', 'Every 30m'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setForm({ ...form, cronExpr: value })}
                    className={`app-segment text-xs ${form.cronExpr === value ? 'app-segment-active' : 'app-segment-idle'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <Input
              label="Run at"
              type="datetime-local"
              value={form.runAt}
              onChange={(event) => setForm({ ...form, runAt: event.target.value })}
            />
          )}
          <Input
            label={t('cron.description')}
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
          <Textarea
            label={t('cron.prompt')}
            value={form.promptTemplate}
            onChange={(event) => setForm({ ...form, promptTemplate: event.target.value })}
            rows={4}
            placeholder="Summarize today's blockers and post a status update."
          />
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
            />
            {t('cron.enabled')}
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowModal(false)}>{t('common.cancel')}</Button>
            <Button onClick={() => void handleSave()} disabled={submitting}>{editingJob ? t('common.save') : t('cron.add')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
