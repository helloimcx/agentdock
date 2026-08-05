import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Save, Trash2 } from 'lucide-react';
import { Button, EmptyState, Input, PageHeader, SectionCard, Select } from '@/components/ui';
import {
  createModelProvider,
  deleteModelProvider,
  listModelProviders,
  updateModelProvider,
} from '@cc/core-sdk/runtime';
import type { DesktopModelProvider, DesktopModelProviderInput, DesktopProviderConfig } from '@cc/superai-contracts';
import {
  applyProviderPreset,
  CUSTOM_SELECT_VALUE,
  getProviderPresetValue,
  noticeClass,
  PROVIDER_PRESETS,
  providerToDraft,
  type Notice,
} from '@/pages/Desktop/workspace-model';

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function ProvidersPage() {
  const { t } = useTranslation();
  const [modelProviders, setModelProviders] = useState<DesktopModelProvider[]>([]);
  const [providerDrafts, setProviderDrafts] = useState<Record<string, DesktopModelProviderInput>>({});
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);

  const loadProviders = useCallback(async () => {
    setLoading(true);
    try {
      const providerState = await listModelProviders();
      const providers = providerState.providers || [];
      setModelProviders(providers);
      setProviderDrafts(Object.fromEntries(providers.map((provider) => [provider.id, providerToDraft(provider)])));
    } catch (err) {
      setNotice({ tone: 'error', message: describeError(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const updateProviderDraft = useCallback((providerId: string, updater: (provider: DesktopModelProviderInput) => DesktopModelProviderInput) => {
    setProviderDrafts((current) => {
      const provider = current[providerId];
      if (!provider) return current;
      return { ...current, [providerId]: updater(provider) };
    });
  }, []);

  const handleAddProvider = async () => {
    try {
      const provider = await createModelProvider({ name: `provider-${modelProviders.length + 1}` });
      setModelProviders((current) => [...current, provider].sort((a, b) => a.name.localeCompare(b.name)));
      setProviderDrafts((current) => ({ ...current, [provider.id]: providerToDraft(provider) }));
      setNotice({ tone: 'success', message: t('providers.created', 'Provider created.') });
    } catch (err) {
      setNotice({ tone: 'error', message: describeError(err) });
    }
  };

  const handleSaveProvider = async (providerId: string) => {
    const draft = providerDrafts[providerId];
    if (!draft) return;
    try {
      const provider = await updateModelProvider(providerId, draft);
      setModelProviders((current) => current.map((item) => item.id === provider.id ? provider : item).sort((a, b) => a.name.localeCompare(b.name)));
      setProviderDrafts((current) => ({ ...current, [provider.id]: providerToDraft(provider) }));
      setNotice({ tone: 'success', message: t('providers.saved', 'Provider saved.') });
    } catch (err) {
      setNotice({ tone: 'error', message: describeError(err) });
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    try {
      await deleteModelProvider(providerId);
      setModelProviders((current) => current.filter((provider) => provider.id !== providerId));
      setProviderDrafts((current) => {
        const next = { ...current };
        delete next[providerId];
        return next;
      });
      setNotice({ tone: 'success', message: t('providers.removed', 'Provider removed.') });
    } catch (err) {
      setNotice({ tone: 'error', message: describeError(err) });
    }
  };

  if (loading && modelProviders.length === 0) {
    return <div className="flex h-64 items-center justify-center text-sm text-slate-400 animate-pulse">Loading providers...</div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t('providers.title', 'AI 服务商')}
        description={t('providers.description', '配置和管理全局 AI 模型服务商的 API Key、Base URL 及默认模型。')}
        actions={
          <Button onClick={handleAddProvider}>
            <Plus size={14} /> {t('providers.addProvider', '新建服务商')}
          </Button>
        }
      />

      {notice ? (
        <div role="status" className={`rounded-xl border px-4 py-3 text-sm ${noticeClass(notice.tone)}`}>
          {notice.message}
        </div>
      ) : null}

      <SectionCard title={t('providers.listTitle', '已配置服务商')} className="app-panel">
        {modelProviders.length === 0 ? (
          <EmptyState message={t('providers.empty', '暂未配置 AI 服务商，请点击“新建服务商”开始配置。')} />
        ) : (
          <div className="space-y-4">
            {modelProviders.map((provider) => {
              const draft = providerDrafts[provider.id] || providerToDraft(provider);
              return (
                <div key={provider.id} className="app-surface p-4 space-y-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <Select
                      label={t('providers.preset', '预设模版')}
                      value={getProviderPresetValue(draft as DesktopProviderConfig)}
                      onChange={(event) => {
                        if (event.target.value !== CUSTOM_SELECT_VALUE) {
                          updateProviderDraft(provider.id, (current) => applyProviderPreset(current as DesktopProviderConfig, event.target.value));
                        }
                      }}
                    >
                      {PROVIDER_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>{preset.label}</option>
                      ))}
                      <option value={CUSTOM_SELECT_VALUE}>custom</option>
                    </Select>

                    <Input
                      label={t('providers.name', '服务商名称')}
                      value={draft.name || ''}
                      onChange={(event) => updateProviderDraft(provider.id, (current) => ({ ...current, name: event.target.value }))}
                      placeholder="e.g. OpenAI / DeepSeek"
                    />

                    <Input
                      label={t('providers.apiKey', 'API Key')}
                      type="password"
                      value={draft.api_key || ''}
                      onChange={(event) => updateProviderDraft(provider.id, (current) => ({ ...current, api_key: event.target.value }))}
                      placeholder="sk-..."
                    />

                    <Input
                      label={t('providers.baseUrl', 'Base URL')}
                      value={draft.base_url || ''}
                      onChange={(event) => updateProviderDraft(provider.id, (current) => ({ ...current, base_url: event.target.value }))}
                      placeholder="https://api.openai.com/v1"
                    />

                    <Input
                      label={t('providers.defaultModel', '默认模型')}
                      value={draft.model || ''}
                      onChange={(event) => updateProviderDraft(provider.id, (current) => ({ ...current, model: event.target.value }))}
                      placeholder="e.g. gpt-4.1-mini / deepseek-v4-flash"
                    />

                    <div className="flex items-end gap-2 pt-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleSaveProvider(provider.id)}
                      >
                        <Save size={14} /> {t('common.save', '保存')}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => void handleDeleteProvider(provider.id)}
                      >
                        <Trash2 size={14} /> {t('common.remove', '删除')}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
