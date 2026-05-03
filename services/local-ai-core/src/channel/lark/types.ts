import type {
  ChannelInboundContentPart,
  DesktopBridgeEvent,
  DesktopConnectConfig,
  DesktopProjectConfig,
} from '../../../../../packages/contracts/src/index.js';
import type { EventBus } from '../../../../../packages/plugin-sdk/src/index.js';
import type { LocalCoreAcpStore } from '../../acp/local-core-acp-store.js';
import type { WorkspaceRouter } from '../../router/workspace-router.js';

export type LarkModule = typeof import('@larksuiteoapi/node-sdk');

export type LarkWorkspaceBinding = {
  workspaceId: string;
  instanceId: string;
  displayName: string;
  platformKey: string;
  appId: string;
  appSecret: string;
  encryptKey: string;
  verificationToken: string;
  autoApprove: boolean;
  cardActionsEnabled: boolean;
  brand: 'feishu' | 'lark';
  enabled: boolean;
  project: DesktopProjectConfig;
};

export type LarkRuntimeState = {
  workspaceId: string;
  instanceId: string;
  displayName: string;
  platformKey: string;
  enabled: boolean;
  status: 'disabled' | 'starting' | 'running' | 'error' | 'stopped';
  connected: boolean;
  appId: string;
  autoApprove: boolean;
  cardActionsEnabled: boolean;
  lastError?: string;
  connectedAt?: string;
  client?: any;
  wsClient?: any;
  eventDispatcher?: any;
};

export type LarkInboundMessage = {
  workspaceId: string;
  instanceId?: string;
  platformKey?: string;
  platformUserId: string;
  chatId: string;
  displayName: string;
  text: string;
  messageId: string;
  contentParts?: ChannelInboundContentPart[];
};

export type LarkButtonRow = Array<Array<{ text: string; data: string }>>;

export type LarkTurnState = {
  sessionKey: string;
  replyCtx?: string;
  messageId?: string;
  finalMessageId?: string;
  replyMessageId?: string;
  progressMessageIds: Record<string, string>;
  permissionMessageId?: string;
  awaitingPermission: boolean;
  sourceMessageId?: string;
  acknowledgementReactionId?: string;
  processing: boolean;
  previewText: string;
  finalText: string;
  thinkingSteps: string[];
  toolCalls: string[];
  statusLines: string[];
  buttonRows: LarkButtonRow;
  lastPatchedAt: number;
  lastPatchedAtByMessageId: Record<string, number>;
};

export type LarkOutboundRender = {
  key: string;
  text: string;
  buttonRows: LarkButtonRow;
  isFinal: boolean;
  finalSource?: 'stream' | 'reply';
};

export type LocalCoreLarkGatewayOptions = {
  store: LocalCoreAcpStore;
  readConfig: () => Promise<DesktopConnectConfig | null | undefined>;
  getWorkspaceRouter: () => WorkspaceRouter;
  eventBus: EventBus;
  log?: (message: string) => void;
};

export type LarkCardActionValue = {
  response: string;
  threadId: string;
  sessionKey: string;
};

export type LarkThreadRoute = {
  workspaceId: string;
  instanceId: string;
  platformKey: string;
  platformUserId: string;
  chatId: string;
  threadId: string;
};

export type LarkBridgeEvent = DesktopBridgeEvent;
