import type {
  ConfigFileState,
  DesktopBridgeEvent,
  DesktopRuntimeStatus,
  DesktopSettings,
  DesktopSettingsInput,
} from '../../shared/desktop';
import type {
  LocalCoreAuthorizedUser,
  LocalCoreChannelAuthorizedUser,
  LocalCoreChannelConnectionResult,
  LocalCoreChannelGatewayStatus,
  LocalCoreLarkConnectionResult,
  LocalCoreLarkGatewayStatus,
  LocalCoreChannelPairingRequest,
  LocalCorePairingRequest,
  WorkspaceStreamingProbeResult,
} from '../../packages/contracts/src';
import {
  approveChannelPairing as approveCoreChannelPairing,
  detectLocalAiCore,
  disableChannelGateway as disableCoreChannelGateway,
  enableChannelGateway as enableCoreChannelGateway,
  getChannelGatewayStatus as getCoreChannelGatewayStatus,
  getThread as getCoreThread,
  getCoreLogs,
  getCoreRuntime,
  getLarkGatewayStatus as getCoreLarkGatewayStatus,
  listChannelAuthorizedUsers as listCoreChannelAuthorizedUsers,
  listChannelGateways as listCoreChannelGateways,
  listChannelPendingPairings as listCoreChannelPendingPairings,
  listLarkGateways as listCoreLarkGateways,
  onBridgeUpdated,
  onRuntimeUpdated,
  probeWorkspaceStreaming as probeCoreWorkspaceStreaming,
  readCoreConfigFile,
  rejectChannelPairing as rejectCoreChannelPairing,
  rejectLarkPairing as rejectCoreLarkPairing,
  restartCoreService,
  testChannelConnection as testCoreChannelConnection,
  testLarkConnection as testCoreLarkConnection,
  saveCoreRawConfigFile,
  saveCoreSettings,
  saveCoreStructuredConfigFile,
  approveLarkPairing as approveCoreLarkPairing,
  disableLarkGateway as disableCoreLarkGateway,
  enableLarkGateway as enableCoreLarkGateway,
  listLarkAuthorizedUsers as listCoreLarkAuthorizedUsers,
  listLarkPendingPairings as listCoreLarkPendingPairings,
  startCoreService,
  stopCoreService,
  updateThreadKnowledgeBases as updateCoreThreadKnowledgeBases,
} from '../../packages/core-sdk/src';
import { getRuntimeProvider, setRuntimeProvider, type RuntimeProvider } from '@/app/runtime';

