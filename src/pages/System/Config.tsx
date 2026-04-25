import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileCode, Plug, RefreshCw, RotateCcw, Save, ScrollText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { restartSystem, reloadConfig } from '@/api/status';
import { getRuntimePluginDiagnostics, getRuntimeStatus, saveDesktopSettings } from '@/api/desktop';
import { Badge, Button, Input, PageHeader, SectionCard, StatusPill } from '@/components/ui';
import type { DesktopRuntimeStatus } from '../../../shared/desktop';
import type { LocalCorePluginDiagnostics } from '../../../packages/contracts/src';

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
  const [knowledgeBaseUrl, setKnowledgeBaseUrl] = useState('');
  const [persistedKnowledgeBaseUrl, setPersistedKnowledgeBaseUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingKnowledge, setSavingKnowledge] = useState(false);
  const [actionMsg, setActionMsg] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [runtimeResult, pluginResult] = await Promise.allSettled([
        getRuntimeStatus(),
        getRuntimePluginDiagnostics(),
      ]);
      if (runtimeResult.status === 'fulfilled') {
        setRuntime(runtimeResult.value);
        setKnowledgeBaseUrl(runtimeResult.value.settings.knowledge.baseUrl || '');
        setPersistedKnowledgeBaseUrl(runtimeResult.value.settings.knowledge.baseUrl || '');
      }
      if (pluginResult.status === 'fulfilled') setPlugins(pluginResult.value);
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
