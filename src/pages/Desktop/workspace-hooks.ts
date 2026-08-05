import { useCallback, useEffect, useState } from 'react';
import {
  saveCoreRuntimeConfig as saveRuntimeConfig,
} from '@cc/core-sdk/runtime';
import {
  checkLarkQrCodeStatus,
  enableLarkGateway,
  getLarkQrCode,
  testLarkConnection,
} from '@cc/core-sdk/channels';
import type { DesktopConnectConfig } from '@cc/superai-contracts';
import {
  clone,
  createPlatformDraft,
  ensureProjects,
  getPlatformInstanceId,
  normalizePlatformDraft,
  normalizeProject,
  type LarkQrState,
  type Notice,
  type PlatformDialogState,
} from './workspace-model';

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface UseLarkQrParams {
  selectedProject: { name?: string; workspace_id?: string } | null;
  configDraft: DesktopConnectConfig | null;
  platformDialog: PlatformDialogState | null;
  persistPlatformDialogDraft: () => Promise<unknown>;
  selectedProjectWorkspaceIdRef: React.RefObject<string>;
  platformDialogRef: React.RefObject<PlatformDialogState | null>;
  configDraftRef: React.RefObject<DesktopConnectConfig | null>;
  selectedIndexRef: React.RefObject<number>;
  setNotice: (notice: Notice | null) => void;
  setConfigDraft: React.Dispatch<React.SetStateAction<DesktopConnectConfig | null>>;
  setPersistedConfig: React.Dispatch<React.SetStateAction<DesktopConnectConfig | null>>;
  setPlatformDialog: React.Dispatch<React.SetStateAction<PlatformDialogState | null>>;
  loadAll: (projectName?: string) => Promise<void>;
}

interface LarkCredentials {
  appId: string;
  appSecret: string;
  verificationToken?: string;
  encryptKey?: string;
  botName?: string;
}

/**
 * Owns the Lark QR-code binding flow: generating the QR, polling for the scan
 * result, persisting the returned credentials, and activating the gateway.
 * Pulls live values through refs so the polling loop never goes stale.
 */
