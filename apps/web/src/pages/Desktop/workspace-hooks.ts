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
  desktopProjectWorkspaceId,
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
  configDraftRef: React.RefObject<DesktopConnectConfig | null>;
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
 *
 * The flow deliberately does NOT persist the platform before scanning: the QR
 * registration endpoints accept an ephemeral instance, so an instance only
 * enters the saved config once the bot credentials are confirmed. The polling
 * loop keeps running in the background (even with the dialog closed) and keeps
 * retrying on transient errors instead of dying silently, so a completed scan
 * is never lost to a stopped poller.
 */
export function useLarkQr({
  selectedProject,
  configDraft,
  platformDialog,
  configDraftRef,
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

  const saveLarkCredentialsFromQr = useCallback(async (credentials: LarkCredentials, workspaceId: string, targetInstanceId: string) => {
    const currentConfig = configDraftRef.current;
    if (!currentConfig) {
      setNotice({ tone: 'error', message: 'Lark bot credentials were received, but the workspace config is not loaded. Refresh the page and retry.' });
      return;
    }
    const nextConfig = clone(currentConfig);
    const nextProjects = ensureProjects(nextConfig);
    const projectIndex = nextProjects.findIndex((project) => desktopProjectWorkspaceId(project) === workspaceId);
    if (projectIndex < 0) {
      setNotice({ tone: 'error', message: `Lark bot credentials were received for workspace "${workspaceId}", but the project is no longer in the config.` });
      return;
    }
    const project = nextProjects[projectIndex];
    const platforms = [...(project.platforms || [])];
    const currentIndex = platforms.findIndex((platform) =>
      normalizePlatformDraft(platform).type === 'lark' && getPlatformInstanceId(platform) === targetInstanceId
    );
    const currentPlatform = currentIndex >= 0 ? platforms[currentIndex] : createPlatformDraft('lark');
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
    setPlatformDialog((current) => {
      if (!current || getPlatformInstanceId(current.draft) !== targetInstanceId) return current;
      return {
        ...current,
        index: current.index ?? (currentIndex >= 0 ? currentIndex : platforms.length - 1),
        draft: nextPlatform,
      };
    });
    await activateLarkGatewayAfterBind(workspaceId, targetInstanceId);
    setNotice({ tone: 'success', message: 'Lark bot bound, saved, and ready to send messages.' });
    const projectName = nextProjects[projectIndex]?.name;
    if (projectName) await loadAll(projectName);
  }, [activateLarkGatewayAfterBind, loadAll, configDraftRef, setPersistedConfig, setConfigDraft, setPlatformDialog, setNotice]);

  const handleGenerateLarkQr = useCallback(async () => {
    if (!selectedProject?.name || !configDraft) return;
    setLarkQrLoading(true);
    try {
      const workspaceId = selectedProject.workspace_id || selectedProject.name;
      const instanceId = getPlatformInstanceId(platformDialog?.draft);
      const result = await getLarkQrCode(workspaceId, instanceId);
      setLarkQr({ ...result, status: 'wait', createdAt: Date.now(), workspaceId, instanceId });
      setNotice(null);
    } catch (err) {
      setNotice({ tone: 'error', message: describeError(err) });
    } finally {
      setLarkQrLoading(false);
    }
  }, [selectedProject, configDraft, platformDialog, setNotice]);

  const handleCheckLarkQr = useCallback(async () => {
    if (!larkQr?.ticket) return;
    setLarkQrLoading(true);
    try {
      const result = await checkLarkQrCodeStatus(larkQr.workspaceId, larkQr.ticket, larkQr.instanceId);
      setLarkQr((current) => current ? { ...current, status: result.status, botName: result.credentials?.botName } : current);
      if (result.status === 'confirmed' && result.credentials) {
        await saveLarkCredentialsFromQr(result.credentials, larkQr.workspaceId, larkQr.instanceId);
      } else if (result.status === 'expired') {
        setNotice({ tone: 'warning', message: 'Lark QR code expired. Generate a new QR code and scan again.' });
      }
    } catch (err) {
      setNotice({ tone: 'error', message: describeError(err) });
    } finally {
      setLarkQrLoading(false);
    }
  }, [larkQr, saveLarkCredentialsFromQr, setNotice]);

  useEffect(() => {
    if (!larkQr?.ticket) return;
    if (larkQr.status && !['wait', 'signed'].includes(larkQr.status)) return;

    let cancelled = false;
    let timer: number | undefined;
    const createdAt = larkQr.createdAt || Date.now();
    const expiresAt = createdAt + Math.max(larkQr.expiresIn || 0, 1) * 1000;
    const basePollDelay = Math.max(3, Math.min(Number(larkQr.interval || 5) || 5, 15)) * 1000;
    let consecutiveErrors = 0;

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
        const result = await checkLarkQrCodeStatus(larkQr.workspaceId, larkQr.ticket, larkQr.instanceId);
        if (cancelled) return;
        consecutiveErrors = 0;
        setLarkQr((current) => current?.ticket === larkQr.ticket ? { ...current, status: result.status, botName: result.credentials?.botName } : current);
        if (result.status === 'confirmed' && result.credentials) {
          await saveLarkCredentialsFromQr(result.credentials, larkQr.workspaceId, larkQr.instanceId);
          return;
        }
        if (result.status === 'expired') {
          setNotice({ tone: 'warning', message: 'Lark QR code expired. Generate a new QR code and scan again.' });
          return;
        }
        schedule(basePollDelay);
      } catch (err) {
        if (cancelled) return;
        // Never stop polling on transient errors: the Feishu registration flow
        // may still complete while we wait, and the confirmed credentials are
        // only handed out once. Back off so a broken endpoint is not hammered.
        consecutiveErrors += 1;
        if (consecutiveErrors === 1) {
          setNotice({ tone: 'warning', message: `Lark QR status check failed, retrying: ${describeError(err)}` });
        }
        schedule(Math.min(basePollDelay * Math.pow(2, consecutiveErrors - 1), 30000));
      }
    };

    schedule(Math.min(2000, basePollDelay));
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
    larkQr?.workspaceId,
    larkQr?.instanceId,
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
