import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Save } from 'lucide-react';
import { Button, EmptyState, Input, Modal, PageHeader, SectionCard, Select } from '@/components/ui';
import {
  checkWeixinQrCodeStatus,
  getWeixinQrCode,
} from '@cc/core-sdk/channels';
import {
  listModelProviders,
  readCoreRuntimeConfig as readRuntimeConfig,
  saveCoreRuntimeConfig as saveRuntimeConfig,
} from '@cc/core-sdk/runtime';
import {
  DESKTOP_AGENT_TYPE_OPTIONS,
  defaultSandboxProviderForProfile,
  defaultSandboxRuntimeImage,
  getDesktopDeploymentProfile,
  getDefaultDesktopAgentModel,
} from '@cc/superai-contracts';
import type {
  DesktopConnectConfig,
  DesktopModelProvider,
  DesktopModelProviderInput,
  DesktopPlatformConfig,
  DesktopProjectConfig,
} from '@cc/superai-contracts';
import {
  clone,
  createPlatformDraft,
  createProjectDialogDraft,
  ensureProjects,
  fromSandboxForm,
  getPlatformInstanceId,
  normalizePlatformDraft,
  normalizeProject,
  noticeClass,
  providerToDraft,
  toSandboxForm,
  type Notice,
  type PlatformDialogState,
  type ProjectDialogDraft,
  type ProjectTab,
  type SandboxForm,
  type WeixinQrState,
} from './workspace-model';
import { AddProjectDialog, PlatformDialog, ProjectDetails, ProjectListPanel, ProjectOverviewCards } from './workspace-components';
import { BasicProjectSection, PlatformsSection, ProvidersSection, SandboxSection } from './workspace-sections';
import { useLarkQr } from './workspace-hooks';