export function useLarkQr({
  selectedProject,
  configDraft,
  platformDialog,
  persistPlatformDialogDraft,
  selectedProjectWorkspaceIdRef,
  platformDialogRef,
  configDraftRef,
  selectedIndexRef,
  setNotice,
  setConfigDraft,
  setPersistedConfig,
  setPlatformDialog,
  loadAll,
}: UseLarkQrParams) {
  const [larkQr, setLarkQr] = useState<LarkQrState | null>(null);
  const [larkQrLoading, setLarkQrLoading] = useState(false);

  const activateLarkGatewayAfterBind = useCallback(async (workspaceId: string, instanceId: string) => {
    const status = await enableLarkGateway(workspaceId, instanceId);
    if (status.status !== 'running' || status.connected !== true) {
      throw new Error(status.lastError || 'Lark bot credentials were saved, but the gateway is not connected yet.');
    }
    const connection = await testLarkConnection(workspaceId, instanceId);
    if (!connection.success) {
      throw new Error(connection.error || 'Lark bot credentials were saved, but the connection test failed.');
    }
  }, []);

  const saveLarkCredentialsFromQr = useCallback(async (credentials: LarkCredentials) => {
    const workspaceId = selectedProjectWorkspaceIdRef.current;
    const targetInstanceId = getPlatformInstanceId(platformDialogRef.current?.draft);
    const currentConfig = configDraftRef.current;
    if (!currentConfig) return;
    const nextConfig = clone(currentConfig);
    const nextProjects = ensureProjects(nextConfig);
    const projectIndex = selectedIndexRef.current;
    const project = nextProjects[projectIndex];
    if (!project) return;
    const platforms = [...(project.platforms || [])];
    const currentDialog = platformDialogRef.current;
    const currentIndex = currentDialog?.index ?? platforms.findIndex((platform) =>
      normalizePlatformDraft(platform).type === 'lark' && getPlatformInstanceId(platform) === targetInstanceId
    );
    const currentPlatform = currentIndex >= 0 ? platforms[currentIndex] : currentDialog?.draft || createPlatformDraft('lark');
    const nextPlatform = normalizePlatformDraft({
      ...currentPlatform,
      type: 'lark',
      options: {
        ...(currentPlatform.options || {}),
        instance_id: targetInstanceId,
        app_id: credentials.appId,
        app_secret: credentials.appSecret,
        verification_token: credentials.verificationToken || currentPlatform.options?.verification_token || '',
        encrypt_key: credentials.encryptKey || currentPlatform.options?.encrypt_key || '',
        card_actions: true,
        subscribed_events: 'im.message.receive_v1 card.action.trigger',
        subscribed_callbacks: 'card.action.trigger',
      },
    });
    if (currentIndex >= 0) {
      platforms[currentIndex] = nextPlatform;
    } else {
      platforms.push(nextPlatform);
    }
    nextProjects[projectIndex] = normalizeProject({ ...project, platforms });
    const saved = await saveRuntimeConfig(nextConfig);
    const savedConfig = clone(saved.config || nextConfig);
    setPersistedConfig(savedConfig);
    setConfigDraft(clone(savedConfig));
    setPlatformDialog((current) => current ? { ...current, index: current.index ?? (currentIndex >= 0 ? currentIndex : platforms.length - 1), draft: nextPlatform } : current);
    await activateLarkGatewayAfterBind(workspaceId, targetInstanceId);
    setNotice({ tone: 'success', message: 'Lark bot bound, saved, and ready to send messages.' });
    const projectName = nextProjects[projectIndex]?.name;
    if (projectName) await loadAll(projectName);
  }, [activateLarkGatewayAfterBind, loadAll, selectedProjectWorkspaceIdRef, platformDialogRef, configDraftRef, selectedIndexRef, setPersistedConfig, setConfigDraft, setPlatformDialog, setNotice]);

  const handleGenerateLarkQr = useCallback(async () => {
    if (!selectedProject?.name || !configDraft) return;
    setLarkQrLoading(true);
    try {
      await persistPlatformDialogDraft();
      const result = await getLarkQrCode(selectedProject.workspace_id || selectedProject.name, getPlatformInstanceId(platformDialog?.draft));
      setLarkQr({ ...result, status: 'wait', createdAt: Date.now() });
      setNotice(null);
    } catch (err) {
      setNotice({ tone: 'error', message: describeError(err) });
    } finally {
      setLarkQrLoading(false);
    }
  }, [selectedProject, configDraft, platformDialog, persistPlatformDialogDraft, setNotice]);

  const handleCheckLarkQr = useCallback(async () => {
    if (!selectedProject?.name || !larkQr?.ticket || !configDraft) return;
    setLarkQrLoading(true);
    try {
      const result = await checkLarkQrCodeStatus(selectedProject.workspace_id || selectedProject.name, larkQr.ticket, getPlatformInstanceId(platformDialog?.draft));
      setLarkQr((current) => current ? { ...current, status: result.status, botName: result.credentials?.botName } : current);
      if (result.status === 'confirmed' && result.credentials) {
        await saveLarkCredentialsFromQr(result.credentials);
      } else if (result.status === 'expired') {
        setNotice({ tone: 'warning', message: 'Lark QR code expired. Generate a new QR code and scan again.' });
      }
    } catch (err) {
      setNotice({ tone: 'error', message: describeError(err) });
    } finally {
      setLarkQrLoading(false);
    }
  }, [selectedProject, larkQr, configDraft, platformDialog, saveLarkCredentialsFromQr, setNotice]);

  useEffect(() => {
    if (!selectedProject?.name || !larkQr?.ticket || platformDialog?.draft.type !== 'lark') return;
    if (larkQr.status && !['wait', 'signed'].includes(larkQr.status)) return;

    let cancelled = false;
    let timer: number | undefined;
    const createdAt = larkQr.createdAt || Date.now();
    const expiresAt = createdAt + Math.max(larkQr.expiresIn || 0, 1) * 1000;
    const pollDelay = Math.max(3, Math.min(Number(larkQr.interval || 5) || 5, 15)) * 1000;

    const schedule = (delay: number) => {
      timer = window.setTimeout(() => {
        void poll();
      }, delay);
    };

    const poll = async () => {
      if (cancelled) return;
      if (Date.now() >= expiresAt) {
        setLarkQr((current) => current?.ticket === larkQr.ticket ? { ...current, status: 'expired' } : current);
        setNotice({ tone: 'warning', message: 'Lark QR code expired. Generate a new QR code and scan again.' });
        return;
      }
      try {
        const result = await checkLarkQrCodeStatus(selectedProject.workspace_id || selectedProject.name || '', larkQr.ticket, getPlatformInstanceId(platformDialogRef.current?.draft));
        if (cancelled) return;
        setLarkQr((current) => current?.ticket === larkQr.ticket ? { ...current, status: result.status, botName: result.credentials?.botName } : current);
        if (result.status === 'confirmed' && result.credentials) {
          await saveLarkCredentialsFromQr(result.credentials);
          return;
        }
        if (result.status === 'expired') {
          setNotice({ tone: 'warning', message: 'Lark QR code expired. Generate a new QR code and scan again.' });
          return;
        }
        schedule(pollDelay);
      } catch (err) {
        if (cancelled) return;
        setNotice({ tone: 'error', message: describeError(err) });
      }
    };

    schedule(Math.min(2000, pollDelay));
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [
    larkQr?.createdAt,
    larkQr?.expiresIn,
    larkQr?.interval,
    larkQr?.status,
    larkQr?.ticket,
    platformDialog?.draft.type,
    selectedProject?.name,
    platformDialogRef,
    saveLarkCredentialsFromQr,
    setNotice,
  ]);

  return {
    larkQr,
    larkQrLoading,
    setLarkQr,
    generateLarkQr: handleGenerateLarkQr,
    checkLarkQr: handleCheckLarkQr,
  };
}
