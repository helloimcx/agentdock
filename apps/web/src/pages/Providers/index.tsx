import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Save, Star, Trash2 } from 'lucide-react';
import { Button, EmptyState, Input, PageHeader, SectionCard, Select } from '@/components/ui';
import {
  createModelProvider,
  deleteModelProvider,
  listModelProviders,
  updateModelProvider,
} from '@cc/core-sdk/runtime';
import type {
  DesktopModelProvider,
  DesktopModelProviderInput,
  DesktopProviderConfig,
  DesktopProviderModelConfig,
} from '@cc/superai-contracts';
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

function useModelProviders() {
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
      setProviderDrafts(Object.fromEntries(providers.map((p) => [p.id, providerToDraft(p)])));
    } catch (err) {
      setNotice({ tone: 'error', message: describeError(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const updateDraft = useCallback((providerId: string, updater: (p: DesktopModelProviderInput) => DesktopModelProviderInput) => {
    setProviderDrafts((current) => {
      const p = current[providerId];
      if (!p) return current;
      return { ...current, [providerId]: updater(p) };
    });
  }, []);

  const handleAdd = async () => {
    try {
      const provider = await createModelProvider({ name: `provider-${modelProviders.length + 1}` });
      setModelProviders((curr) => [...curr, provider].sort((a, b) => a.name.localeCompare(b.name)));
      setProviderDrafts((curr) => ({ ...curr, [provider.id]: providerToDraft(provider) }));
      setNotice({ tone: 'success', message: t('providers.created', 'Provider created.') });
    } catch (err) {
      setNotice({ tone: 'error', message: describeError(err) });
    }
  };

  const handleSave = async (providerId: string) => {
    const draft = providerDrafts[providerId];
    if (!draft) return;
    try {
      const provider = await updateModelProvider(providerId, draft);
      setModelProviders((curr) => curr.map((p) => (p.id === provider.id ? provider : p)).sort((a, b) => a.name.localeCompare(b.name)));
      setProviderDrafts((curr) => ({ ...curr, [provider.id]: providerToDraft(provider) }));
      setNotice({ tone: 'success', message: t('providers.saved', 'Provider saved.') });
    } catch (err) {
      setNotice({ tone: 'error', message: describeError(err) });
    }
  };

  const handleDelete = async (providerId: string) => {
    try {
      await deleteModelProvider(providerId);
      setModelProviders((curr) => curr.filter((p) => p.id !== providerId));
      setProviderDrafts((curr) => {
        const next = { ...curr };
        delete next[providerId];
        return next;
      });
      setNotice({ tone: 'success', message: t('providers.removed', 'Provider removed.') });
    } catch (err) {
      setNotice({ tone: 'error', message: describeError(err) });
    }
  };

  return {
    modelProviders,
    providerDrafts,
    loading,
    notice,
    updateDraft,
    handleAdd,
    handleSave,
    handleDelete,
  };
}

function parseUnitPrice(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const num = Number(trimmed);
  return Number.isNaN(num) || num < 0 ? undefined : num;
}

function ProviderPricingInputs({
  draft,
  onUpdateDraft,
}: {
  draft: DesktopModelProviderInput;
  onUpdateDraft: (updater: (current: DesktopModelProviderInput) => DesktopModelProviderInput) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-2">
      <Input
        label={t('providers.defaultPriceIn', '默认输入单价 ($/1M)')}
        type="number"
        step="0.01"
        min="0"
        value={draft.unit_price_in !== undefined ? draft.unit_price_in : ''}
        onChange={(e) => onUpdateDraft((c) => ({ ...c, unit_price_in: parseUnitPrice(e.target.value) }))}
        placeholder="3.00"
      />
      <Input
        label={t('providers.defaultPriceOut', '默认输出单价 ($/1M)')}
        type="number"
        step="0.01"
        min="0"
        value={draft.unit_price_out !== undefined ? draft.unit_price_out : ''}
        onChange={(e) => onUpdateDraft((c) => ({ ...c, unit_price_out: parseUnitPrice(e.target.value) }))}
        placeholder="15.00"
      />
    </div>
  );
}

function ProviderModelRow({
  modelConfig,
  isDefault,
  onUpdate,
  onDelete,
  onSetDefault,
}: {
  modelConfig: DesktopProviderModelConfig;
  isDefault: boolean;
  onUpdate: (patch: Partial<DesktopProviderModelConfig>) => void;
  onDelete: () => void;
  onSetDefault: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 gap-2 rounded-lg border border-black/10 bg-white/60 p-2.5 dark:border-white/10 dark:bg-slate-900/60 sm:grid-cols-12 sm:items-center">
      <div className="sm:col-span-4">
        <Input
          label={t('providers.modelId', '模型 ID')}
          value={modelConfig.model || ''}
          onChange={(e) => onUpdate({ model: e.target.value })}
          placeholder="e.g. deepseek-chat"
        />
      </div>
      <div className="sm:col-span-3">
        <Input
          label={t('providers.modelAlias', '别名（可选）')}
          value={modelConfig.alias || ''}
          onChange={(e) => onUpdate({ alias: e.target.value })}
          placeholder="e.g. DeepSeek V3"
        />
      </div>
      <div className="sm:col-span-2">
        <Input
          label={t('providers.priceIn', '输入单价 ($/1M)')}
          type="number"
          step="0.01"
          min="0"
          value={modelConfig.unit_price_in !== undefined ? modelConfig.unit_price_in : ''}
          onChange={(e) => onUpdate({ unit_price_in: parseUnitPrice(e.target.value) })}
          placeholder="0.27"
        />
      </div>
      <div className="sm:col-span-2">
        <Input
          label={t('providers.priceOut', '输出单价 ($/1M)')}
          type="number"
          step="0.01"
          min="0"
          value={modelConfig.unit_price_out !== undefined ? modelConfig.unit_price_out : ''}
          onChange={(e) => onUpdate({ unit_price_out: parseUnitPrice(e.target.value) })}
          placeholder="1.10"
        />
      </div>
      <div className="flex items-center justify-end gap-1 pt-1 sm:col-span-1 sm:pt-5">
        {isDefault ? (
          <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary dark:bg-primary/20">
            {t('providers.isDefault', '默认')}
          </span>
        ) : (
          <button
            type="button"
            title={t('providers.setDefault', '设为默认')}
            onClick={onSetDefault}
            disabled={!modelConfig.model}
            className="rounded p-1.5 text-xs text-muted-foreground hover:bg-black/5 hover:text-foreground disabled:opacity-30 dark:hover:bg-white/5"
          >
            <Star size={14} />
          </button>
        )}
        <button
          type="button"
          title={t('common.remove', '删除')}
          onClick={onDelete}
          className="rounded p-1.5 text-xs text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-400"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function ProviderModelsManager({
  draft,
  onUpdateDraft,
}: {
  draft: DesktopModelProviderInput;
  onUpdateDraft: (updater: (current: DesktopModelProviderInput) => DesktopModelProviderInput) => void;
}) {
  const { t } = useTranslation();
  const models = draft.models || [];

  const handleAddModel = () => {
    onUpdateDraft((current) => ({
      ...current,
      models: [
        ...(current.models || []),
        { model: '', alias: '', unit_price_in: undefined, unit_price_out: undefined },
      ],
    }));
  };

  const handleUpdateModel = (index: number, patch: Partial<DesktopProviderModelConfig>) => {
    onUpdateDraft((current) => {
      const nextModels = [...(current.models || [])];
      const prevModel = nextModels[index];
      nextModels[index] = { ...prevModel, ...patch };
      const isDefault = current.model && current.model === prevModel?.model;
      const nextDefaultModel = isDefault && patch.model !== undefined ? patch.model : current.model;
      return { ...current, models: nextModels, model: nextDefaultModel };
    });
  };

  const handleDeleteModel = (index: number) => {
    onUpdateDraft((current) => {
      const nextModels = [...(current.models || [])];
      const removed = nextModels.splice(index, 1)[0];
      const removedModelId = String(removed?.model || '').trim();
      const isRemovingDefault = Boolean(removedModelId && current.model === removedModelId);
      const nextModel = isRemovingDefault ? (nextModels[0]?.model || '') : current.model;
      return { ...current, models: nextModels, model: nextModel };
    });
  };

  return (
    <div className="col-span-1 md:col-span-2 space-y-3 rounded-xl border border-black/10 bg-black/[0.02] p-3.5 dark:border-white/[0.08] dark:bg-white/[0.02]">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            {t('providers.modelsTitle', '已配置模型')}
          </h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('providers.modelsSubtitle', '为该服务商配置可选模型列表，可在工作区中直接下拉选择。')}
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={handleAddModel}>
          <Plus size={13} /> {t('providers.addModel', '添加模型')}
        </Button>
      </div>

      {models.length === 0 ? (
        <div className="py-2 text-xs text-muted-foreground text-center">
          {t('providers.noModels', '暂未添加具体模型，可添加多个模型供工作区选择。')}
        </div>
      ) : (
        <div className="space-y-2">
          {models.map((modelConfig, index) => (
            <ProviderModelRow
              key={`${modelConfig.model || 'model'}-${index}`}
              modelConfig={modelConfig}
              isDefault={Boolean(draft.model && draft.model === modelConfig.model)}
              onUpdate={(patch) => handleUpdateModel(index, patch)}
              onDelete={() => handleDeleteModel(index)}
              onSetDefault={() => onUpdateDraft((c) => ({ ...c, model: modelConfig.model }))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProviderCard({
  provider,
  draft,
  onUpdateDraft,
  onSave,
  onDelete,
}: {
  provider: DesktopModelProvider;
  draft: DesktopModelProviderInput;
  onUpdateDraft: (updater: (current: DesktopModelProviderInput) => DesktopModelProviderInput) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="app-surface p-4 space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Select
          label={t('providers.preset', '预设模版')}
          value={getProviderPresetValue(draft as DesktopProviderConfig)}
          onChange={(event) => {
            if (event.target.value !== CUSTOM_SELECT_VALUE) {
              onUpdateDraft((current) => applyProviderPreset(current as DesktopProviderConfig, event.target.value));
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
          onChange={(event) => onUpdateDraft((current) => ({ ...current, name: event.target.value }))}
          placeholder="e.g. OpenAI / DeepSeek"
        />

        <Input
          label={t('providers.apiKey', 'API Key')}
          type="password"
          value={draft.api_key || ''}
          onChange={(event) => onUpdateDraft((current) => ({ ...current, api_key: event.target.value }))}
          placeholder="sk-..."
        />

        <Input
          label={t('providers.baseUrl', 'Base URL')}
          value={draft.base_url || ''}
          onChange={(event) => onUpdateDraft((current) => ({ ...current, base_url: event.target.value }))}
          placeholder="https://api.openai.com/v1"
        />

        <Input
          label={t('providers.defaultModel', '默认模型')}
          value={draft.model || ''}
          onChange={(event) => onUpdateDraft((current) => ({ ...current, model: event.target.value }))}
          placeholder="e.g. gpt-4.1-mini / deepseek-v4-flash"
        />

        <ProviderPricingInputs draft={draft} onUpdateDraft={onUpdateDraft} />

        <ProviderModelsManager draft={draft} onUpdateDraft={onUpdateDraft} />

        <div className="col-span-1 md:col-span-2 flex items-center justify-end gap-2 pt-2">
          <Button variant="secondary" size="sm" onClick={onSave}>
            <Save size={14} /> {t('common.save', '保存')}
          </Button>
          <Button variant="danger" size="sm" onClick={onDelete}>
            <Trash2 size={14} /> {t('common.remove', '删除')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ProvidersPage() {
  const { t } = useTranslation();
  const {
    modelProviders,
    providerDrafts,
    loading,
    notice,
    updateDraft,
    handleAdd,
    handleSave,
    handleDelete,
  } = useModelProviders();

  if (loading && modelProviders.length === 0) {
    return <div className="flex h-64 items-center justify-center text-sm text-slate-400 animate-pulse">Loading providers...</div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t('providers.title', 'AI 服务商')}
        description={t('providers.description', '配置和管理全局 AI 模型服务商的 API Key、Base URL 及默认模型。')}
        actions={
          <Button onClick={handleAdd}>
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
            {modelProviders.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                draft={providerDrafts[provider.id] || providerToDraft(provider)}
                onUpdateDraft={(updater) => updateDraft(provider.id, updater)}
                onSave={() => void handleSave(provider.id)}
                onDelete={() => void handleDelete(provider.id)}
              />
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
