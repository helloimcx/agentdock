import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { subscribeEvents } from '../../../packages/core-sdk/src';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Textarea } from '@/components/ui';
import {
  createMonitor,
  deleteMonitor,
  listMonitors,
  listMonitorWorkspaces,
  runMonitorNow,
  updateMonitor,
  type Monitor,
  type MonitorCreateInput,
} from '@/api/monitors';
import { formatTime } from '@/lib/utils';

type MonitorFormState = {
  workspaceId: string;
  title: string;
  symbol: string;
  condition: string;
  promptTemplate: string;
  cooldownMinutes: string;
  executionMode: 'same-thread' | 'side-thread';
  enabled: boolean;
};

const DEFAULT_FORM: MonitorFormState = {
  workspaceId: '',
  title: '',
  symbol: '',
  condition: 'abs_change_percent >= 3',
  promptTemplate: '',
  cooldownMinutes: '15',
  executionMode: 'side-thread',
  enabled: true,
};

function parseCondition(value: string) {
  const match = value.trim().match(/^([a-zA-Z0-9_.-]+)\s*(>=|<=|==|!=|>|<)\s*(.+)$/);
  if (!match) return null;
  const rawValue = String(match[3] || '').trim();
  const numeric = Number(rawValue);
  return {
    metric: String(match[1] || '').trim(),
    operator: match[2] as MonitorCreateInput['condition']['operator'],
    value: Number.isFinite(numeric) && rawValue !== '' ? numeric : rawValue,
  };
}

function conditionToText(monitor: Monitor) {
  return `${monitor.condition.metric} ${monitor.condition.operator} ${monitor.condition.value}`;
}

function toForm(monitor?: Monitor | null): MonitorFormState {
  if (!monitor) return DEFAULT_FORM;
  return {
    workspaceId: monitor.workspaceId,
    title: monitor.title,
    symbol: String(monitor.sourceConfig.symbol || ''),
    condition: conditionToText(monitor),
    promptTemplate: monitor.promptTemplate,
    cooldownMinutes: String(Math.round(monitor.cooldownMs / 60000)),
    executionMode: monitor.executionMode as MonitorFormState['executionMode'],
    enabled: monitor.enabled,
  };
}

function toPayload(form: MonitorFormState): MonitorCreateInput {
  const condition = parseCondition(form.condition);
  if (!condition) throw new Error('Invalid condition');
  return {
    workspaceId: form.workspaceId,
    title: form.title,
    sourceType: 'stock.quote',
    sourceConfig: { symbol: form.symbol.toUpperCase() },
    condition,
    promptTemplate: form.promptTemplate,
    executionMode: form.executionMode,
    cooldownMs: Math.max(0, Number(form.cooldownMinutes || '0') * 60000),
    enabled: form.enabled,
  };
}