type DesktopProvider = {
  getRuntimeStatus: () => Promise<DesktopRuntimeStatus>;
  startService: () => Promise<unknown>;
  stopService: () => Promise<unknown>;
  restartService: () => Promise<unknown>;
  getLogs: (limit?: number) => Promise<string[]>;
  readConfigFile: () => Promise<ConfigFileState>;
  saveRawConfigFile: (raw: string) => Promise<ConfigFileState>;
  saveStructuredConfigFile: (config: unknown) => Promise<ConfigFileState>;
  getThreadKnowledgeBases: (workspaceId: string, threadId: string) => Promise<string[]>;
  updateThreadKnowledgeBases: (workspaceId: string, threadId: string, knowledgeBaseIds: string[]) => Promise<string[]>;
  deleteThreadKnowledgeBases: (workspaceId: string, threadId: string) => Promise<{ deleted: boolean }>;
  saveSettings: (input: DesktopSettingsInput) => Promise<DesktopSettings>;
  listChannelGateways: (platform: string) => Promise<LocalCoreChannelGatewayStatus[]>;
  getChannelGatewayStatus: (platform: string, workspaceId: string) => Promise<LocalCoreChannelGatewayStatus>;
  testChannelConnection: (platform: string, workspaceId: string) => Promise<LocalCoreChannelConnectionResult>;
  enableChannelGateway: (platform: string, workspaceId: string) => Promise<LocalCoreChannelGatewayStatus>;
  disableChannelGateway: (platform: string, workspaceId: string) => Promise<LocalCoreChannelGatewayStatus>;
  listChannelPendingPairings: (platform: string, workspaceId?: string) => Promise<LocalCoreChannelPairingRequest[]>;
  approveChannelPairing: (platform: string, code: string) => Promise<LocalCoreChannelAuthorizedUser>;
  rejectChannelPairing: (platform: string, code: string) => Promise<{ rejected: boolean }>;
  listChannelAuthorizedUsers: (platform: string, workspaceId?: string) => Promise<LocalCoreChannelAuthorizedUser[]>;
  listLarkGateways: () => Promise<LocalCoreLarkGatewayStatus[]>;
  getLarkGatewayStatus: (workspaceId: string) => Promise<LocalCoreLarkGatewayStatus>;
  testLarkConnection: (workspaceId: string) => Promise<LocalCoreLarkConnectionResult>;
  enableLarkGateway: (workspaceId: string) => Promise<LocalCoreLarkGatewayStatus>;
  disableLarkGateway: (workspaceId: string) => Promise<LocalCoreLarkGatewayStatus>;
  listLarkPendingPairings: (workspaceId?: string) => Promise<LocalCorePairingRequest[]>;
  approveLarkPairing: (code: string) => Promise<LocalCoreAuthorizedUser>;
  rejectLarkPairing: (code: string) => Promise<{ rejected: boolean }>;
  listLarkAuthorizedUsers: (workspaceId?: string) => Promise<LocalCoreAuthorizedUser[]>;
  probeWorkspaceStreaming: (workspaceId: string) => Promise<WorkspaceStreamingProbeResult>;
  onRuntimeEvent: (listener: (runtime: DesktopRuntimeStatus) => void) => () => void;
  onBridgeEvent: (listener: (event: DesktopBridgeEvent) => void) => () => void;
};

function requireDesktopBridge() {
  if (!window.desktop) {
    throw new Error('Desktop APIs are unavailable in the browser build');
  }
  return window.desktop;
}

