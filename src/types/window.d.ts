import type {
  ConfigFileState,
  DesktopBridgeEvent,
  DesktopBridgeSendInput,
  DesktopBridgeSendResult,
  DesktopRuntimeStatus,
  DesktopSettings,
  DesktopSettingsInput,
  DesktopServiceState,
} from '../../shared/desktop';
import type {
  LocalCoreAuthorizedUser,
  LocalCoreLarkConnectionResult,
  LocalCoreLarkGatewayStatus,
  LocalCorePairingRequest,
  WorkspaceStreamingProbeResult,
} from '../../packages/contracts/src';

declare global {
  interface Window {
    desktop?: {
      getRuntimeStatus: () => Promise<DesktopRuntimeStatus>;
      startService: () => Promise<DesktopServiceState>;
      stopService: () => Promise<DesktopServiceState>;
      restartService: () => Promise<DesktopServiceState>;
      getLogs: (limit?: number) => Promise<string[]>;
      readConfigFile: () => Promise<ConfigFileState>;
      saveRawConfigFile: (raw: string) => Promise<ConfigFileState>;
      saveStructuredConfigFile: (config: unknown) => Promise<ConfigFileState>;
      getThreadKnowledgeBases: (workspaceId: string, threadId: string) => Promise<string[]>;
      updateThreadKnowledgeBases: (workspaceId: string, threadId: string, knowledgeBaseIds: string[]) => Promise<string[]>;
      deleteThreadKnowledgeBases: (workspaceId: string, threadId: string) => Promise<{ deleted: boolean }>;
      saveSettings: (input: DesktopSettingsInput) => Promise<DesktopSettings>;
      bridgeConnect: () => Promise<unknown>;
      bridgeDisconnect: () => Promise<unknown>;
      bridgeSendMessage: (input: DesktopBridgeSendInput) => Promise<DesktopBridgeSendResult>;
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
  }
}

export {};