export default function MonitorList() {
  const { t } = useTranslation();
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingMonitor, setEditingMonitor] = useState<Monitor | null>(null);
  const [form, setForm] = useState<MonitorFormState>(DEFAULT_FORM);

  const selectedWorkspaceOptions = useMemo(
    () => workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>),
    [workspaces],
  );

  const fetchMonitors = useCallback(async () => {
    setLoading(true);
    try {
      const [monitorData, workspaceData] = await Promise.all([listMonitors(), listMonitorWorkspaces()]);
      setMonitors(monitorData.monitors || []);
      setWorkspaces(workspaceData);
      setForm((current) => current.workspaceId || workspaceData.length === 0
        ? current
        : { ...current, workspaceId: workspaceData[0].id });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMonitors();
    const dispose = subscribeEvents((event) => {
      if (event.type === 'automation.monitor.updated' || event.type === 'automation.monitor.run.updated') {
        void fetchMonitors();
      }
    });
    return () => dispose();
  }, [fetchMonitors]);

  const openCreate = () => {
    setEditingMonitor(null);
    setForm({ ...DEFAULT_FORM, workspaceId: workspaces[0]?.id || '' });
    setShowModal(true);
  };

  const openEdit = (monitor: Monitor) => {
    setEditingMonitor(monitor);
    setForm(toForm(monitor));
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.workspaceId || !form.title.trim() || !form.symbol.trim() || !form.promptTemplate.trim() || !parseCondition(form.condition)) {
      return;
    }
    setSubmitting(true);
    try {
      const payload = toPayload(form);
      if (editingMonitor) {
        await updateMonitor(editingMonitor.id, payload);
      } else {
        await createMonitor(payload);
      }
      setShowModal(false);
      setEditingMonitor(null);
      setForm(DEFAULT_FORM);
      await fetchMonitors();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('common.confirmDelete'))) return;
    await deleteMonitor(id);
    await fetchMonitors();
  };

  const handleRun = async (id: string) => {
    await runMonitorNow(id);
    await fetchMonitors();
  };

  if (loading && monitors.length === 0) {
    return <div className="flex h-64 items-center justify-center text-gray-400 animate-pulse">{t('common.loading')}</div>;
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        title={t('monitors.title')}
        description="Create event monitors that trigger agent analysis and stream results back to channels."
        actions={<Button onClick={openCreate}><Plus size={16} /> {t('monitors.add')}</Button>}
      />

      {monitors.length === 0 ? (
        <EmptyState message={t('monitors.noMonitors')} icon={Bell} />
      ) : (
        <div className="space-y-3">
          {monitors.map((monitor) => (
            <Card key={monitor.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">{monitor.title}</span>
                    <Badge variant={monitor.enabled ? 'success' : 'default'}>{monitor.enabled ? t('monitors.enabled') : 'disabled'}</Badge>
                    <Badge variant="default">{monitor.sourceType}</Badge>
                    <Badge variant="default">{monitor.platform}</Badge>
                    {monitor.lastStatus && <Badge variant={monitor.lastStatus === 'failed' ? 'danger' : 'default'}>{monitor.lastStatus}</Badge>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                    <span><strong>Workspace:</strong> {monitor.workspaceId}</span>
                    <span><strong>Symbol:</strong> {String(monitor.sourceConfig.symbol || '')}</span>
                    <span><strong>Condition:</strong> {conditionToText(monitor)}</span>
                    <span><strong>Execution:</strong> {monitor.executionMode}</span>
                    <span><strong>Cooldown:</strong> {Math.round(monitor.cooldownMs / 60000)}m</span>
                    {monitor.lastTriggeredAt && <span><strong>{t('monitors.lastRun')}:</strong> {formatTime(monitor.lastTriggeredAt)}</span>}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">{monitor.promptTemplate}</p>
                  {monitor.lastError && <p className="mt-2 text-xs text-red-500">{monitor.lastError}</p>}
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => handleRun(monitor.id)} title={t('monitors.run')}>
                    <Play size={14} />
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => openEdit(monitor)} title={t('common.save')}>
                    <Pencil size={14} />
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => handleDelete(monitor.id)} title={t('common.delete')}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={showModal} title={editingMonitor ? t('monitors.edit') : t('monitors.add')} onClose={() => setShowModal(false)}>
        <div className="space-y-4">
          <Select label="Workspace" value={form.workspaceId} onChange={(event) => setForm({ ...form, workspaceId: event.target.value })}>
            {selectedWorkspaceOptions}
          </Select>
          <Input label={t('monitors.monitorTitle')} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          <Input label="Symbol" value={form.symbol} onChange={(event) => setForm({ ...form, symbol: event.target.value })} placeholder="AAPL" />
          <Input label={t('monitors.condition')} value={form.condition} onChange={(event) => setForm({ ...form, condition: event.target.value })} placeholder="abs_change_percent >= 3" />
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('monitors.cooldown')} value={form.cooldownMinutes} onChange={(event) => setForm({ ...form, cooldownMinutes: event.target.value })} />
            <Select label="Execution" value={form.executionMode} onChange={(event) => setForm({ ...form, executionMode: event.target.value as MonitorFormState['executionMode'] })}>
              <option value="side-thread">side-thread</option>
              <option value="same-thread">same-thread</option>
            </Select>
          </div>
          <Textarea label={t('monitors.prompt')} rows={6} value={form.promptTemplate} onChange={(event) => setForm({ ...form, promptTemplate: event.target.value })} />
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
            {t('monitors.enabled')}
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowModal(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleSave} disabled={submitting}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

