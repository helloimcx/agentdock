import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getConfig, restartSystem, reloadConfig } from '@/api/status';
import { rendererUiContributions } from '@/app/ui-contributions';
import { getRuntimePluginDiagnostics, saveDesktopSettings } from '@/api/desktop';
import type { LocalCorePluginDiagnostics } from '../../../packages/contracts/src';

export default function SystemConfig() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<any>(null);
  const [pluginDiagnostics, setPluginDiagnostics] = useState<LocalCorePluginDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState('');

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const [configResult, diagnosticsResult] = await Promise.allSettled([
        getConfig(),
        getRuntimePluginDiagnostics(),
      ]);
      if (configResult.status === 'fulfilled') {
        setConfig(configResult.value);
      }
      if (diagnosticsResult.status === 'fulfilled') {
        setPluginDiagnostics(diagnosticsResult.value);
      } else {
        setPluginDiagnostics(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleRestart = async () => {
    if (!confirm(t('system.restartConfirm'))) return;
    try {
      await restartSystem();
      setActionMsg(t('common.success'));
    } catch (e: any) {
      setActionMsg(e.message);
    }
  };

  const handleReload = async () => {
    if (!confirm(t('system.reloadConfirm'))) return;
    try {
      await reloadConfig();
      setActionMsg(t('common.success'));
      fetchConfig();
    } catch (e: any) {
      setActionMsg(e.message);
    }
  };

  const handleTogglePlugin = async (pluginId: string, enabled: boolean) => {
    try {
      await saveDesktopSettings({
        plugins: {
          [pluginId]: { enabled },
        },
      });
      setPluginDiagnostics((current) => current
        ? {
            ...current,
            enabledPluginCount: current.enabledPluginCount + (enabled ? 1 : -1),
            plugins: current.plugins.map((plugin) =>
              plugin.pluginId === pluginId
                ? {
                    ...plugin,
                    enabled,
                    health: enabled
                      ? plugin.health
                      : { status: 'degraded' as const, summary: 'Plugin is disabled by runtime settings.' },
                  }
                : plugin
            ),
          }
        : current);
      setActionMsg(`${pluginId} ${enabled ? 'enabled' : 'disabled'}. Restart required.`);
    } catch (e: any) {
      setActionMsg(e.message);
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      {rendererUiContributions.listSettingsPanels().map((panel) => (
        <div key={panel.id}>
          {panel.render({
            t,
            config,
            loading,
            actionMsg,
            pluginDiagnostics,
            onReload: handleReload,
            onRestart: handleRestart,
            onTogglePlugin: handleTogglePlugin,
          })}
        </div>
      ))}
    </div>
  );
}
