import type {
  ConfigFileState,
  DesktopBridgeEvent,
  DesktopRuntimeStatus,
  DesktopSettings,
  DesktopSettingsInput,
} from '../../shared/desktop';
import type {
  LocalCoreAuthorizedUser,
  LocalCoreCapabilitySnapshot,
  LocalCoreChannelAuthorizedUser,
  LocalCoreChannelConnectionResult,
  LocalCoreChannelGatewayStatus,
  LocalCoreLarkConnectionResult,
  LocalCoreLarkGatewayStatus,
  LocalCoreChannelQrCode,
  LocalCoreChannelQrCodeStatus,
  LocalCoreDoctorResult,
  LocalCoreErrorSummary,
  LocalCoreLarkQrCodeStatus,
  LocalCoreChannelPairingRequest,
  LocalCoreEvent,
  LocalCorePairingRequest,
  LocalCorePluginDiagnostics,
  InstalledAgentRuntime,
  WorkspaceStreamingProbeResult,
} from '../../packages/contracts/src';
import {
  approveChannelPairing as approveCoreChannelPairing,
  detectLocalAiCore,
  disableChannelGateway as disableCoreChannelGateway,
  enableChannelGateway as enableCoreChannelGateway,
  getChannelGatewayStatus as getCoreChannelGatewayStatus,
  getChannelQrCode as getCoreChannelQrCode,
  getThread as getCoreThread,
  getCoreLogs,
  getCoreRuntime,
  listInstalledAgentRuntimes as listCoreInstalledAgentRuntimes,
  refreshRuntimeDetections as refreshCoreRuntimeDetections,
  getCapabilitySnapshot as getCoreCapabilitySnapshot,
  getPluginDiagnostics as getCorePluginDiagnostics,
  listDiagnosticErrors as listCoreDiagnosticErrors,
  checkChannelQrCodeStatus as checkCoreChannelQrCodeStatus,
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
  runDiagnosticsDoctor as runCoreDiagnosticsDoctor,
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
  subscribeEvents,
  updateThreadKnowledgeBases as updateCoreThreadKnowledgeBases,
  getWeixinQrCode as getCoreWeixinQrCode,
  checkWeixinQrCodeStatus as checkCoreWeixinQrCodeStatus,
  getLarkQrCode as getCoreLarkQrCode,
  checkLarkQrCodeStatus as checkCoreLarkQrCodeStatus,
} from '../../packages/core-sdk/src';
import { getRuntimeProvider, setRuntimeProvider, type RuntimeProvider } from '@/app/runtime';