const electronProvider: DesktopProvider = {
  getRuntimeStatus: () => requireDesktopBridge().getRuntimeStatus(),
  startService: () => requireDesktopBridge().startService(),
  stopService: () => requireDesktopBridge().stopService(),
  restartService: () => requireDesktopBridge().restartService(),
  getLogs: (limit?: number) => requireDesktopBridge().getLogs(limit),
  readConfigFile: () => requireDesktopBridge().readConfigFile(),
  saveRawConfigFile: (raw: string) => requireDesktopBridge().saveRawConfigFile(raw),
  saveStructuredConfigFile: (config: unknown) => requireDesktopBridge().saveStructuredConfigFile(config),
  getThreadKnowledgeBases: (workspaceId: string, threadId: string) =>
    requireDesktopBridge().getThreadKnowledgeBases(workspaceId, threadId),
  updateThreadKnowledgeBases: (workspaceId: string, threadId: string, knowledgeBaseIds: string[]) =>
    requireDesktopBridge().updateThreadKnowledgeBases(workspaceId, threadId, knowledgeBaseIds),
  deleteThreadKnowledgeBases: (workspaceId: string, threadId: string) =>
    requireDesktopBridge().deleteThreadKnowledgeBases(workspaceId, threadId),
  saveSettings: (input: DesktopSettingsInput) => requireDesktopBridge().saveSettings(input),
  listChannelGateways: (platform: string) => requireDesktopBridge().listChannelGateways(platform),
  getChannelGatewayStatus: (platform: string, workspaceId: string) => requireDesktopBridge().getChannelGatewayStatus(platform, workspaceId),
  testChannelConnection: (platform: string, workspaceId: string) => requireDesktopBridge().testChannelConnection(platform, workspaceId),
  enableChannelGateway: (platform: string, workspaceId: string) => requireDesktopBridge().enableChannelGateway(platform, workspaceId),
  disableChannelGateway: (platform: string, workspaceId: string) => requireDesktopBridge().disableChannelGateway(platform, workspaceId),
  listChannelPendingPairings: (platform: string, workspaceId?: string) => requireDesktopBridge().listChannelPendingPairings(platform, workspaceId),
  approveChannelPairing: (platform: string, code: string) => requireDesktopBridge().approveChannelPairing(platform, code),
  rejectChannelPairing: (platform: string, code: string) => requireDesktopBridge().rejectChannelPairing(platform, code),
  listChannelAuthorizedUsers: (platform: string, workspaceId?: string) => requireDesktopBridge().listChannelAuthorizedUsers(platform, workspaceId),
  listLarkGateways: () => requireDesktopBridge().listLarkGateways(),
  getLarkGatewayStatus: (workspaceId: string) => requireDesktopBridge().getLarkGatewayStatus(workspaceId),
  testLarkConnection: (workspaceId: string) => requireDesktopBridge().testLarkConnection(workspaceId),
  enableLarkGateway: (workspaceId: string) => requireDesktopBridge().enableLarkGateway(workspaceId),
  disableLarkGateway: (workspaceId: string) => requireDesktopBridge().disableLarkGateway(workspaceId),
  listLarkPendingPairings: (workspaceId?: string) => requireDesktopBridge().listLarkPendingPairings(workspaceId),
  approveLarkPairing: (code: string) => requireDesktopBridge().approveLarkPairing(code),
  rejectLarkPairing: (code: string) => requireDesktopBridge().rejectLarkPairing(code),
  listLarkAuthorizedUsers: (workspaceId?: string) => requireDesktopBridge().listLarkAuthorizedUsers(workspaceId),
  probeWorkspaceStreaming: (workspaceId: string) => requireDesktopBridge().probeWorkspaceStreaming(workspaceId),
  onRuntimeEvent: (listener) => requireDesktopBridge().onRuntimeEvent(listener),
  onBridgeEvent: (listener) => onBridgeUpdated(listener),
};

const localCoreProvider: DesktopProvider = {
  getRuntimeStatus: () => getCoreRuntime(),
  startService: () => startCoreService(),
  stopService: () => stopCoreService(),
  restartService: () => restartCoreService(),
  getLogs: (limit?: number) => getCoreLogs(limit),
  readConfigFile: () => readCoreConfigFile(),
  saveRawConfigFile: (raw: string) => saveCoreRawConfigFile(raw),
  saveStructuredConfigFile: (config: unknown) => saveCoreStructuredConfigFile(config),
  getThreadKnowledgeBases: (_workspaceId: string, threadId: string) =>
    getCoreThread(threadId).then((thread) => thread.selectedKnowledgeBaseIds || []),
  updateThreadKnowledgeBases: (_workspaceId: string, threadId: string, knowledgeBaseIds: string[]) =>
    updateCoreThreadKnowledgeBases(threadId, knowledgeBaseIds).then((result) => result.knowledgeBaseIds),
  deleteThreadKnowledgeBases: (_workspaceId: string, threadId: string) =>
    updateCoreThreadKnowledgeBases(threadId, []).then(() => ({ deleted: true })),
  saveSettings: (input: DesktopSettingsInput) => saveCoreSettings(input),
  listChannelGateways: (platform: string) => listCoreChannelGateways(platform).then((result) => result.gateways),
  getChannelGatewayStatus: (platform: string, workspaceId: string) => getCoreChannelGatewayStatus(platform, workspaceId),
  testChannelConnection: (platform: string, workspaceId: string) => testCoreChannelConnection(platform, workspaceId),
  enableChannelGateway: (platform: string, workspaceId: string) => enableCoreChannelGateway(platform, workspaceId),
  disableChannelGateway: (platform: string, workspaceId: string) => disableCoreChannelGateway(platform, workspaceId),
  listChannelPendingPairings: (platform: string, workspaceId?: string) =>
    listCoreChannelPendingPairings(platform, workspaceId).then((result) => result.pairings),
  approveChannelPairing: (platform: string, code: string) => approveCoreChannelPairing(platform, code),
  rejectChannelPairing: (platform: string, code: string) => rejectCoreChannelPairing(platform, code),
  listChannelAuthorizedUsers: (platform: string, workspaceId?: string) =>
    listCoreChannelAuthorizedUsers(platform, workspaceId).then((result) => result.users),
  listLarkGateways: () => listCoreLarkGateways().then((result) => result.gateways),
  getLarkGatewayStatus: (workspaceId: string) => getCoreLarkGatewayStatus(workspaceId),
  testLarkConnection: (workspaceId: string) => testCoreLarkConnection(workspaceId),
  enableLarkGateway: (workspaceId: string) => enableCoreLarkGateway(workspaceId),
  disableLarkGateway: (workspaceId: string) => disableCoreLarkGateway(workspaceId),
  listLarkPendingPairings: (workspaceId?: string) => listCoreLarkPendingPairings(workspaceId).then((result) => result.pairings),
  approveLarkPairing: (code: string) => approveCoreLarkPairing(code),
  rejectLarkPairing: (code: string) => rejectCoreLarkPairing(code),
  listLarkAuthorizedUsers: (workspaceId?: string) => listCoreLarkAuthorizedUsers(workspaceId).then((result) => result.users),
  probeWorkspaceStreaming: (workspaceId: string) => probeCoreWorkspaceStreaming(workspaceId),
  onRuntimeEvent: (listener) => onRuntimeUpdated(listener),
  onBridgeEvent: (listener) => onBridgeUpdated(listener),
};

