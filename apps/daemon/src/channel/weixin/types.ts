import type {
  ChannelInboundContentPart,
  DesktopConnectConfig,
  DesktopProjectConfig,
  LocalCoreChannelGatewayStatus,
  LocalCoreErrorInfo,
} from '@cc/superai-contracts';
import type { EventBus } from '@cc/plugin-sdk';
import type { LocalCoreAcpStore } from '../../acp/local-core-acp-store.js';
import type { WorkspaceRouter } from '../../router/workspace-router.js';

export type WeixinWorkspaceBinding = {
  workspaceId: string;
  instanceId: string;
  displayName: string;
  platformKey: string;
  token: string;
  accountId: string;
  baseUrl: string;
  cdnBaseUrl: string;
  allowFrom: string;
  routeTag: string;
  longPollTimeoutMs: number;
  stateDir: string;
  proxy: string;
  proxyUsername: string;
  proxyPassword: string;
  enabled: boolean;
  project: DesktopProjectConfig;
};

export type WeixinCredentials = {
  token: string;
  baseUrl?: string;
  botId?: string;
  userId?: string;
  savedAt: string;
};

export type WeixinRuntimeState = {
  workspaceId: string;
  instanceId: string;
  displayName: string;
  platformKey: string;
  enabled: boolean;
  status: LocalCoreChannelGatewayStatus['status'];
  connected: boolean;
  accountId: string;
  lastError?: string;
  lastErrorInfo?: LocalCoreErrorInfo;
  lastErrorAt?: string;
  consecutiveFailures?: number;
  nextRetryAt?: string;
  connectedAt?: string;
  abortController?: AbortController;
};

export type WeixinInboundMessage = {
  workspaceId: string;
  instanceId?: string;
  platformKey?: string;
  platformUserId: string;
  chatId: string;
  displayName: string;
  text: string;
  messageId: string;
  contextToken?: string;
  contentParts?: ChannelInboundContentPart[];
};

export type WeixinTurnState = {
  sessionKey: string;
  messageId?: string;
  sourceMessageId?: string;
  sentCount: number;
  foldedProgressCount: number;
  awaitingPermission: boolean;
  processing: boolean;
  previewText: string;
  finalText: string;
  thinkingSteps: string[];
  pendingThoughtText?: string;
  statusLines: string[];
  buttonRows: Array<Array<{ text: string; data: string }>>;
  lastSentAt: number;
  lastSentText: string;
};

export type WeixinThreadRoute = {
  workspaceId: string;
  instanceId: string;
  platformKey: string;
  platformUserId: string;
  chatId: string;
  threadId: string;
};

export type LocalCoreWeixinGatewayOptions = {
  store: LocalCoreAcpStore;
  readConfig: () => Promise<DesktopConnectConfig | null | undefined>;
  getWorkspaceRouter: () => WorkspaceRouter;
  eventBus: EventBus;
  log?: (message: string) => void;
};

export type WeixinRawItem = {
  type?: number;
  text_item?: { text?: string };
  voice_item?: { text?: string };
  image_item?: WeixinMediaData;
  file_item?: WeixinMediaData;
};

export type WeixinRawMessage = {
  from_user_id?: string;
  context_token?: string;
  msg_id?: string;
  item_list?: WeixinRawItem[];
};

export type WeixinMediaData = {
  media?: { encrypt_query_param?: string; aes_key?: string };
  aeskey?: string;
  file_name?: string;
};

export type GetUpdatesResp = {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinRawMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
};

export type SendMessageResp = {
  ret?: number;
  errcode?: number;
  errmsg?: string;
};

export type GetUploadUrlResp = {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  upload_param?: string;
};

export type UploadedWeixinFile = {
  fileKey: string;
  encryptedQueryParam: string;
  aesKeyHex: string;
  fileSize: number;
  cipherSize: number;
};

export type QrCodeStatusResp = {
  status?: string;
  bot_token?: string;
  baseurl?: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
  user_name?: string;
  user_id?: string;
  errcode?: number;
  errmsg?: string;
};