type DesktopProvider = {
  getRuntimeStatus: () => Promise<DesktopRuntimeStatus>;
  startService: () => Promise<unknown>;
  stopService: () => Promise<unknown>;
  restartService: () => Promise<unknown>;
  getLogs: (limit?: number) => Promise<string[]>;
  listInstalledAgentRuntimes: () => Promise<InstalledAgentRuntime[]>;
  refreshInstalledAgentRuntimes: () => Promise<InstalledAgentRuntime[]>;
  readConfigFile: () => Promise<ConfigFileState>;
  saveRawConfigFile: (raw: string) => Promise<ConfigFileState>;
  saveStructuredConfigFile: (config: unknown) => Promise<ConfigFileState>;
  getThreadKnowledgeBases: (workspaceId: string, threadId: string) => Promise<string[]>;
  updateThreadKnowledgeBases: (workspaceId: string, threadId: string, knowledgeBaseIds: string[]) => Promise<string[]>;
  deleteThreadKnowledgeBases: (workspaceId: string, threadId: string) => Promise<{ deleted: boolean }>;
  saveSettings: (input: DesktopSettingsInput) => Promise<DesktopSettings>;
  getCapabilitySnapshot: () => Promise<LocalCoreCapabilitySnapshot>;
  getPluginDiagnostics: () => Promise<LocalCorePluginDiagnostics>;
  listDiagnosticErrors: () => Promise<LocalCoreErrorSummary[]>;
  runDiagnosticsDoctor: () => Promise<LocalCoreDoctorResult>;
  listChannelGateways: (platform: string) => Promise<LocalCoreChannelGatewayStatus[]>;
  getChannelGatewayStatus: (platform: string, workspaceId: string, instanceId?: string) => Promise<LocalCoreChannelGatewayStatus>;
  testChannelConnection: (platform: string, workspaceId: string, instanceId?: string) => Promise<LocalCoreChannelConnectionResult>;
  enableChannelGateway: (platform: string, workspaceId: string, instanceId?: string) => Promise<LocalCoreChannelGatewayStatus>;
  disableChannelGateway: (platform: string, workspaceId: string, instanceId?: string) => Promise<LocalCoreChannelGatewayStatus>;
  listChannelPendingPairings: (platform: string, workspaceId?: string) => Promise<LocalCoreChannelPairingRequest[]>;
  approveChannelPairing: (platform: string, code: string) => Promise<LocalCoreChannelAuthorizedUser>;
  rejectChannelPairing: (platform: string, code: string) => Promise<{ rejected: boolean }>;
  listChannelAuthorizedUsers: (platform: string, workspaceId?: string) => Promise<LocalCoreChannelAuthorizedUser[]>;
  getChannelQrCode: (platform: string, workspaceId: string, instanceId?: string) => Promise<LocalCoreChannelQrCode>;
  checkChannelQrCodeStatus: (platform: string, workspaceId: string, ticket: string, instanceId?: string) => Promise<LocalCoreChannelQrCodeStatus>;
  getWeixinQrCode: (workspaceId: string, instanceId?: string) => Promise<LocalCoreChannelQrCode>;
  checkWeixinQrCodeStatus: (workspaceId: string, ticket: string, instanceId?: string) => Promise<{
    status: 'wait' | 'signed' | 'confirmed' | 'expired';
    userName?: string;
    userId?: string;
  }>;
  getLarkQrCode: (workspaceId: string, instanceId?: string) => Promise<LocalCoreChannelQrCode>;
  checkLarkQrCodeStatus: (workspaceId: string, ticket: string, instanceId?: string) => Promise<LocalCoreLarkQrCodeStatus>;
  listLarkGateways: () => Promise<LocalCoreLarkGatewayStatus[]>;
  getLarkGatewayStatus: (workspaceId: string, instanceId?: string) => Promise<LocalCoreLarkGatewayStatus>;
  testLarkConnection: (workspaceId: string, instanceId?: string) => Promise<LocalCoreLarkConnectionResult>;
  enableLarkGateway: (workspaceId: string, instanceId?: string) => Promise<LocalCoreLarkGatewayStatus>;
  disableLarkGateway: (workspaceId: string, instanceId?: string) => Promise<LocalCoreLarkGatewayStatus>;
  listLarkPendingPairings: (workspaceId?: string) => Promise<LocalCorePairingRequest[]>;
  approveLarkPairing: (code: string) => Promise<LocalCoreAuthorizedUser>;
  rejectLarkPairing: (code: string) => Promise<{ rejected: boolean }>;
  listLarkAuthorizedUsers: (workspaceId?: string) => Promise<LocalCoreAuthorizedUser[]>;
  probeWorkspaceStreaming: (workspaceId: string) => Promise<WorkspaceStreamingProbeResult>;
  onRuntimeEvent: (listener: (runtime: DesktopRuntimeStatus) => void) => () => void;
  onRuntimeDetectionEvent: (listener: (event: LocalCoreEvent) => void) => () => void;
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
  listInstalledAgentRuntimes: () => listCoreInstalledAgentRuntimes().then((result) => result.runtimes),
  refreshInstalledAgentRuntimes: () => refreshCoreRuntimeDetections().then((result) => result.runtimes),
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
  getCapabilitySnapshot: () => getCoreCapabilitySnapshot(),
  getPluginDiagnostics: () => getCorePluginDiagnostics(),
  listDiagnosticErrors: () => listCoreDiagnosticErrors().then((result) => result.errors),
  runDiagnosticsDoctor: () => runCoreDiagnosticsDoctor(),
  listChannelGateways: (platform: string) => listCoreChannelGateways(platform).then((result) => result.gateways),
  getChannelGatewayStatus: (platform: string, workspaceId: string, instanceId?: string) => getCoreChannelGatewayStatus(platform, workspaceId, instanceId),
  testChannelConnection: (platform: string, workspaceId: string, instanceId?: string) => testCoreChannelConnection(platform, workspaceId, instanceId),
  enableChannelGateway: (platform: string, workspaceId: string, instanceId?: string) => enableCoreChannelGateway(platform, workspaceId, instanceId),
  disableChannelGateway: (platform: string, workspaceId: string, instanceId?: string) => disableCoreChannelGateway(platform, workspaceId, instanceId),
  listChannelPendingPairings: (platform: string, workspaceId?: string) =>
    listCoreChannelPendingPairings(platform, workspaceId).then((result) => result.pairings),
  approveChannelPairing: (platform: string, code: string) => approveCoreChannelPairing(platform, code),
  rejectChannelPairing: (platform: string, code: string) => rejectCoreChannelPairing(platform, code),
  listChannelAuthorizedUsers: (platform: string, workspaceId?: string) =>
    listCoreChannelAuthorizedUsers(platform, workspaceId).then((result) => result.users),
  getChannelQrCode: (platform: string, workspaceId: string, instanceId?: string) => getCoreChannelQrCode(platform, workspaceId, instanceId),
  checkChannelQrCodeStatus: (platform: string, workspaceId: string, ticket: string, instanceId?: string) =>
    checkCoreChannelQrCodeStatus(platform, workspaceId, ticket, instanceId),
  getWeixinQrCode: (workspaceId: string, instanceId?: string) => getCoreWeixinQrCode(workspaceId, instanceId),
  checkWeixinQrCodeStatus: (workspaceId: string, ticket: string, instanceId?: string) => checkCoreWeixinQrCodeStatus(workspaceId, ticket, instanceId),
  getLarkQrCode: (workspaceId: string, instanceId?: string) => getCoreLarkQrCode(workspaceId, instanceId),
  checkLarkQrCodeStatus: (workspaceId: string, ticket: string, instanceId?: string) => checkCoreLarkQrCodeStatus(workspaceId, ticket, instanceId),
  listLarkGateways: () => listCoreLarkGateways().then((result) => result.gateways),
  getLarkGatewayStatus: (workspaceId: string, instanceId?: string) => getCoreLarkGatewayStatus(workspaceId, instanceId),
  testLarkConnection: (workspaceId: string, instanceId?: string) => testCoreLarkConnection(workspaceId, instanceId),
  enableLarkGateway: (workspaceId: string, instanceId?: string) => enableCoreLarkGateway(workspaceId, instanceId),
  disableLarkGateway: (workspaceId: string, instanceId?: string) => disableCoreLarkGateway(workspaceId, instanceId),
  listLarkPendingPairings: (workspaceId?: string) => listCoreLarkPendingPairings(workspaceId).then((result) => result.pairings),
  approveLarkPairing: (code: string) => approveCoreLarkPairing(code),
  rejectLarkPairing: (code: string) => rejectCoreLarkPairing(code),
  listLarkAuthorizedUsers: (workspaceId?: string) => listCoreLarkAuthorizedUsers(workspaceId).then((result) => result.users),
  probeWorkspaceStreaming: (workspaceId: string) => requireDesktopBridge().probeWorkspaceStreaming(workspaceId),
  onRuntimeEvent: (listener) => requireDesktopBridge().onRuntimeEvent(listener),
  onRuntimeDetectionEvent: (listener) => subscribeEvents((event) => {
    if (event.type.startsWith('runtime.detect.') || event.type === 'runtime.status.changed') {
      listener(event);
    }
  }),
  onBridgeEvent: (listener) => onBridgeUpdated(listener),
};

