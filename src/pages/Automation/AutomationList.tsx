import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Eye, Pause, Play, RefreshCw } from 'lucide-react';
import { checkAutomation, listAutomationScriptVersions, listAutomationScripts, listAutomations, updateAutomation } from '@cc/core-sdk/automations';
import { subscribeEvents } from '@cc/core-sdk/runtime';
import { listWorkspaces } from '@cc/core-sdk/threads';
import type { AutomationDefinition, AutomationScriptVersion } from '@cc/superai-contracts/automations';
import { Badge, Button, Card, EmptyState, PageHeader, Select } from '@/components/ui';
import { RunTimelineDrawer } from '@/components/traces/RunTimelineDrawer';
import AutomationDetailModal from './AutomationDetailModal';
import ScriptApprovalModal from './ScriptApprovalModal';
import { deriveAutomationDisplayStatus, filterAutomationRows, originLabel, type AutomationOriginFilter } from './automation-page-model';

function originFromSearch(): AutomationOriginFilter {
  const value = new URLSearchParams(window.location.search).get('origin');
  return value === 'scheduled-job' || value === 'automation-monitor' || value === 'native' ? value : 'all';
}

export default function AutomationList() {
  const { t } = useTranslation();
  const [automations, setAutomations] = useState<AutomationDefinition[]>([]);
  const [origin, setOrigin] = useState<AutomationOriginFilter>(originFromSearch);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AutomationDefinition | null>(null);
  const [scriptVersions, setScriptVersions] = useState<Array<{ workspaceId: string; title: string; version: AutomationScriptVersion }>>([]);
  const [selectedVersion, setSelectedVersion] = useState<{ workspaceId: string; version: AutomationScriptVersion } | null>(null);
  const [activeTraceRunId, setActiveTraceRunId] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { workspaces } = await listWorkspaces();
      const [lists, scriptLists] = await Promise.all([
        Promise.all(workspaces.map((workspace) => listAutomations(workspace.id))),
        Promise.all(workspaces.map(async (workspace) => ({ workspace, scripts: (await listAutomationScripts(workspace.id)).scripts }))),
      ]);
      setAutomations(lists.flatMap((result) => result.automations));
      const versions = await Promise.all(scriptLists.flatMap(({ workspace, scripts }) => scripts.map(async (script) => ({
        workspaceId: workspace.id,
        title: script.title,
        versions: (await listAutomationScriptVersions(script.id, workspace.id)).versions,
      }))));
      setScriptVersions(versions.flatMap(({ workspaceId, title, versions: entries }) => entries.map((version) => ({ workspaceId, title, version }))));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void load();
    const dispose = subscribeEvents((event) => {
      if (event.type === 'automation.definition.updated' || event.type === 'automation.evaluation.updated' || event.type === 'automation.run.updated' || event.type === 'automation.script-version.updated') void load();
    });
    return dispose;
  }, [load]);
  const rows = useMemo(() => filterAutomationRows(automations, { origin }), [automations, origin]);
  const toggle = async (automation: AutomationDefinition) => { await updateAutomation(automation.id, automation.workspaceId, { enabled: !automation.enabled }); await load(); };
  const check = async (automation: AutomationDefinition) => { await checkAutomation(automation.id, automation.workspaceId); await load(); };
  if (loading && automations.length === 0) return <div className="flex h-64 items-center justify-center text-gray-400 animate-pulse">{t('common.loading')}</div>;
  return <div className="space-y-4 animate-fade-in">
    <PageHeader title={t('automations.title')} description={t('automations.description')} actions={<Button variant="secondary" onClick={() => void load()}><RefreshCw size={16} /> {t('automations.refresh')}</Button>} />
    <Select value={origin} onChange={(event) => setOrigin(event.target.value as AutomationOriginFilter)}><option value="all">{t('automations.all')}</option><option value="native">{t('automations.native')}</option><option value="scheduled-job">{t('automations.cron')}</option><option value="automation-monitor">{t('automations.monitor')}</option></Select>
    {!rows.length ? <EmptyState icon={Activity} message={t('automations.empty')} /> : <div className="space-y-3">{rows.map((automation) => {
      const status = deriveAutomationDisplayStatus(automation);
      return <Card key={automation.id} className="app-panel"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{automation.title}</span><Badge variant={status === 'active' ? 'success' : status === 'blocked' ? 'danger' : 'default'}>{t(`automations.${status}`)}</Badge><Badge variant="secondary">{originLabel(automation.originKind)}</Badge></div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500"><span>{t('automations.activation')}: {automation.activation.kind}</span><span>{t('automations.condition')}: {automation.condition.kind}</span><span>{t('automations.workspace')}: {automation.workspaceId}</span>{automation.lastEvaluationAt && <span>{t('automations.lastEvaluation')}: {automation.lastEvaluationAt}</span>}{automation.lastTriggeredAt && <span>{t('automations.lastRun')}: {automation.lastTriggeredAt}</span>}</div>{status === 'blocked' && <p className="mt-2 text-xs text-red-600">{automation.blockedReason || t('automations.blocked')}</p>}</div><div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => void check(automation)} title={t('automations.check')}><Play size={14} /> {t('automations.check')}</Button><Button size="sm" variant="secondary" onClick={() => void toggle(automation)} title={automation.enabled ? t('automations.pause') : t('automations.enable')}>{automation.enabled ? <Pause size={14} /> : <Play size={14} />}</Button><Button size="sm" variant="secondary" onClick={() => setSelected(automation)}><Eye size={14} /> {t('automations.detail')}</Button></div></div></Card>;
    })}</div>}
    {scriptVersions.filter(({ version }) => version.status !== 'approved' && version.status !== 'rejected' && version.status !== 'revoked').length > 0 && <section className="space-y-2"><h2 className="text-base font-semibold">{t('automations.scriptApprovals')}</h2>{scriptVersions.filter(({ version }) => version.status !== 'approved' && version.status !== 'rejected' && version.status !== 'revoked').map(({ workspaceId, title, version }) => <Card className="app-panel" key={version.id}><div className="flex items-center justify-between gap-3"><div><p className="font-medium">{title}</p><p className="text-xs text-gray-500">{version.status} · {version.interpreterPath} · {version.packageSha256.slice(0, 12)}…</p></div><Button size="sm" variant="secondary" onClick={() => setSelectedVersion({ workspaceId, version })}>{t('automations.reviewApproval')}</Button></div></Card>)}</section>}
    <AutomationDetailModal automation={selected} onClose={() => setSelected(null)} onChanged={load} />
    <ScriptApprovalModal open={Boolean(selectedVersion)} version={selectedVersion?.version || null} workspaceId={selectedVersion?.workspaceId || ''} onClose={() => setSelectedVersion(null)} onChanged={load} />
    <RunTimelineDrawer open={Boolean(activeTraceRunId)} onClose={() => setActiveTraceRunId(null)} runId={activeTraceRunId} />
  </div>;
}