export default function DesktopWorkspace() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedProject = searchParams.get('project') || '';
  const [configDraft, setConfigDraft] = useState<DesktopConnectConfig | null>(null);
  const [persistedConfig, setPersistedConfig] = useState<DesktopConnectConfig | null>(null);
  const [modelProviders, setModelProviders] = useState<DesktopModelProvider[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [projectTab, setProjectTab] = useState<ProjectTab>('basic');
  const [projectDialog, setProjectDialog] = useState<ProjectDialogDraft | null>(null);
  const [platformDialog, setPlatformDialog] = useState<PlatformDialogState | null>(null);
  const [weixinQr, setWeixinQr] = useState<WeixinQrState | null>(null);
  const [weixinQrLoading, setWeixinQrLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const configDraftRef = useRef<DesktopConnectConfig | null>(null);

  const loadAll = useCallback(async (projectName = '') => {
    setLoading(true);
    try {
      const [configState, providerState] = await Promise.all([
        readRuntimeConfig(),
        listModelProviders(),
      ]);
      const parsed = clone(configState.config || {});
      parsed.projects = ensureProjects(parsed).map((project) => normalizeProject(project));
      setConfigDraft(parsed);
      setPersistedConfig(clone(parsed));
      setModelProviders(providerState.providers || []);
      if (projectName) {
        const index = (parsed.projects || []).findIndex((project) => project.name === projectName);
        setSelectedIndex(index >= 0 ? index : 0);
      }
    } catch (err) {
      setNotice({ tone: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll(requestedProject);
  }, [loadAll]);

  const projects = configDraft?.projects || [];
  const selectedProject = projects[selectedIndex] || null;
  const selectedSandbox = toSandboxForm(selectedProject?.agent?.options?.sandbox);
  const selectedProfile = getDesktopDeploymentProfile(String(configDraft?.deployment_profile || '').trim());
  const selectedSandboxProvider = (configDraft?.sandbox_providers || []).find((provider) => provider.id === selectedSandbox.provider_id)
    || defaultSandboxProviderForProfile(selectedProfile.id);
  const selectedSandboxRuntimeImage = (configDraft?.sandbox_runtime_images || []).find((image) => image.id === selectedSandbox.runtime_image_id)
    || defaultSandboxRuntimeImage(selectedProject?.agent?.type || 'pi');
  const configDirty = JSON.stringify(configDraft || {}) !== JSON.stringify(persistedConfig || {});

  useEffect(() => {
    configDraftRef.current = configDraft;
  }, [configDraft]);

  useEffect(() => {
    if (!configDraft || !requestedProject) return;
    const index = projects.findIndex((project) => project.name === requestedProject);
    if (index >= 0 && index !== selectedIndex) {
      setSelectedIndex(index);
    }
  }, [configDraft, projects, requestedProject, selectedIndex]);

  const updateSelectedProject = useCallback((updater: (project: DesktopProjectConfig) => DesktopProjectConfig) => {
    setConfigDraft((current) => {
      if (!current) return current;
      const next = clone(current);
      const nextProjects = ensureProjects(next);
      const project = nextProjects[selectedIndex];
      if (!project) return current;
      nextProjects[selectedIndex] = normalizeProject(updater(project));
      return next;
    });
  }, [selectedIndex]);

  const updateSelectedSandbox = useCallback((updater: (sandbox: SandboxForm) => SandboxForm) => {
    updateSelectedProject((project) => ({
      ...project,
      agent: {
        ...project.agent,
        options: {
          ...(project.agent.options || {}),
          sandbox: fromSandboxForm(updater(toSandboxForm(project.agent.options?.sandbox))),
        },
      },
    }));
  }, [updateSelectedProject]);

  const updateDeploymentProfile = useCallback((profileId: string) => {
    const profile = getDesktopDeploymentProfile(profileId);
    setConfigDraft((current) => {
      if (!current) return current;
      const next = clone(current);
      next.deployment_profile = profile.id;
      const defaultProvider = defaultSandboxProviderForProfile(profile.id);
      const providers = Array.isArray(next.sandbox_providers) ? [...next.sandbox_providers] : [];
      const existingIndex = providers.findIndex((provider) => provider.id === defaultProvider.id);
      if (existingIndex >= 0) {
        providers[existingIndex] = { ...providers[existingIndex], server_url: defaultProvider.server_url };
      } else {
        providers.push(defaultProvider);
      }
      next.sandbox_providers = providers;
      return next;
    });
  }, []);

  const handleAddProject = () => {
    setProjectDialog(createProjectDialogDraft(projects));
  };

  const updateProjectDialog = (patch: Partial<ProjectDialogDraft>) => {
    setProjectDialog((current) => current ? { ...current, ...patch } : current);
  };

  const handleConfirmAddProject = () => {
    if (!projectDialog) return;
    const name = projectDialog.name.trim();
    const agentType = projectDialog.agentType.trim();
    const workDir = projectDialog.workDir.trim();
    const model = projectDialog.model.trim();
    if (!name || !agentType || !workDir) {
      setNotice({ tone: 'warning', message: 'Project name, agent type, and work directory are required.' });
      return;
    }
    if (projects.some((project) => project.name === name)) {
      setNotice({ tone: 'warning', message: `Project "${name}" already exists.` });
      return;
    }
    const nextProject = normalizeProject({
      name,
      agent: {
        type: agentType,
        options: {
          model: model || getDefaultDesktopAgentModel(agentType),
          work_dir: workDir,
        },
        providers: [],
      },
      platforms: [],
      admin_from: '',
      disabled_commands: [],
    });
    const nextIndex = projects.length;
    setConfigDraft((current) => {
      const next = clone(current || {});
      const nextProjects = ensureProjects(next);
      nextProjects.push(nextProject);
      return next;
    });
    setSelectedIndex(nextIndex);
    setSearchParams({ project: name });
    setProjectDialog(null);
    setNotice(null);
  };

  const handleRemoveProject = (index: number) => {
    setConfigDraft((current) => {
      if (!current) return current;
      const next = clone(current);
      const nextProjects = ensureProjects(next);
      nextProjects.splice(index, 1);
      setSelectedIndex(Math.max(0, Math.min(index, nextProjects.length - 1)));
      return next;
    });
  };

  const openPlatformDialog = (index: number | null) => {
    setWeixinQr(null);
    if (index === null) {
      // A brand-new draft has a fresh instance id, so an in-flight QR for
      // another instance is no longer relevant.
      setLarkQr(null);
      setPlatformDialog({ index, draft: createPlatformDraft() });
      return;
    }
    const platform = selectedProject?.platforms?.[index];
    if (platform) {
      // Keep an in-flight QR when the user reopens the dialog for the same
      // instance (the background poll may have already confirmed it).
      setLarkQr((current) => current && getPlatformInstanceId(platform) === current.instanceId ? current : null);
      setPlatformDialog({ index, draft: clone(platform) });
    }
  };

  const updatePlatformDialogDraft = (updater: (platform: DesktopPlatformConfig) => DesktopPlatformConfig) => {
    setPlatformDialog((current) => current ? { ...current, draft: updater(current.draft) } : current);
  };

  const handleApplyPlatformDialog = () => {
    if (!platformDialog) return;
    const nextPlatform = normalizePlatformDraft(platformDialog.draft);
    updateSelectedProject((project) => {
      const platforms = [...(project.platforms || [])];
      if (platformDialog.index === null) {
        platforms.push(nextPlatform);
      } else {
        platforms[platformDialog.index] = nextPlatform;
      }
      return { ...project, platforms };
    });
    setPlatformDialog(null);
    setWeixinQr(null);
    setLarkQr(null);
  };

  const persistPlatformDialogDraft = async () => {
    if (!platformDialog || !configDraft) return platformDialog?.draft;
    const nextConfig = clone(configDraft);
    const nextProjects = ensureProjects(nextConfig);
    const project = nextProjects[selectedIndex];
    if (!project) return platformDialog.draft;
    const platforms = [...(project.platforms || [])];
    const nextPlatform = normalizePlatformDraft(platformDialog.draft);
    if (platformDialog.index === null) {
      platforms.push(nextPlatform);
    } else {
      platforms[platformDialog.index] = nextPlatform;
    }
    nextProjects[selectedIndex] = normalizeProject({ ...project, platforms });
    const saved = await saveRuntimeConfig(nextConfig);
    const savedConfig = clone(saved.config || nextConfig);
    setPersistedConfig(savedConfig);
    setConfigDraft(clone(savedConfig));
    setPlatformDialog((current) => current ? { index: current.index ?? platforms.length - 1, draft: nextPlatform } : current);
    return nextPlatform;
  };

  const handleGenerateWeixinQr = async () => {
    if (!selectedProject?.name || !configDraft) return;
    setWeixinQrLoading(true);
    try {
      await persistPlatformDialogDraft();
      const result = await getWeixinQrCode(selectedProject.workspace_id || selectedProject.name, getPlatformInstanceId(platformDialog?.draft));
      setWeixinQr({ ...result, status: 'wait', createdAt: Date.now() });
      setNotice(null);
    } catch (err) {
      setNotice({ tone: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setWeixinQrLoading(false);
    }
  };

  const handleCheckWeixinQr = async () => {
    if (!selectedProject?.name || !weixinQr?.ticket) return;
    setWeixinQrLoading(true);
    try {
      const result = await checkWeixinQrCodeStatus(selectedProject.workspace_id || selectedProject.name, weixinQr.ticket, getPlatformInstanceId(platformDialog?.draft));
      setWeixinQr((current) => current ? { ...current, status: result.status } : current);
      if (result.status === 'confirmed') {
        setNotice({ tone: 'success', message: 'WeChat QR code confirmed.' });
      }
    } catch (err) {
      setNotice({ tone: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setWeixinQrLoading(false);
    }
  };

  const {
    larkQr,
    larkQrLoading,
    setLarkQr,
    generateLarkQr,
    checkLarkQr,
  } = useLarkQr({
    selectedProject,
    configDraft,
    platformDialog,
    configDraftRef,
    setNotice,
    setConfigDraft,
    setPersistedConfig,
    setPlatformDialog,
    loadAll,
  });

  const handleSaveConfig = async () => {
    if (!configDraft) return;
    setPending('config');
    try {
      const saved = await saveRuntimeConfig(configDraft);
      setPersistedConfig(clone(saved.config || configDraft));
      setConfigDraft(clone(saved.config || configDraft));
      setNotice({ tone: 'success', message: 'Project changes saved.' });
      await loadAll();
    } catch (err) {
      setNotice({ tone: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setPending('');
    }
  };

  if (loading && !configDraft) {
    return <div className="flex h-64 items-center justify-center text-sm text-slate-400 animate-pulse">Loading workspace...</div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="工作区"
        description="创建项目，配置 Agent、工作目录、Provider 和平台接入。"
      />

      {notice ? (
        <div role="status" className={`rounded-xl border px-4 py-3 text-sm ${noticeClass(notice.tone)}`}>
          {notice.message}
        </div>
      ) : null}

      {configDirty ? (
        <div className="app-toolbar flex flex-col gap-3 border-amber-200 bg-amber-50 text-sm text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
          <span>You have unsaved project changes.</span>
          <Button size="sm" onClick={() => void handleSaveConfig()} loading={pending === 'config'}>
            <Save size={14} /> Save changes
          </Button>
        </div>
      ) : null}

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <ProjectListPanel
          projects={projects}
          selectedIndex={selectedIndex}
          onAddProject={handleAddProject}
          onSelectProject={(index, project) => {
            setSelectedIndex(index);
            setSearchParams(project.name ? { project: project.name } : {});
          }}
          onRemoveProject={(index) => handleRemoveProject(index)}
        />

        <ProjectDetails
          project={selectedProject}
          sandbox={selectedSandbox}
          profile={selectedProfile}
          sandboxProvider={selectedSandboxProvider}
          runtimeImage={selectedSandboxRuntimeImage}
          projectTab={projectTab}
          setProjectTab={setProjectTab}
          modelProviders={modelProviders}
          configDirty={configDirty}
          pending={pending}
          updateProject={updateSelectedProject}
          updateSandbox={updateSelectedSandbox}
          updateDeploymentProfile={updateDeploymentProfile}
          openPlatformDialog={openPlatformDialog}
          onSaveConfig={() => void handleSaveConfig()}
        />
      </div>

      <AddProjectDialog
        dialog={projectDialog}
        updateDialog={updateProjectDialog}
        onConfirm={handleConfirmAddProject}
        onClose={() => setProjectDialog(null)}
      />

      <PlatformDialog
        dialog={platformDialog}
        weixinQr={weixinQr}
        weixinQrLoading={weixinQrLoading}
        larkQr={larkQr}
        larkQrLoading={larkQrLoading}
        onChangeType={(type) => {
          updatePlatformDialogDraft(() => createPlatformDraft(type));
          setWeixinQr(null);
          setLarkQr(null);
        }}
        onUpdateDraft={updatePlatformDialogDraft}
        onClose={() => {
          setPlatformDialog(null);
          // Keep larkQr alive: the background poll may still confirm a scan
          // that happened while the dialog was open.
          setWeixinQr(null);
        }}
        onApply={handleApplyPlatformDialog}
        onGenerateWeixinQr={handleGenerateWeixinQr}
        onCheckWeixinQr={handleCheckWeixinQr}
        onGenerateLarkQr={generateLarkQr}
        onCheckLarkQr={checkLarkQr}
      />
    </div>
  );
}
