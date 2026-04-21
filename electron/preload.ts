import { contextBridge, ipcRenderer } from 'electron';
import type {
  DesktopBridgeEvent,
  DesktopBridgeSendInput,
  DesktopSettingsInput,
} from '../shared/desktop.js';
import type { WorkspaceStreamingProbeResult } from '../packages/contracts/src/index.js';

contextBridge.exposeInMainWorld('desktop', {
  getRuntimeStatus: () => ipcRenderer.invoke('desktop:get-runtime-status'),
  startService: () => ipcRenderer.invoke('desktop:start-service'),
  stopService: () => ipcRenderer.invoke('desktop:stop-service'),
  restartService: () => ipcRenderer.invoke('desktop:restart-service'),
  getLogs: (limit?: number) => ipcRenderer.invoke('desktop:get-logs', limit),
  readConfigFile: () => ipcRenderer.invoke('desktop:read-config'),
  saveRawConfigFile: (raw: string) => ipcRenderer.invoke('desktop:save-config-raw', raw),
  saveStructuredConfigFile: (config: unknown) => ipcRenderer.invoke('desktop:save-config-structured', config),
  getThreadKnowledgeBases: (workspaceId: string, threadId: string) =>
    ipcRenderer.invoke('desktop:get-thread-knowledge-bases', workspaceId, threadId),
  updateThreadKnowledgeBases: (workspaceId: string, threadId: string, knowledgeBaseIds: string[]) =>
    ipcRenderer.invoke('desktop:update-thread-knowledge-bases', workspaceId, threadId, knowledgeBaseIds),
  deleteThreadKnowledgeBases: (workspaceId: string, threadId: string) =>
    ipcRenderer.invoke('desktop:delete-thread-knowledge-bases', workspaceId, threadId),
  saveSettings: (input: DesktopSettingsInput) => ipcRenderer.invoke('desktop:save-settings', input),
  bridgeConnect: () => ipcRenderer.invoke('desktop:bridge-connect'),
  bridgeDisconnect: () => ipcRenderer.invoke('desktop:bridge-disconnect'),
  bridgeSendMessage: (input: DesktopBridgeSendInput) => ipcRenderer.invoke('desktop:bridge-send-message', input),
  listLarkGateways: () => ipcRenderer.invoke('desktop:list-lark-gateways'),
  getLarkGatewayStatus: (workspaceId: string) => ipcRenderer.invoke('desktop:get-lark-gateway-status', workspaceId),
  testLarkConnection: (workspaceId: string) => ipcRenderer.invoke('desktop:test-lark-connection', workspaceId),
  enableLarkGateway: (workspaceId: string) => ipcRenderer.invoke('desktop:enable-lark-gateway', workspaceId),
  disableLarkGateway: (workspaceId: string) => ipcRenderer.invoke('desktop:disable-lark-gateway', workspaceId),
  listLarkPendingPairings: (workspaceId?: string) => ipcRenderer.invoke('desktop:list-lark-pairings', workspaceId),
  approveLarkPairing: (code: string) => ipcRenderer.invoke('desktop:approve-lark-pairing', code),
  rejectLarkPairing: (code: string) => ipcRenderer.invoke('desktop:reject-lark-pairing', code),
  listLarkAuthorizedUsers: (workspaceId?: string) => ipcRenderer.invoke('desktop:list-lark-users', workspaceId),
  probeWorkspaceStreaming: (workspaceId: string): Promise<WorkspaceStreamingProbeResult> =>
    ipcRenderer.invoke('desktop:probe-workspace-streaming', workspaceId),
  onRuntimeEvent: (listener: (runtime: any) => void) => {
    const wrapped = (_event: unknown, payload: any) => listener(payload);
    ipcRenderer.on('desktop:runtime', wrapped);
    return () => ipcRenderer.removeListener('desktop:runtime', wrapped);
  },
  onBridgeEvent: (listener: (event: DesktopBridgeEvent) => void) => {
    const wrapped = (_event: unknown, payload: DesktopBridgeEvent) => listener(payload);
    ipcRenderer.on('desktop:bridge', wrapped);
    return () => ipcRenderer.removeListener('desktop:bridge', wrapped);
  },
});
