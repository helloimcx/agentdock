import { useState } from 'react';
import { Bot, Cloud, FolderKanban, FolderOpen, Plug, Plus, QrCode, Save, Trash2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Button, EmptyState, Input, Modal, SectionCard, Select, StatusPill } from '@/components/ui';
import { DirectoryPickerModal } from './DirectoryPickerModal';
import {
  DESKTOP_AGENT_TYPE_OPTIONS,
  DESKTOP_PLATFORM_TYPE_OPTIONS,
  getDefaultDesktopAgentModel,
  type DesktopDeploymentProfile,
  type DesktopModelProvider,
  type DesktopPlatformConfig,
  type DesktopProjectConfig,
  type DesktopSandboxProviderConfig,
  type DesktopSandboxRuntimeImage,
} from '@cc/superai-contracts';
import { BasicProjectSection, McpServersSection, PlatformsSection, ProvidersSection, SandboxSection, StandardsSection } from './workspace-sections';
import { WorkspaceMemorySection } from './WorkspaceMemorySection';
import {
  CUSTOM_SELECT_VALUE,
  PLATFORM_TYPE_OPTIONS,
  desktopProjectWorkspaceId,
  getSelectValue,
  toSandboxForm,
  workDirLabel,
  type LarkQrState,
  type PlatformDialogState,
  type ProjectDialogDraft,
  type ProjectTab,
  type SandboxForm,
  type WeixinQrState,
} from './workspace-model';

type ProjectListPanelProps = {
  projects: DesktopProjectConfig[];
  selectedIndex: number;
  onAddProject: () => void;
  onSelectProject: (index: number, project: DesktopProjectConfig) => void;
  onRemoveProject: (index: number, project: DesktopProjectConfig) => void;
};

