import type { WorkspaceRouter } from '../router/workspace-router.js';
import type { ButlerBotEndpoint, ChannelBotMessageInput, ChannelBotMessageResult } from '@cc/superai-contracts';

export interface ButlerChannelTransport {
  listButlerBotEndpoints(): Promise<ButlerBotEndpoint[]>;
  sendBotMessage(platform: string, workspaceId: string, input: ChannelBotMessageInput): Promise<ChannelBotMessageResult>;
}

export type ButlerRouter = Pick<WorkspaceRouter, 'createThread' | 'sendThreadMessage' | 'interruptRun'>;
export interface ButlerServiceOptions {
  intervalMs?: number;
  onError?: (error: unknown) => void;
  channels?: ButlerChannelTransport;
}
