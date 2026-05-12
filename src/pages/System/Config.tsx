import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, FileCode, Plug, RefreshCw, RotateCcw, Save, ScrollText, ShieldCheck, Stethoscope } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { restartSystem, reloadConfig } from '@/api/status';
import {
  getRuntimeDiagnosticErrors,
  getRuntimePluginDiagnostics,
  getRuntimeStatus,
  runRuntimeDiagnosticsDoctor,
  saveDesktopSettings,
} from '@/api/desktop';
import { Badge, Button, Input, PageHeader, SectionCard, StatusPill } from '@/components/ui';
import type { DesktopRuntimeStatus } from '../../../shared/desktop';
import type { LocalCoreDoctorResult, LocalCoreErrorSummary, LocalCorePluginDiagnostics } from '../../../packages/contracts/src';

function runtimeTone(phase?: string) {
  if (phase === 'api_ready') return 'success';
  if (phase === 'error') return 'danger';
  if (phase === 'starting') return 'warning';
  return 'neutral';
}

export default function SystemConfig() {
  const { t } = useTranslation();
  const [runtime, setRuntime] = useState<DesktopRuntimeStatus | null>(null);
  const [plugins, setPlugins] = useState<LocalCorePluginDiagnostics | null>(null);
  const [diagnosticErrors, setDiagnosticErrors] = useState<LocalCoreErrorSummary[]>([]);
  const [doctorResult, setDoctorResult] = useState<LocalCoreDoctorResult | null>(null);
  const [knowledgeBaseUrl, setKnowledgeBaseUrl] = useState('');
  const [persistedKnowledgeBaseUrl, setPersistedKnowledgeBaseUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingKnowledge, setSavingKnowledge] = useState(false);
  const [runningDoctor, setRunningDoctor] = useState(false);
  const [actionMsg, setActionMsg] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [runtimeResult, pluginResult, errorResult] = await Promise.allSettled([
        getRuntimeStatus(),
        getRuntimePluginDiagnostics(),
        getRuntimeDiagnosticErrors(),
      ]);
      if (runtimeResult.status === 'fulfilled') {
        setRuntime(runtimeResult.value);
        setKnowledgeBaseUrl(runtimeResult.value.settings.knowledge.baseUrl || '');
        setPersistedKnowledgeBaseUrl(runtimeResult.value.settings.knowledge.baseUrl || '');
      }
      if (pluginResult.status === 'fulfilled') setPlugins(pluginResult.value);
      if (errorResult.status === 'fulfilled') setDiagnosticErrors(errorResult.value);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleRestart = async () => {
    if (!confirm(t('system.restartConfirm'))) return;
    try {
      await restartSystem();
      setActionMsg(t('common.success'));
      await fetchData();
    } catch (e: any) {
      setActionMsg(e.message);
    }
  };

  const handleReload = async () => {
    if (!confirm(t('system.reloadConfirm'))) return;
    try {
      await reloadConfig();
      setActionMsg(t('common.success'));
      await fetchData();
    } catch (e: any) {
      setActionMsg(e.message);
    }
  };

  const handleSaveKnowledge = async () => {
    setSavingKnowledge(true);
    try {
      const settings = await saveDesktopSettings({
        knowledge: {
          baseUrl: knowledgeBaseUrl,
          authMode: runtime?.settings.knowledge.authMode || 'none',
          token: runtime?.settings.knowledge.token || '',
          headerName: runtime?.settings.knowledge.headerName || 'X-API-Key',
          defaultCollection: runtime?.settings.knowledge.defaultCollection || 'personal_knowledge',
        },
      });
      setRuntime((current) => current ? { ...current, settings } : current);
      setPersistedKnowledgeBaseUrl(settings.knowledge.baseUrl || '');
      setActionMsg(t('common.success'));
    } catch (e: any) {
      setActionMsg(e.message);
    } finally {
      setSavingKnowledge(false);
    }
  };

  const handleRunDoctor = async () => {
    setRunningDoctor(true);
    try {
      const result = await runRuntimeDiagnosticsDoctor();
      setDoctorResult(result);
      setDiagnosticErrors(await getRuntimeDiagnosticErrors());
      setActionMsg(`Diagnostics completed with ${result.status} status.`);
    } catch (e: any) {
      setActionMsg(e.message);
    } finally {
      setRunningDoctor(false);
    }
  };

  const knowledgeDirty = knowledgeBaseUrl !== persistedKnowledgeBaseUrl;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t('nav.system')}
        description="Runtime health, logs, and plugin diagnostics. Advanced config is available read-only from the diagnostics drawer."
        actions={(
          <>
            <Button variant="secondary" onClick={handleReload}><RefreshCw size={16} /> {t('system.reload')}</Button>
            <Button variant="danger" onClick={handleRestart}><RotateCcw size={16} /> {t('system.restart')}</Button>
            <Link to="/system/logs">
              <Button variant="secondary"><ScrollText size={16} /> {t('system.logs')}</Button>
            </Link>
          </>
        )}
      />

      {actionMsg ? (
        <div role="status" className="rounded-lg border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary">
          {actionMsg}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard title="Runtime" description={loading ? 'Loading...' : 'Local service status.'}>
          <StatusPill tone={runtimeTone(runtime?.phase) as any}>{runtime?.phase || 'unknown'}</StatusPill>
          <p className="mt-3 text-sm text-muted-foreground">
            {runtime?.pendingRestart ? 'Restart required to apply saved changes.' : 'No pending restart.'}
          </p>
        </SectionCard>
        <SectionCard title="Config" description="Active config file location.">
          <div className="flex items-start gap-3">
            <FileCode size={18} className="mt-0.5 text-primary" />
            <p className="break-all font-mono text-xs leading-5 text-muted-foreground">
              {runtime?.settings.configPath || runtime?.configFile.path || '-'}
            </p>
          </div>
        </SectionCard>
        <SectionCard title="Plugins" description="Health summary only.">
          <p className="text-2xl font-semibold text-foreground">
            {plugins ? `${plugins.enabledPluginCount}/${plugins.pluginCount}` : '-'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">enabled plugins</p>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard
          title="Diagnostics"
          description="Structured runtime and channel health checks."
          actions={(
            <Button size="sm" variant="secondary" onClick={() => void handleRunDoctor()} loading={runningDoctor}>
              <Stethoscope size={14} /> Run doctor
            </Button>
          )}
        >
          {!doctorResult ? (
            <div className="flex items-start gap-3 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
              <ShieldCheck size={16} className="mt-0.5 shrink-0" />
              <p>Run doctor to validate config, runtime readiness, channel health, and log access.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <StatusPill tone={doctorResult.status === 'pass' ? 'success' : doctorResult.status === 'warn' ? 'warning' : 'danger'}>
                  {doctorResult.status}
                </StatusPill>
                <p className="text-xs text-muted-foreground">
                  Checked {new Date(doctorResult.checkedAt).toLocaleString()}
                </p>
              </div>
              <div className="space-y-2">
                {doctorResult.checks.map((check) => (
                  <div key={check.id} className="rounded-lg border border-border px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{check.label}</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{check.summary}</p>
                        {check.errorInfo?.suggestedAction ? (
                          <p className="mt-1 text-xs leading-5 text-amber-700 dark:text-amber-200">
                            {check.errorInfo.suggestedAction}
                          </p>
                        ) : null}
                      </div>
                      <Badge variant={check.status === 'pass' ? 'success' : check.status === 'warn' ? 'warning' : 'danger'}>
                        {check.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Recent Errors" description="Aggregated runtime and channel failures from the current window.">
          {diagnosticErrors.length === 0 ? (
            <div className="py-8 text-sm text-muted-foreground">No aggregated errors in the current diagnostics window.</div>
          ) : (
            <div className="space-y-3">
              {diagnosticErrors.map((entry) => (
                <div key={entry.key} className="rounded-lg border border-border px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <AlertTriangle size={14} className="text-amber-500" />
                        <p className="text-sm font-medium text-foreground">{entry.errorInfo.userMessage}</p>
                        <Badge variant={entry.errorInfo.severity === 'error' ? 'danger' : entry.errorInfo.severity === 'warning' ? 'warning' : 'info'}>
                          {entry.errorInfo.code}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{entry.errorInfo.message}</p>
                      {entry.errorInfo.suggestedAction ? (
                        <p className="mt-1 text-xs leading-5 text-amber-700 dark:text-amber-200">
                          {entry.errorInfo.suggestedAction}
                        </p>
                      ) : null}
                      <p className="mt-2 text-xs text-muted-foreground">
                        {entry.count} occurrence(s), last seen {new Date(entry.lastSeenAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Knowledge"
        description="System-wide knowledge API connection."
        actions={(
          <Button
            size="sm"
            onClick={() => void handleSaveKnowledge()}
            loading={savingKnowledge}
            disabled={!knowledgeDirty && !savingKnowledge}
          >
            <Save size={14} /> Save
          </Button>
        )}
      >
        <Input
          label="Knowledge base URL"
          value={knowledgeBaseUrl}
          onChange={(event) => setKnowledgeBaseUrl(event.target.value)}
          placeholder="http://127.0.0.1:16007"
        />
      </SectionCard>

      <SectionCard title={t('system.plugins')} description="Plugin state is read-only in the daily UI. Use backend config for advanced changes.">
        {!plugins ? (
          <div className="py-8 text-sm text-muted-foreground">Loading...</div>
        ) : plugins.plugins.length === 0 ? (
          <div className="py-8 text-sm text-muted-foreground">No plugins registered.</div>
        ) : (
          <div className="divide-y divide-border">
            {plugins.plugins.map((plugin) => (
              <div key={plugin.pluginId} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Plug size={15} className="text-muted-foreground" />
                    <p className="truncate text-sm font-medium text-foreground">{plugin.pluginId}</p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {plugin.health.summary || plugin.manifest.provides.join(', ') || 'No declared capabilities'}
                  </p>
                </div>
                <Badge variant={plugin.health.status === 'healthy' ? 'success' : plugin.health.status === 'failed' ? 'danger' : 'warning'}>
                  {plugin.health.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