export function ProjectListPanel({
  projects,
  selectedIndex,
  onAddProject,
  onSelectProject,
  onRemoveProject,
}: ProjectListPanelProps) {
  return (
    <SectionCard
      title="项目"
      actions={<Button size="sm" onClick={onAddProject}><Plus size={14} /> 新建项目</Button>}
      className="app-panel lg:self-start"
    >
      {projects.length === 0 ? (
        <EmptyState message="还没有项目。" />
      ) : (
        <div className="space-y-2">
          {projects.map((project, index) => (
            <div
              key={`${project.name}-${index}`}
              className={`flex items-center justify-between gap-2 ${
                index === selectedIndex
                  ? 'app-list-row app-list-row-active'
                  : 'app-list-row'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectProject(index, project)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate text-sm font-medium text-slate-950 dark:text-white">{project.name || `Project ${index + 1}`}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {project.agent?.type || 'unknown'} · {workDirLabel(project)} · {project.platforms?.length || 0} platforms
                </p>
              </button>
              <Button
                variant="ghost"
                size="sm"
                className="app-icon-button shrink-0"
                onClick={() => onRemoveProject(index, project)}
                aria-label={`Remove ${project.name}`}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

type ProjectOverviewCardsProps = {
  project: DesktopProjectConfig;
  sandbox: SandboxForm;
};

export function ProjectOverviewCards({ project, sandbox }: ProjectOverviewCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
      <div className="app-surface p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Bot size={14} /> Agent</div>
        <p className="mt-2 truncate text-sm font-semibold text-foreground">{project.agent?.type || 'unknown'}</p>
      </div>
      <div className="app-surface p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><FolderKanban size={14} /> Workspace</div>
        <p className="mt-2 truncate text-sm font-semibold text-foreground">{workDirLabel(project)}</p>
      </div>
      <div className="app-surface p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Plug size={14} /> Platforms</div>
        <p className="mt-2 truncate text-sm font-semibold text-foreground">{project.platforms?.length || 0} configured</p>
      </div>
      <div className="app-surface p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Cloud size={14} /> Sandbox</div>
        <p className="mt-2 truncate text-sm font-semibold text-foreground">{sandbox.enabled ? 'Cloud enabled' : 'Local runtime'}</p>
      </div>
    </div>
  );
}

type PlatformDialogProps = {
  dialog: PlatformDialogState | null;
  weixinQr: WeixinQrState | null;
  weixinQrLoading: boolean;
  larkQr: LarkQrState | null;
  larkQrLoading: boolean;
  onChangeType: (type: string) => void;
  onUpdateDraft: (updater: (platform: DesktopPlatformConfig) => DesktopPlatformConfig) => void;
  onClose: () => void;
  onApply: () => void;
  onGenerateWeixinQr: () => void;
  onCheckWeixinQr: () => void;
  onGenerateLarkQr: () => void;
  onCheckLarkQr: () => void;
};

export function PlatformDialog({
  dialog,
  weixinQr,
  weixinQrLoading,
  larkQr,
  larkQrLoading,
  onChangeType,
  onUpdateDraft,
  onClose,
  onApply,
  onGenerateWeixinQr,
  onCheckWeixinQr,
  onGenerateLarkQr,
  onCheckLarkQr,
}: PlatformDialogProps) {
  return (
    <Modal
      open={Boolean(dialog)}
      onClose={onClose}
      title={dialog?.index === null ? 'Add platform' : 'Configure platform'}
    >
      {dialog ? (
        <div className="space-y-4">
          <Select
            label="Platform"
            value={getSelectValue(dialog.draft.type, [...PLATFORM_TYPE_OPTIONS])}
            onChange={(event) => {
              const next = event.target.value === CUSTOM_SELECT_VALUE ? dialog.draft.type : event.target.value;
              onChangeType(next);
            }}
          >
            {PLATFORM_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            {DESKTOP_PLATFORM_TYPE_OPTIONS
              .filter((option) => !PLATFORM_TYPE_OPTIONS.includes(option as never))
              .map((option) => <option key={option} value={option}>{option}</option>)}
            <option value={CUSTOM_SELECT_VALUE}>custom</option>
          </Select>

          {dialog.draft.type === 'lark' ? (
            <div className="grid grid-cols-1 gap-3">
              {larkQr?.qrCodeUrl ? (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-black/10 p-4 dark:border-white/[0.08]">
                  <div className="rounded-lg border border-black/10 bg-white p-3">
                    <QRCodeSVG value={larkQr.qrCodeUrl} size={176} includeMargin />
                  </div>
                  <StatusPill tone={larkQr.status === 'confirmed' ? 'success' : larkQr.status === 'expired' ? 'danger' : 'warning'}>
                    {larkQr.botName || larkQr.status || 'wait'}
                  </StatusPill>
                </div>
              ) : null}
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button className="w-full sm:w-auto" variant="secondary" onClick={() => void onGenerateLarkQr()} loading={larkQrLoading}>
                  <QrCode size={14} /> Generate QR
                </Button>
                <Button className="w-full sm:w-auto" variant="secondary" onClick={() => void onCheckLarkQr()} loading={larkQrLoading} disabled={!larkQr?.ticket}>
                  Check status
                </Button>
              </div>
              <Input
                label="App ID"
                value={String(dialog.draft.options?.app_id || '')}
                onChange={(event) => onUpdateDraft((platform) => ({ ...platform, options: { ...(platform.options || {}), app_id: event.target.value } }))}
                placeholder="cli_xxx"
              />
              <Input
                label="App Secret"
                type="password"
                value={String(dialog.draft.options?.app_secret || '')}
                onChange={(event) => onUpdateDraft((platform) => ({ ...platform, options: { ...(platform.options || {}), app_secret: event.target.value } }))}
              />
              <Input
                label="Downloads directory"
                value={String(dialog.draft.options?.downloads_dir || '')}
                onChange={(event) => onUpdateDraft((platform) => ({ ...platform, options: { ...(platform.options || {}), downloads_dir: event.target.value } }))}
                placeholder=".agentdock/channel-uploads/lark/<instanceId>"
              />
              <Input
                label="Verification token"
                value={String(dialog.draft.options?.verification_token || '')}
                onChange={(event) => onUpdateDraft((platform) => ({ ...platform, options: { ...(platform.options || {}), verification_token: event.target.value } }))}
              />
              <Input
                label="Encrypt key"
                value={String(dialog.draft.options?.encrypt_key || '')}
                onChange={(event) => onUpdateDraft((platform) => ({ ...platform, options: { ...(platform.options || {}), encrypt_key: event.target.value } }))}
              />
              <label className="flex items-center gap-3 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={dialog.draft.options?.auto_approve === true}
                  onChange={(event) => onUpdateDraft((platform) => ({ ...platform, options: { ...(platform.options || {}), auto_approve: event.target.checked } }))}
                />
                Auto-approve Lark users
              </label>
              <label className="flex items-center gap-3 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={dialog.draft.options?.card_actions === true}
                  onChange={(event) => onUpdateDraft((platform) => ({ ...platform, options: { ...(platform.options || {}), card_actions: event.target.checked } }))}
                />
                Enable Lark card action buttons
              </label>
            </div>
          ) : null}

          {dialog.draft.type === 'weixin' ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-black/10 bg-black/[0.03] px-3 py-3 text-sm text-muted-foreground dark:border-white/[0.08] dark:bg-white/[0.04]">
                WeChat does not need an App ID or secret. Save this platform, then generate a QR code and scan it to finish login.
              </div>
              {weixinQr?.qrCodeUrl ? (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-black/10 p-4 dark:border-white/[0.08]">
                  <div className="rounded-lg border border-black/10 bg-white p-3">
                    <QRCodeSVG value={weixinQr.qrCodeUrl} size={176} includeMargin />
                  </div>
                  <StatusPill tone={weixinQr.status === 'confirmed' ? 'success' : weixinQr.status === 'expired' ? 'danger' : 'warning'}>
                    {weixinQr.status || 'wait'}
                  </StatusPill>
                </div>
              ) : null}
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button className="w-full sm:w-auto" variant="secondary" onClick={() => void onGenerateWeixinQr()} loading={weixinQrLoading}>
                  <QrCode size={14} /> Generate QR
                </Button>
                <Button className="w-full sm:w-auto" variant="secondary" onClick={() => void onCheckWeixinQr()} loading={weixinQrLoading} disabled={!weixinQr?.ticket}>
                  Check status
                </Button>
              </div>
            </div>
          ) : null}

          {dialog.draft.type !== 'lark' && dialog.draft.type !== 'weixin' ? (
            <div className="rounded-lg border border-black/10 bg-black/[0.03] px-3 py-3 text-sm text-muted-foreground dark:border-white/[0.08] dark:bg-white/[0.04]">
              This platform has no daily UI fields yet. Existing advanced options are preserved in config.
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-2 border-t border-black/10 pt-4 dark:border-white/[0.08] sm:flex-row sm:justify-end">
            <Button className="w-full sm:w-auto" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button className="w-full sm:w-auto" onClick={onApply}>
              <Save size={14} /> Apply
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

type AddProjectDialogProps = {
  dialog: ProjectDialogDraft | null;
  updateDialog: (patch: Partial<ProjectDialogDraft>) => void;
  onConfirm: () => void;
  onClose: () => void;
  meshNodes?: import('@cc/superai-contracts').MeshNode[];
};

export function AddProjectDialog({ dialog, updateDialog, onConfirm, onClose, meshNodes }: AddProjectDialogProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <>
      <Modal
        open={Boolean(dialog)}
        onClose={onClose}
        title="新建项目"
      >
        {dialog ? (
          <div className="space-y-4">
            <Input
              label="Project name"
              value={dialog.name}
              onChange={(event) => updateDialog({ name: event.target.value })}
              autoFocus
            />
            <Select
              label="Agent type"
              value={dialog.agentType}
              onChange={(event) => updateDialog({ agentType: event.target.value })}
            >
              {DESKTOP_AGENT_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </Select>
            <Select
              label="Execution device"
              value={dialog.deviceId || 'local'}
              onChange={(event) => updateDialog({ deviceId: event.target.value })}
            >
              <option value="local">本机 (Local)</option>
              {(meshNodes || []).map((node) => (
                <option key={node.id} value={node.id.startsWith('node:') ? node.id : `node:${node.id}`}>
                  {node.label || node.id} ({node.platform}) - {node.status}
                </option>
              ))}
            </Select>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  label="Host workspace path"
                  value={dialog.workDir}
                  onChange={(event) => updateDialog({ workDir: event.target.value })}
                  placeholder={dialog.deviceId && dialog.deviceId !== 'local' ? '例如 . 或 my-project (remote path)' : '/Users/yinyin/code/my-project'}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 px-3 gap-1.5 shrink-0"
                onClick={() => setPickerOpen(true)}
                title="选择目录"
              >
                <FolderOpen size={15} />
                选择目录
              </Button>
            </div>
            <Input
              label="Default model"
              value={dialog.model}
              onChange={(event) => updateDialog({ model: event.target.value })}
              placeholder={getDefaultDesktopAgentModel(dialog.agentType) || 'Use agent default model'}
            />
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <Button className="w-full sm:w-auto" variant="secondary" onClick={onClose}>Cancel</Button>
              <Button className="w-full sm:w-auto" onClick={onConfirm}><Plus size={14} /> 新建项目</Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {dialog && (
        <DirectoryPickerModal
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={(selectedPath) => updateDialog({ workDir: selectedPath })}
          initialPath={dialog.workDir}
          deviceId={dialog.deviceId || 'local'}
          deviceLabel={
            dialog.deviceId && dialog.deviceId !== 'local'
              ? meshNodes?.find((n) => n.id === dialog.deviceId || `node:${n.id}` === dialog.deviceId)?.label || dialog.deviceId
              : '本机 (Local)'
          }
        />
      )}
    </>
  );
}

type ProjectDetailsProps = {
  project: DesktopProjectConfig | null;
  sandbox: SandboxForm;
  profile: DesktopDeploymentProfile;
  sandboxProvider: DesktopSandboxProviderConfig;
  runtimeImage: DesktopSandboxRuntimeImage;
  projectTab: ProjectTab;
  setProjectTab: (tab: ProjectTab) => void;
  modelProviders: DesktopModelProvider[];
  configDirty: boolean;
  pending: string;
  updateProject: (updater: (project: DesktopProjectConfig) => DesktopProjectConfig) => void;
  updateSandbox: (updater: (sandbox: SandboxForm) => SandboxForm) => void;
  updateDeploymentProfile: (profileId: string) => void;
  openPlatformDialog: (index: number | null) => void;
  onSaveConfig: () => void;
  meshNodes?: import('@cc/superai-contracts').MeshNode[];
};

const PROJECT_TABS: Array<[ProjectTab, string]> = [
  ['basic', '基本信息'],
  ['providers', 'Provider'],
  ['platforms', '平台接入'],
  ['sandbox', '云端模式'],
  ['mcp', 'MCP'],
  ['standards', '编码规范'],
  ['memory', '工作记忆'],
];

type ProjectTabContentProps = {
  project: DesktopProjectConfig;
  projectTab: ProjectTab;
  modelProviders: DesktopModelProvider[];
  sandbox: SandboxForm;
  profile: DesktopDeploymentProfile;
  sandboxProvider: DesktopSandboxProviderConfig;
  runtimeImage: DesktopSandboxRuntimeImage;
  updateProject: (updater: (project: DesktopProjectConfig) => DesktopProjectConfig) => void;
  updateSandbox: (updater: (sandbox: SandboxForm) => SandboxForm) => void;
  updateDeploymentProfile: (profileId: string) => void;
  openPlatformDialog: (index: number | null) => void;
  meshNodes?: import('@cc/superai-contracts').MeshNode[];
};

function ProjectTabContent({
  project,
  projectTab,
  modelProviders,
  sandbox,
  profile,
  sandboxProvider,
  runtimeImage,
  updateProject,
  updateSandbox,
  updateDeploymentProfile,
  openPlatformDialog,
  meshNodes,
}: ProjectTabContentProps) {
  if (projectTab === 'basic') {
    return <BasicProjectSection project={project} updateProject={updateProject} meshNodes={meshNodes} />;
  }
  if (projectTab === 'providers') {
    return <ProvidersSection project={project} modelProviders={modelProviders} updateProject={updateProject} />;
  }
  if (projectTab === 'platforms') {
    return <PlatformsSection project={project} updateProject={updateProject} onOpenPlatformDialog={openPlatformDialog} />;
  }
  if (projectTab === 'sandbox') {
    return (
      <SandboxSection
        project={project}
        sandbox={sandbox}
        profile={profile}
        sandboxProvider={sandboxProvider}
        runtimeImage={runtimeImage}
        updateSandbox={updateSandbox}
        updateDeploymentProfile={updateDeploymentProfile}
      />
    );
  }
  if (projectTab === 'mcp') {
    return <McpServersSection project={project} updateProject={updateProject} />;
  }
  if (projectTab === 'standards') {
    return <StandardsSection project={project} updateProject={updateProject} />;
  }
  return <WorkspaceMemorySection workspaceId={desktopProjectWorkspaceId(project)} />;
}

export function ProjectDetails({
  project,
  sandbox,
  profile,
  sandboxProvider,
  runtimeImage,
  projectTab,
  setProjectTab,
  modelProviders,
  configDirty,
  pending,
  updateProject,
  updateSandbox,
  updateDeploymentProfile,
  openPlatformDialog,
  onSaveConfig,
  meshNodes,
}: ProjectDetailsProps) {
  return (
    <SectionCard
      title={project?.name || 'Project details'}
      description={project ? (
        <span className="break-all">
          {project.agent?.type || 'unknown'} · {String(project.agent?.options?.work_dir || 'No work directory')}
        </span>
      ) : undefined}
      className="app-panel"
    >
      {!project ? (
        <EmptyState message="选择或新建项目后开始配置。" />
      ) : (
        <div className="space-y-6">
          <ProjectOverviewCards project={project} sandbox={sandbox} />

          <div className="flex gap-2 overflow-x-auto border-b border-black/10 pb-4 [scrollbar-width:none] dark:border-white/[0.08] [&::-webkit-scrollbar]:hidden sm:flex-wrap">
            {PROJECT_TABS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setProjectTab(key)}
                className={`app-segment ${
                  projectTab === key
                    ? 'app-segment-active'
                    : 'app-segment-idle'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <ProjectTabContent
            project={project}
            projectTab={projectTab}
            modelProviders={modelProviders}
            sandbox={sandbox}
            profile={profile}
            sandboxProvider={sandboxProvider}
            runtimeImage={runtimeImage}
            updateProject={updateProject}
            updateSandbox={updateSandbox}
            updateDeploymentProfile={updateDeploymentProfile}
            openPlatformDialog={openPlatformDialog}
            meshNodes={meshNodes}
          />

          <div className="flex flex-wrap gap-2 border-t border-black/10 pt-5 dark:border-white/[0.08]">
            <Button className="w-full sm:w-auto" onClick={onSaveConfig} loading={pending === 'config'} disabled={!configDirty && pending !== 'config'}>
              <Save size={14} /> 保存更改
            </Button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
