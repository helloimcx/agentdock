import type { PluginContext, PluginManifest, RuntimePlugin } from './runtime.js';

export interface ChannelCapability {
  id: string;
  platform: string;
  routeType?: string;
  displayName?: string;
}

export interface ChannelRuntime {
  readonly platform: string;
  readonly routeType: string;
  listStatuses(): Promise<import('@cc/superai-contracts').LocalCoreChannelGatewayStatus[]> | import('@cc/superai-contracts').LocalCoreChannelGatewayStatus[];
  getStatus(workspaceId: string, instanceId?: string): Promise<import('@cc/superai-contracts').LocalCoreChannelGatewayStatus> | import('@cc/superai-contracts').LocalCoreChannelGatewayStatus;
  testConnection(workspaceId: string, instanceId?: string): Promise<import('@cc/superai-contracts').LocalCoreChannelConnectionResult> | import('@cc/superai-contracts').LocalCoreChannelConnectionResult;
  enable(workspaceId: string, instanceId?: string): Promise<import('@cc/superai-contracts').LocalCoreChannelGatewayStatus> | import('@cc/superai-contracts').LocalCoreChannelGatewayStatus;
  disable(workspaceId: string, instanceId?: string): Promise<import('@cc/superai-contracts').LocalCoreChannelGatewayStatus> | import('@cc/superai-contracts').LocalCoreChannelGatewayStatus;
  listPendingPairings(workspaceId?: string): Promise<import('@cc/superai-contracts').LocalCoreChannelPairingRequest[]> | import('@cc/superai-contracts').LocalCoreChannelPairingRequest[];
  approvePairing(code: string): Promise<import('@cc/superai-contracts').LocalCoreChannelAuthorizedUser> | import('@cc/superai-contracts').LocalCoreChannelAuthorizedUser;
  rejectPairing(code: string): Promise<{ rejected: boolean }> | { rejected: boolean };
  listAuthorizedUsers(workspaceId?: string): Promise<import('@cc/superai-contracts').LocalCoreChannelAuthorizedUser[]> | import('@cc/superai-contracts').LocalCoreChannelAuthorizedUser[];
  getQrCode?(workspaceId: string, instanceId?: string): Promise<import('@cc/superai-contracts').LocalCoreChannelQrCode> | import('@cc/superai-contracts').LocalCoreChannelQrCode;
  checkQrCodeStatus?(workspaceId: string, ticket: string, instanceId?: string): Promise<import('@cc/superai-contracts').LocalCoreChannelQrCodeStatus> | import('@cc/superai-contracts').LocalCoreChannelQrCodeStatus;
  onBridgeEvent?(event: import('@cc/superai-contracts').DesktopBridgeEvent): Promise<void> | void;
  refreshBindings?(): Promise<void> | void;
  sendScheduledMessage?(workspaceId: string, route: import('@cc/superai-contracts').ChannelRoute, text: string): Promise<string> | string;
  registerScheduledThreadBridge?(input: {
    workspaceId: string;
    platform: string;
    route: import('@cc/superai-contracts').ScheduledJobRoute;
    threadId: string;
    sessionKey: string;
  }): (() => void) | Promise<() => void>;
  sendOutboundMessage?(workspaceId: string, input: import('@cc/superai-contracts').ChannelOutboundMessageInput): Promise<import('@cc/superai-contracts').ChannelOutboundMessageResult> | import('@cc/superai-contracts').ChannelOutboundMessageResult;
  sendFile?(workspaceId: string, input: import('@cc/superai-contracts').ChannelFileSendInput): Promise<import('@cc/superai-contracts').ChannelFileSendResult> | import('@cc/superai-contracts').ChannelFileSendResult;
  muteThreadBridge?(threadId: string): void;
  unmuteThreadBridge?(threadId: string): void;
  close?(): void;
}

export interface ChannelRuntimeRegistration {
  channel: ChannelRuntime;
}

export interface ChannelPlugin extends RuntimePlugin {
  manifest: PluginManifest & { kind: 'channel' | 'composite' };
  createRuntime?(ctx: PluginContext): Promise<ChannelRuntimeRegistration> | ChannelRuntimeRegistration;
}
