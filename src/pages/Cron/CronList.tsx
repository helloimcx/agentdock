import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { subscribeEvents } from '../../../packages/core-sdk/src';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Textarea } from '@/components/ui';
import {
  createCronJob,
  deleteCronJob,
  listCronJobs,
  listCronWorkspaces,
  runCronJobNow,
  updateCronJob,
  type CronJob,
  type CronJobCreateInput,
} from '@/api/cron';
import { formatTime } from '@/lib/utils';

type SchedulerFormState = {
  workspaceId: string;
  executionMode: 'same-thread' | 'side-thread';
  triggerType: 'cron' | 'once';
  cronExpr: string;
  runAt: string;
  promptTemplate: string;
  description: string;
  chatId: string;
  platformUserId: string;
  threadId: string;
  enabled: boolean;
};

const DEFAULT_FORM: SchedulerFormState = {
  workspaceId: '',
  executionMode: 'same-thread',
  triggerType: 'cron',
  cronExpr: '0 9 * * *',
  runAt: '',
  promptTemplate: '',
  description: '',
  chatId: '',
  platformUserId: '',
  threadId: '',
  enabled: true,
};

function toForm(job?: CronJob | null): SchedulerFormState {
  if (!job) {
    return DEFAULT_FORM;
  }
  return {
    workspaceId: job.workspaceId,
    executionMode: job.executionMode,
    triggerType: job.triggerType,
    cronExpr: job.cronExpr || '0 9 * * *',
    runAt: job.runAt ? String(job.runAt).slice(0, 16) : '',
    promptTemplate: job.promptTemplate,
    description: job.description,
    chatId: job.route.channelId,
    platformUserId: job.route.participantId || '',
    threadId: job.route.threadId || '',
    enabled: job.enabled,
  };
}

function toPayload(form: SchedulerFormState): CronJobCreateInput {
  return {
    workspaceId: form.workspaceId,
    platform: 'local',
    route: {
      type: 'local.thread',
      channelId: form.workspaceId || 'local',
      ...(form.threadId ? { threadId: form.threadId } : {}),
    },
    executionMode: form.executionMode || 'same-thread',
    triggerType: form.triggerType,
    ...(form.triggerType === 'cron'
      ? { cronExpr: form.cronExpr, runAt: undefined }
      : { runAt: new Date(form.runAt).toISOString(), cronExpr: undefined }),
    promptTemplate: form.promptTemplate,
    description: form.description,
    enabled: form.enabled,
  };
}

export default function CronList() {
  const { t } = useTranslation();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string }>>([]);
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
      const [jobData, workspaceData] = await Promise.all([listCronJobs(), listCronWorkspaces()]);
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
      if (event.type === 'scheduler.job.updated' || event.type === 'scheduler.run.updated') {
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
    if (form.triggerType === 'once' && !form.runAt) {
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

  if (loading && jobs.length === 0) {
    return <div className="flex items-center justify-center h-64 text-gray-400 animate-pulse">{t('common.loading')}</div>;
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        title={t('cron.title')}
        description="Create simple scheduled prompts for a workspace."
        actions={<Button onClick={openCreate}><Plus size={16} /> {t('cron.add')}</Button>}
      />

      {jobs.length === 0 ? (
        <EmptyState message={t('cron.noJobs')} icon={Clock} />
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <Card key={job.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-medium text-gray-900 dark:text-white text-sm">{job.description || job.id}</span>
                    <Badge variant={job.enabled ? 'success' : 'default'}>{job.enabled ? t('cron.enabled') : 'disabled'}</Badge>
                    <Badge variant="default">{job.triggerType}</Badge>
                    <Badge variant="default">{job.platform}</Badge>
                    {job.lastStatus && <Badge variant={job.lastStatus === 'failed' ? 'danger' : 'default'}>{job.lastStatus}</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400 mt-2">
                    <span><strong>Workspace:</strong> {job.workspaceId}</span>
                    <span><strong>Execution:</strong> {job.executionMode}</span>
                    <span><strong>Route:</strong> {job.route.channelId} / {job.route.participantId}</span>
                    <span><strong>{job.triggerType === 'cron' ? t('cron.expression') : 'Run at'}:</strong> {job.triggerType === 'cron' ? job.cronExpr : formatTime(job.runAt || '')}</span>
                    {job.route.threadId && <span><strong>Thread:</strong> {job.route.threadId}</span>}
                    {job.lastRunAt && <span><strong>{t('cron.lastRun')}:</strong> {formatTime(job.lastRunAt)}</span>}
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300 mt-2 whitespace-pre-wrap">{job.promptTemplate}</p>
                  {job.lastError && <p className="text-xs text-red-500 mt-2">{job.lastError}</p>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void handleRun(job.id)}>
                    <Play size={14} />
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => openEdit(job)}>
                    <Pencil size={14} />
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => void handleDelete(job.id)}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editingJob ? 'Edit scheduler job' : t('cron.add')}>
        <div className="space-y-3">
          <Select
            label="Workspace"
            value={form.workspaceId}
            onChange={(event) => setForm({ ...form, workspaceId: event.target.value })}
          >
            <option value="">Select workspace</option>
            {selectedWorkspaceOptions}
          </Select>
          <Select
            label="Schedule type"
            value={form.triggerType}
            onChange={(event) => setForm({ ...form, triggerType: event.target.value as 'cron' | 'once' })}
          >
            <option value="cron">Repeating</option>
            <option value="once">One time</option>
          </Select>
          {form.triggerType === 'cron' ? (
            <Input
              label={t('cron.expression')}
              value={form.cronExpr}
              onChange={(event) => setForm({ ...form, cronExpr: event.target.value })}
              placeholder="0 9 * * *"
            />
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
