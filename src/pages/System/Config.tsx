import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getConfig, restartSystem, reloadConfig } from '@/api/status';
import { rendererUiContributions } from '@/app/ui-contributions';

export default function SystemConfig() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState('');

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getConfig();
      setConfig(data);
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

  return (
    <div className="space-y-4 animate-fade-in">
      {rendererUiContributions.listSettingsPanels().map((panel) => (
        <div key={panel.id}>
          {panel.render({
            t,
            config,
            loading,
            actionMsg,
            onReload: handleReload,
            onRestart: handleRestart,
          })}
        </div>
      ))}
    </div>
  );
}