const localCoreProvider: DesktopProvider = {
  getRuntimeStatus: () => getCoreRuntime(),
  startService: () => startCoreService(),
  stopService: () => stopCoreService(),
  restartService: () => restartCoreService(),
  getLogs: (limit?: number) => getCoreLogs(limit),
  listInstalledAgentRuntimes: () => listCoreInstalledAgentRuntimes().then((result) => result.runtimes),
  refreshInstalledAgentRuntimes: () => refreshCoreRuntimeDetections().then((result) => result.runtimes),
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
  getCapabilitySnapshot: () => getCoreCapabilitySnapshot(),
  getPluginDiagnostics: () => getCorePluginDiagnostics(),
  listDiagnosticErrors: () => listCoreDiagnosticErrors().then((result) => result.errors),
  runDiagnosticsDoctor: () => runCoreDiagnosticsDoctor(),
  listChannelGateways: (platform: string) => listCoreChannelGateways(platform).then((result) => result.gateways),
  getChannelGatewayStatus: (platform: string, workspaceId: string, instanceId?: string) => getCoreChannelGatewayStatus(platform, workspaceId, instanceId),
  testChannelConnection: (platform: string, workspaceId: string, instanceId?: string) => testCoreChannelConnection(platform, workspaceId, instanceId),
  enableChannelGateway: (platform: string, workspaceId: string, instanceId?: string) => enableCoreChannelGateway(platform, workspaceId, instanceId),
  disableChannelGateway: (platform: string, workspaceId: string, instanceId?: string) => disableCoreChannelGateway(platform, workspaceId, instanceId),
  listChannelPendingPairings: (platform: string, workspaceId?: string) =>
    listCoreChannelPendingPairings(platform, workspaceId).then((result) => result.pairings),
  approveChannelPairing: (platform: string, code: string) => approveCoreChannelPairing(platform, code),
  rejectChannelPairing: (platform: string, code: string) => rejectCoreChannelPairing(platform, code),
  listChannelAuthorizedUsers: (platform: string, workspaceId?: string) =>
    listCoreChannelAuthorizedUsers(platform, workspaceId).then((result) => result.users),
  getChannelQrCode: (platform: string, workspaceId: string, instanceId?: string) => getCoreChannelQrCode(platform, workspaceId, instanceId),
  checkChannelQrCodeStatus: (platform: string, workspaceId: string, ticket: string, instanceId?: string) =>
    checkCoreChannelQrCodeStatus(platform, workspaceId, ticket, instanceId),
  getWeixinQrCode: (workspaceId: string, instanceId?: string) => getCoreWeixinQrCode(workspaceId, instanceId),
  checkWeixinQrCodeStatus: (workspaceId: string, ticket: string, instanceId?: string) => checkCoreWeixinQrCodeStatus(workspaceId, ticket, instanceId),
  getLarkQrCode: (workspaceId: string, instanceId?: string) => getCoreLarkQrCode(workspaceId, instanceId),
  checkLarkQrCodeStatus: (workspaceId: string, ticket: string, instanceId?: string) => checkCoreLarkQrCodeStatus(workspaceId, ticket, instanceId),
  listLarkGateways: () => listCoreLarkGateways().then((result) => result.gateways),
  getLarkGatewayStatus: (workspaceId: string, instanceId?: string) => getCoreLarkGatewayStatus(workspaceId, instanceId),
  testLarkConnection: (workspaceId: string, instanceId?: string) => testCoreLarkConnection(workspaceId, instanceId),
  enableLarkGateway: (workspaceId: string, instanceId?: string) => enableCoreLarkGateway(workspaceId, instanceId),
  disableLarkGateway: (workspaceId: string, instanceId?: string) => disableCoreLarkGateway(workspaceId, instanceId),
  listLarkPendingPairings: (workspaceId?: string) => listCoreLarkPendingPairings(workspaceId).then((result) => result.pairings),
  approveLarkPairing: (code: string) => approveCoreLarkPairing(code),
  rejectLarkPairing: (code: string) => rejectCoreLarkPairing(code),
  listLarkAuthorizedUsers: (workspaceId?: string) => listCoreLarkAuthorizedUsers(workspaceId).then((result) => result.users),
  probeWorkspaceStreaming: (workspaceId: string) => probeCoreWorkspaceStreaming(workspaceId),
  onRuntimeEvent: (listener) => onRuntimeUpdated(listener),
  onRuntimeDetectionEvent: (listener) => subscribeEvents((event) => {
    if (event.type.startsWith('runtime.detect.') || event.type === 'runtime.status.changed') {
      listener(event);
    }
  }),
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
export const listInstalledAgentRuntimes = (): Promise<InstalledAgentRuntime[]> =>
  requireProvider().listInstalledAgentRuntimes();
export const refreshInstalledAgentRuntimes = (): Promise<InstalledAgentRuntime[]> =>
  requireProvider().refreshInstalledAgentRuntimes();
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
export const getRuntimeCapabilitySnapshot = (): Promise<LocalCoreCapabilitySnapshot> => requireProvider().getCapabilitySnapshot();
export const getRuntimePluginDiagnostics = (): Promise<LocalCorePluginDiagnostics> => requireProvider().getPluginDiagnostics();
export const getRuntimeDiagnosticErrors = (): Promise<LocalCoreErrorSummary[]> => requireProvider().listDiagnosticErrors();
export const runRuntimeDiagnosticsDoctor = (): Promise<LocalCoreDoctorResult> => requireProvider().runDiagnosticsDoctor();
export const listChannelGateways = (platform: string): Promise<LocalCoreChannelGatewayStatus[]> => requireProvider().listChannelGateways(platform);
export const getChannelGatewayStatus = (platform: string, workspaceId: string, instanceId?: string): Promise<LocalCoreChannelGatewayStatus> =>
  requireProvider().getChannelGatewayStatus(platform, workspaceId, instanceId);
export const testChannelConnection = (platform: string, workspaceId: string, instanceId?: string): Promise<LocalCoreChannelConnectionResult> =>
  requireProvider().testChannelConnection(platform, workspaceId, instanceId);
export const enableChannelGateway = (platform: string, workspaceId: string, instanceId?: string): Promise<LocalCoreChannelGatewayStatus> =>
  requireProvider().enableChannelGateway(platform, workspaceId, instanceId);
export const disableChannelGateway = (platform: string, workspaceId: string, instanceId?: string): Promise<LocalCoreChannelGatewayStatus> =>
  requireProvider().disableChannelGateway(platform, workspaceId, instanceId);
export const listChannelPendingPairings = (platform: string, workspaceId?: string): Promise<LocalCoreChannelPairingRequest[]> =>
  requireProvider().listChannelPendingPairings(platform, workspaceId);
export const approveChannelPairing = (platform: string, code: string): Promise<LocalCoreChannelAuthorizedUser> =>
  requireProvider().approveChannelPairing(platform, code);
export const rejectChannelPairing = (platform: string, code: string): Promise<{ rejected: boolean }> =>
  requireProvider().rejectChannelPairing(platform, code);
export const listChannelAuthorizedUsers = (platform: string, workspaceId?: string): Promise<LocalCoreChannelAuthorizedUser[]> =>
  requireProvider().listChannelAuthorizedUsers(platform, workspaceId);
export const getChannelQrCode = (platform: string, workspaceId: string, instanceId?: string): Promise<LocalCoreChannelQrCode> =>
  requireProvider().getChannelQrCode(platform, workspaceId, instanceId);
export const checkChannelQrCodeStatus = (
  platform: string,
  workspaceId: string,
  ticket: string,
  instanceId?: string,
): Promise<LocalCoreChannelQrCodeStatus> =>
  requireProvider().checkChannelQrCodeStatus(platform, workspaceId, ticket, instanceId);
export const getWeixinQrCode = (workspaceId: string, instanceId?: string): Promise<LocalCoreChannelQrCode> =>
  requireProvider().getWeixinQrCode(workspaceId, instanceId);
export const checkWeixinQrCodeStatus = (workspaceId: string, ticket: string, instanceId?: string): Promise<{
  status: 'wait' | 'signed' | 'confirmed' | 'expired';
  userName?: string;
  userId?: string;
}> => requireProvider().checkWeixinQrCodeStatus(workspaceId, ticket, instanceId);
export const getLarkQrCode = (workspaceId: string, instanceId?: string): Promise<LocalCoreChannelQrCode> =>
  requireProvider().getLarkQrCode(workspaceId, instanceId);
export const checkLarkQrCodeStatus = (workspaceId: string, ticket: string, instanceId?: string): Promise<LocalCoreLarkQrCodeStatus> =>
  requireProvider().checkLarkQrCodeStatus(workspaceId, ticket, instanceId);
export const listLarkGateways = (): Promise<LocalCoreLarkGatewayStatus[]> => requireProvider().listLarkGateways();
export const getLarkGatewayStatus = (workspaceId: string, instanceId?: string): Promise<LocalCoreLarkGatewayStatus> => requireProvider().getLarkGatewayStatus(workspaceId, instanceId);
export const testLarkConnection = (workspaceId: string, instanceId?: string): Promise<LocalCoreLarkConnectionResult> => requireProvider().testLarkConnection(workspaceId, instanceId);
export const enableLarkGateway = (workspaceId: string, instanceId?: string): Promise<LocalCoreLarkGatewayStatus> => requireProvider().enableLarkGateway(workspaceId, instanceId);
export const disableLarkGateway = (workspaceId: string, instanceId?: string): Promise<LocalCoreLarkGatewayStatus> => requireProvider().disableLarkGateway(workspaceId, instanceId);
export const listLarkPendingPairings = (workspaceId?: string): Promise<LocalCorePairingRequest[]> => requireProvider().listLarkPendingPairings(workspaceId);
export const approveLarkPairing = (code: string): Promise<LocalCoreAuthorizedUser> => requireProvider().approveLarkPairing(code);
export const rejectLarkPairing = (code: string): Promise<{ rejected: boolean }> => requireProvider().rejectLarkPairing(code);
export const listLarkAuthorizedUsers = (workspaceId?: string): Promise<LocalCoreAuthorizedUser[]> => requireProvider().listLarkAuthorizedUsers(workspaceId);
export const probeWorkspaceStreaming = (workspaceId: string): Promise<WorkspaceStreamingProbeResult> =>
  requireProvider().probeWorkspaceStreaming(workspaceId);
export const onRuntimeEvent = (listener: (runtime: DesktopRuntimeStatus) => void) => requireProvider().onRuntimeEvent(listener);
export const onRuntimeDetectionEvent = (listener: (event: LocalCoreEvent) => void) =>
  requireProvider().onRuntimeDetectionEvent(listener);
export const onBridgeEvent = (listener: (event: DesktopBridgeEvent) => void) => requireProvider().onBridgeEvent(listener);