let activeProvider: DesktopProvider | null = null;

function providerFor(kind: RuntimeProvider): DesktopProvider | null {
  if (kind === 'electron') {
    return window.desktop ? electronProvider : localCoreProvider;
  }
  return localCoreProvider;
}

async function detectProvider() {
  if (window.desktop) {
    setRuntimeProvider('electron');
    activeProvider = electronProvider;
    return activeProvider;
  }
  if (await detectLocalAiCore()) {
    setRuntimeProvider('local_core');
    activeProvider = localCoreProvider;
    return activeProvider;
  }
  setRuntimeProvider('local_core');
  activeProvider = localCoreProvider;
  return activeProvider;
}

function requireProvider() {
  const provider = activeProvider || providerFor(getRuntimeProvider());
  if (!provider) {
    throw new Error('Managed desktop APIs are unavailable in this build');
  }
  activeProvider = provider;
  return provider;
}

export async function initializeDesktopProvider() {
  return detectProvider();
}

export const getRuntimeStatus = (): Promise<DesktopRuntimeStatus> => requireProvider().getRuntimeStatus();
export const startDesktopService = () => requireProvider().startService();
export const stopDesktopService = () => requireProvider().stopService();
export const restartDesktopService = () => requireProvider().restartService();
export const getDesktopLogs = (limit?: number) => requireProvider().getLogs(limit);
export const readConfigFile = (): Promise<ConfigFileState> => requireProvider().readConfigFile();
export const saveRawConfigFile = (raw: string): Promise<ConfigFileState> => requireProvider().saveRawConfigFile(raw);
export const saveStructuredConfigFile = (config: unknown): Promise<ConfigFileState> => requireProvider().saveStructuredConfigFile(config);
export const getThreadKnowledgeBases = (workspaceId: string, threadId: string): Promise<string[]> =>
  requireProvider().getThreadKnowledgeBases(workspaceId, threadId);
export const updateThreadKnowledgeBases = (
  workspaceId: string,
  threadId: string,
  knowledgeBaseIds: string[],
): Promise<string[]> => requireProvider().updateThreadKnowledgeBases(workspaceId, threadId, knowledgeBaseIds);
export const deleteThreadKnowledgeBases = (workspaceId: string, threadId: string): Promise<{ deleted: boolean }> =>
  requireProvider().deleteThreadKnowledgeBases(workspaceId, threadId);
