import { Plus, Save, Settings, Trash2 } from 'lucide-react';
import { Button, EmptyState, Input, Select, StatusPill } from '@/components/ui';
import {
  DEFAULT_SANDBOX_PROVIDER_ID,
  DESKTOP_AGENT_TYPE_OPTIONS,
  DESKTOP_DEPLOYMENT_PROFILES,
  defaultSandboxRuntimeImage,
  getDefaultDesktopAgentModel,
  normalizeDesktopAgentModel,
  type DesktopDeploymentProfile,
  type DesktopModelProvider,
  type DesktopModelProviderInput,
  type DesktopProjectConfig,
  type DesktopProviderConfig,
  type DesktopSandboxProviderConfig,
  type DesktopSandboxRuntimeImage,
} from '@cc/superai-contracts';
import {
  applyProviderPreset,
  CUSTOM_SELECT_VALUE,
  getProviderPresetValue,
  getSelectValue,
  platformSummary,
  PROVIDER_PRESETS,
  providerToDraft,
  type SandboxForm,
} from './workspace-model';

type ProjectUpdater = (updater: (project: DesktopProjectConfig) => DesktopProjectConfig) => void;
type SandboxUpdater = (updater: (sandbox: SandboxForm) => SandboxForm) => void;

type BasicProjectSectionProps = {
  project: DesktopProjectConfig;
  updateProject: ProjectUpdater;
};

export function BasicProjectSection({ project, updateProject }: BasicProjectSectionProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Input
        label="Project name"
        value={project.name}
        onChange={(event) => updateProject((current) => ({ ...current, name: event.target.value }))}
      />
      <Select
        label="Agent type"
        value={getSelectValue(project.agent?.type || '', DESKTOP_AGENT_TYPE_OPTIONS)}
        onChange={(event) =>
          updateProject((current) => {
            const type = event.target.value === CUSTOM_SELECT_VALUE ? current.agent.type : event.target.value;
            return {
              ...current,
              agent: {
                ...current.agent,
                type,
                options: {
                  ...(current.agent.options || {}),
                  model: normalizeDesktopAgentModel(type, String(current.agent.options?.model || '')),
                },
              },
            };
          })
        }
      >
        {DESKTOP_AGENT_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
        <option value={CUSTOM_SELECT_VALUE}>custom</option>
      </Select>
      <Input
        label="Host workspace path"
        value={String(project.agent?.options?.work_dir || '')}
        onChange={(event) =>
          updateProject((current) => ({
            ...current,
            agent: { ...current.agent, options: { ...(current.agent.options || {}), work_dir: event.target.value } },
          }))
        }
      />
      <Input
        label="Default model"
        value={String(project.agent?.options?.model || '')}
        onChange={(event) =>
          updateProject((current) => ({
            ...current,
            agent: { ...current.agent, options: { ...(current.agent.options || {}), model: event.target.value } },
          }))
        }
        placeholder={getDefaultDesktopAgentModel(project.agent?.type) || 'Use agent default model'}
      />
    </div>
  );
}

type ProvidersSectionProps = {
  project: DesktopProjectConfig;
  modelProviders: DesktopModelProvider[];
  providerDrafts: Record<string, DesktopModelProviderInput>;
  updateProject: ProjectUpdater;
  updateProviderDraft: (providerId: string, updater: (provider: DesktopModelProviderInput) => DesktopModelProviderInput) => void;
  onAddProvider: () => void;
  onSaveProvider: (providerId: string) => void;
  onDeleteProvider: (providerId: string) => void;
};

