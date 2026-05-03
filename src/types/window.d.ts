import type {
  ConfigFileState,
  DesktopBridgeEvent,
  DesktopRuntimeStatus,
  DesktopSettings,
  DesktopSettingsInput,
  DesktopServiceState,
} from '../../shared/desktop';
import type {
  LocalCoreAuthorizedUser,
  LocalCoreChannelAuthorizedUser,
  LocalCoreChannelConnectionResult,
  LocalCoreChannelGatewayStatus,
  LocalCoreChannelQrCode,
  LocalCoreChannelQrCodeStatus,
  LocalCoreLarkConnectionResult,
  LocalCoreLarkGatewayStatus,
  LocalCoreLarkQrCodeStatus,
  LocalCoreChannelPairingRequest,
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
      checkWeixinQrCodeStatus: (workspaceId: string, ticket: string, instanceId?: string) => Promise<LocalCoreChannelQrCodeStatus>;
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
      onBridgeEvent: (listener: (event: DesktopBridgeEvent) => void) => () => void;
    };
  }
}

export {};