export const saveDesktopSettings = (input: DesktopSettingsInput): Promise<DesktopSettings> => requireProvider().saveSettings(input);
export const listChannelGateways = (platform: string): Promise<LocalCoreChannelGatewayStatus[]> => requireProvider().listChannelGateways(platform);
export const getChannelGatewayStatus = (platform: string, workspaceId: string): Promise<LocalCoreChannelGatewayStatus> =>
  requireProvider().getChannelGatewayStatus(platform, workspaceId);
export const testChannelConnection = (platform: string, workspaceId: string): Promise<LocalCoreChannelConnectionResult> =>
  requireProvider().testChannelConnection(platform, workspaceId);
export const enableChannelGateway = (platform: string, workspaceId: string): Promise<LocalCoreChannelGatewayStatus> =>
  requireProvider().enableChannelGateway(platform, workspaceId);
export const disableChannelGateway = (platform: string, workspaceId: string): Promise<LocalCoreChannelGatewayStatus> =>
  requireProvider().disableChannelGateway(platform, workspaceId);
export const listChannelPendingPairings = (platform: string, workspaceId?: string): Promise<LocalCoreChannelPairingRequest[]> =>
  requireProvider().listChannelPendingPairings(platform, workspaceId);
export const approveChannelPairing = (platform: string, code: string): Promise<LocalCoreChannelAuthorizedUser> =>
  requireProvider().approveChannelPairing(platform, code);
export const rejectChannelPairing = (platform: string, code: string): Promise<{ rejected: boolean }> =>
  requireProvider().rejectChannelPairing(platform, code);
export const listChannelAuthorizedUsers = (platform: string, workspaceId?: string): Promise<LocalCoreChannelAuthorizedUser[]> =>
  requireProvider().listChannelAuthorizedUsers(platform, workspaceId);
export const listLarkGateways = (): Promise<LocalCoreLarkGatewayStatus[]> => requireProvider().listLarkGateways();
export const getLarkGatewayStatus = (workspaceId: string): Promise<LocalCoreLarkGatewayStatus> => requireProvider().getLarkGatewayStatus(workspaceId);
export const testLarkConnection = (workspaceId: string): Promise<LocalCoreLarkConnectionResult> => requireProvider().testLarkConnection(workspaceId);
export const enableLarkGateway = (workspaceId: string): Promise<LocalCoreLarkGatewayStatus> => requireProvider().enableLarkGateway(workspaceId);
export const disableLarkGateway = (workspaceId: string): Promise<LocalCoreLarkGatewayStatus> => requireProvider().disableLarkGateway(workspaceId);
export const listLarkPendingPairings = (workspaceId?: string): Promise<LocalCorePairingRequest[]> => requireProvider().listLarkPendingPairings(workspaceId);
export const approveLarkPairing = (code: string): Promise<LocalCoreAuthorizedUser> => requireProvider().approveLarkPairing(code);
export const rejectLarkPairing = (code: string): Promise<{ rejected: boolean }> => requireProvider().rejectLarkPairing(code);
export const listLarkAuthorizedUsers = (workspaceId?: string): Promise<LocalCoreAuthorizedUser[]> => requireProvider().listLarkAuthorizedUsers(workspaceId);
export const probeWorkspaceStreaming = (workspaceId: string): Promise<WorkspaceStreamingProbeResult> =>
  requireProvider().probeWorkspaceStreaming(workspaceId);
export const onRuntimeEvent = (listener: (runtime: DesktopRuntimeStatus) => void) => requireProvider().onRuntimeEvent(listener);
export const onBridgeEvent = (listener: (event: DesktopBridgeEvent) => void) => requireProvider().onBridgeEvent(listener);
