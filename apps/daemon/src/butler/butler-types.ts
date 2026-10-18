import type { WorkspaceRouter } from '../router/workspace-router.js';
import type { ButlerBotEndpoint, ChannelBotMemberLookupInput, ChannelBotMessageInput, ChannelBotMessageResult } from '@cc/superai-contracts';

export interface ButlerChannelTransport {
  listButlerBotEndpoints(): Promise<ButlerBotEndpoint[]>;
  sendBotMessage(platform: string, workspaceId: string, input: ChannelBotMessageInput): Promise<ChannelBotMessageResult>;
  resolveBotMemberId(platform: string, workspaceId: string, input: ChannelBotMemberLookupInput): Promise<string>;
}

export type ButlerRouter = Pick<WorkspaceRouter, 'createThread' | 'sendThreadMessage' | 'interruptRun' | 'getWorkspaceAgentType' | 'getWorkspaceDefaultProviderId'>;
export interface ButlerServiceOptions {
  intervalMs?: number;
  onError?: (error: unknown) => void;
  channels?: ButlerChannelTransport;
}