export function ProvidersSection({
  project,
  modelProviders,
  providerDrafts,
  updateProject,
  updateProviderDraft,
  onAddProvider,
  onSaveProvider,
  onDeleteProvider,
}: ProvidersSectionProps) {
  return (
    <section className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Select
          label="Project provider"
          value={String(project.agent?.options?.provider_id || '')}
          onChange={(event) =>
            updateProject((current) => ({
              ...current,
              agent: {
                ...current.agent,
                options: {
                  ...(current.agent.options || {}),
                  provider_id: event.target.value,
                },
              },
            }))
          }
        >
          <option value="">No provider</option>
          {modelProviders.map((provider) => (
            <option key={provider.id} value={provider.id}>{provider.name}</option>
          ))}
        </Select>
        <Input
          label="Model override"
          value={String(project.agent?.options?.model || '')}
          onChange={(event) =>
            updateProject((current) => ({
              ...current,
              agent: { ...current.agent, options: { ...(current.agent.options || {}), model: event.target.value } },
            }))
          }
          placeholder="Use provider default model"
        />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-950 dark:text-white">Shared providers</h3>
          <p className="mt-1 text-sm text-muted-foreground">Providers are shared and selected by projects.</p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={onAddProvider}
        >
          <Plus size={14} /> Add provider
        </Button>
      </div>
      {modelProviders.length === 0 ? (
        <div className="rounded-xl border border-black/10 px-4 py-4 text-sm text-muted-foreground dark:border-white/[0.08]">
          No shared providers configured.
        </div>
      ) : (
        <div className="space-y-3">
          {modelProviders.map((provider) => {
            const draft = providerDrafts[provider.id] || providerToDraft(provider);
            return (
              <div key={provider.id} className="app-surface p-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Select
                    label="Preset"
                    value={getProviderPresetValue(draft as DesktopProviderConfig)}
                    onChange={(event) => {
                      if (event.target.value !== CUSTOM_SELECT_VALUE) {
                        updateProviderDraft(provider.id, (current) => applyProviderPreset(current as DesktopProviderConfig, event.target.value));
                      }
                    }}
                  >
                    {PROVIDER_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
                    <option value={CUSTOM_SELECT_VALUE}>custom</option>
                  </Select>
                  <Input label="Name" value={draft.name || ''} onChange={(event) => updateProviderDraft(provider.id, (current) => ({ ...current, name: event.target.value }))} />
                  <Input label="API key" type="password" value={draft.api_key || ''} onChange={(event) => updateProviderDraft(provider.id, (current) => ({ ...current, api_key: event.target.value }))} />
                  <Input label="Base URL" value={draft.base_url || ''} onChange={(event) => updateProviderDraft(provider.id, (current) => ({ ...current, base_url: event.target.value }))} />
                  <Input label="Default model" value={draft.model || ''} onChange={(event) => updateProviderDraft(provider.id, (current) => ({ ...current, model: event.target.value }))} />
                  <div className="flex items-end gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onSaveProvider(provider.id)}
                    >
                      <Save size={14} /> Save
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => onDeleteProvider(provider.id)}
                    >
                      <Trash2 size={14} /> Remove
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

type PlatformsSectionProps = {
  project: DesktopProjectConfig;
  updateProject: ProjectUpdater;
  onOpenPlatformDialog: (index: number | null) => void;
};

export function PlatformsSection({ project, updateProject, onOpenPlatformDialog }: PlatformsSectionProps) {
  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-950 dark:text-white">Platforms</h3>
          <p className="mt-1 text-sm text-muted-foreground">Configure each platform with its own required connection fields.</p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onOpenPlatformDialog(null)}
        >
          <Plus size={14} /> Platform
        </Button>
      </div>
      {(project.platforms || []).length === 0 ? (
        <EmptyState message="No platforms configured." />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {(project.platforms || []).map((platform, index) => (
            <div key={`${platform.type}-${index}`} className="app-list-row flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-950 dark:text-white">{platform.type}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{platformSummary(platform)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="secondary" size="sm" className="app-icon-button" onClick={() => onOpenPlatformDialog(index)} aria-label={`Configure ${platform.type}`}>
                  <Settings size={14} />
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  className="app-icon-button"
                  onClick={() =>
                    updateProject((current) => {
                      const platforms = [...(current.platforms || [])];
                      platforms.splice(index, 1);
                      return { ...current, platforms };
                    })
                  }
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

type SandboxSectionProps = {
  project: DesktopProjectConfig;
  sandbox: SandboxForm;
  profile: DesktopDeploymentProfile;
  sandboxProvider: DesktopSandboxProviderConfig;
  runtimeImage: DesktopSandboxRuntimeImage;
  updateSandbox: SandboxUpdater;
  updateDeploymentProfile: (profileId: string) => void;
};

export function SandboxSection({
  project,
  sandbox,
  profile,
  sandboxProvider,
  runtimeImage,
  updateSandbox,
  updateDeploymentProfile,
}: SandboxSectionProps) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-950 dark:text-white">云端模式</h3>
          <p className="mt-1 text-sm text-muted-foreground">通过 OpenSandbox 为 Agent 运行启动独立容器。</p>
        </div>
        <StatusPill tone={sandbox.enabled ? 'success' : 'neutral'}>
          {sandbox.enabled ? 'Enabled' : 'Local'}
        </StatusPill>
      </div>

      <label className="app-toolbar flex items-center gap-3 text-sm font-medium text-slate-950 dark:text-white">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-black/20 dark:border-white/20"
          checked={sandbox.enabled}
          onChange={(event) => updateSandbox((current) => ({
            ...current,
            enabled: event.target.checked,
            provider_id: current.provider_id || DEFAULT_SANDBOX_PROVIDER_ID,
            runtime_image_id: current.runtime_image_id || defaultSandboxRuntimeImage(project?.agent?.type || 'pi').id,
          }))}
        />
        启用云端模式（Sandbox）
      </label>

      {sandbox.enabled ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Select
              label="Deployment"
              value={profile.id}
              onChange={(event) => updateDeploymentProfile(event.target.value)}
            >
              {DESKTOP_DEPLOYMENT_PROFILES.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </Select>
            <Select
              label="State scope"
              value={sandbox.state_scope}
              onChange={(event) => updateSandbox((current) => ({ ...current, state_scope: event.target.value as SandboxForm['state_scope'] }))}
            >
              <option value="user">User</option>
              <option value="project">Project</option>
              <option value="thread">Thread</option>
              <option value="run">Run</option>
            </Select>
            <Input
              label="CPU"
              value={sandbox.cpu}
              onChange={(event) => updateSandbox((current) => ({ ...current, cpu: event.target.value }))}
            />
            <Input
              label="Memory"
              value={sandbox.memory}
              onChange={(event) => updateSandbox((current) => ({ ...current, memory: event.target.value }))}
            />
            <Input
              label="Timeout seconds"
              type="number"
              value={sandbox.timeout_seconds}
              onChange={(event) => updateSandbox((current) => ({ ...current, timeout_seconds: event.target.value }))}
            />
            <Select
              label="Sandbox lifecycle"
              value={sandbox.sandbox_lifecycle}
              onChange={(event) => updateSandbox((current) => ({ ...current, sandbox_lifecycle: event.target.value as SandboxForm['sandbox_lifecycle'] }))}
            >
              <option value="per_thread">Keep warm per thread</option>
              <option value="per_run">Close after each run</option>
            </Select>
            <Input
              label="Idle seconds"
              type="number"
              value={sandbox.idle_seconds}
              onChange={(event) => updateSandbox((current) => ({ ...current, idle_seconds: event.target.value }))}
            />
            <Input
              label="Warm pool"
              type="number"
              value={sandbox.warm_pool_size}
              onChange={(event) => updateSandbox((current) => ({ ...current, warm_pool_size: event.target.value }))}
            />
          </div>
          <div className="rounded-xl border border-black/10 px-4 py-3 text-sm text-muted-foreground dark:border-white/[0.08]">
            <div className="font-medium text-slate-950 dark:text-white">当前运行配置</div>
            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
              <div>OpenSandbox: {sandboxProvider.server_url || 'not configured'}</div>
              <div>Image: {runtimeImage.image}</div>
              <div>ACP port: {runtimeImage.acp_port}</div>
              <div>Sandbox workspace path: {runtimeImage.workspace_mount_path || profile.workspaceMountPath}</div>
              <div>State mount: {runtimeImage.state_mount_path || profile.stateMountPath}</div>
              <div>API key env: {sandboxProvider.api_key_env || 'OPEN_SANDBOX_API_KEY'}</div>
            </div>
          </div>
          <details className="rounded-xl border border-black/10 px-4 py-3 text-sm dark:border-white/[0.08]">
            <summary className="cursor-pointer font-medium text-slate-950 dark:text-white">Advanced</summary>
            <div className="mt-3 text-muted-foreground">
              Host workspace path 是 OpenSandbox 挂载源；Sandbox workspace path 是 Agent 容器内的工作目录。Core 只启动代理进程，不直接使用 host workspace path 作为代理工作目录。
            </div>
          </details>
        </div>
      ) : (
        <div className="rounded-xl border border-black/10 px-4 py-3 text-sm text-muted-foreground dark:border-white/[0.08]">
          当前项目会继续使用本地 Agent runtime。
        </div>
      )}
    </section>
  );
}
