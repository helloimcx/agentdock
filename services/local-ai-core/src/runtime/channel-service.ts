import type {
  LocalCoreChannelAuthorizedUser,
  LocalCoreChannelConnectionResult,
  LocalCoreChannelGatewayStatus,
  LocalCoreChannelPairingRequest,
  LocalCoreChannelQrCode,
  LocalCoreChannelQrCodeStatus,
  ChannelFileSendInput,
  ChannelFileSendResult,
  ChannelBotMessageInput,
  ChannelBotMessageResult,
  ChannelBotMemberLookupInput,
  ChannelOutboundMessageInput,
  ChannelOutboundMessageResult,
} from '@cc/superai-contracts';
import type { ChannelRuntime } from '@cc/plugin-sdk';
import type { ButlerBotEndpoint } from '@cc/superai-contracts';

export class ChannelService {
  constructor(private readonly runtimes: Map<string, ChannelRuntime>) {}

  async listStatuses(platform?: string): Promise<LocalCoreChannelGatewayStatus[]> {
    if (!platform) {
      const statuses = await Promise.all(
        [...this.runtimes.values()].map((runtime) => runtime.listStatuses()),
      );
      return statuses.flat();
    }
    return this.resolve(platform).listStatuses();
  }

  async listButlerBotEndpoints(): Promise<ButlerBotEndpoint[]> {
    const statuses = await this.listStatuses('lark');
    const endpoints = statuses.flatMap((status) => {
      if (!status.appId || !status.botOpenId || !status.instanceId) return [];
      return [{
        id: `lark:${status.appId}:${status.botOpenId}`,
        bindingId: `lark:${status.appId}:${status.botOpenId}:${status.workspaceId}:${status.instanceId}`,
        platform: 'lark' as const,
        appId: status.appId,
        botOpenId: status.botOpenId,
        workspaceId: status.workspaceId,
        instanceId: status.instanceId,
        displayName: status.displayName || status.workspaceId,
        connected: status.connected,
      }];
    });
    const unique = new Map<string, ButlerBotEndpoint>();
    for (const endpoint of endpoints) if (!unique.has(endpoint.bindingId || endpoint.id)) unique.set(endpoint.bindingId || endpoint.id, endpoint);
    return [...unique.values()];
  }

  async getStatus(platform: string, workspaceId: string, instanceId?: string): Promise<LocalCoreChannelGatewayStatus> {
    return this.resolve(platform).getStatus(workspaceId, instanceId);
  }

  async testConnection(platform: string, workspaceId: string, instanceId?: string): Promise<LocalCoreChannelConnectionResult> {
    return this.resolve(platform).testConnection(workspaceId, instanceId);
  }

  async enable(platform: string, workspaceId: string, instanceId?: string): Promise<LocalCoreChannelGatewayStatus> {
    return this.resolve(platform).enable(workspaceId, instanceId);
  }

  async disable(platform: string, workspaceId: string, instanceId?: string): Promise<LocalCoreChannelGatewayStatus> {
    return this.resolve(platform).disable(workspaceId, instanceId);
  }

  async listPendingPairings(platform: string, workspaceId?: string): Promise<LocalCoreChannelPairingRequest[]> {
    return this.resolve(platform).listPendingPairings(workspaceId);
  }

  async approvePairing(platform: string, code: string): Promise<LocalCoreChannelAuthorizedUser> {
    return this.resolve(platform).approvePairing(code);
  }

  async rejectPairing(platform: string, code: string) {
    return this.resolve(platform).rejectPairing(code);
  }

  async listAuthorizedUsers(platform: string, workspaceId?: string): Promise<LocalCoreChannelAuthorizedUser[]> {
    return this.resolve(platform).listAuthorizedUsers(workspaceId);
  }

  async sendFile(platform: string, workspaceId: string, input: ChannelFileSendInput): Promise<ChannelFileSendResult> {
    const runtime = this.resolve(platform);
    if (runtime.sendOutboundMessage) {
      const result = await runtime.sendOutboundMessage(workspaceId, {
        route: {
          type: 'channel.chat',
          channelId: input.channelId,
          participantId: input.participantId,
        },
        parts: [{
          type: 'file',
          path: input.path,
          fileName: input.fileName,
          metadata: input.workspacePath ? { workspacePath: input.workspacePath } : undefined,
        }],
      });
      const attachment = result.attachments?.[0];
      return {
        platform: result.platform,
        workspaceId: result.workspaceId,
        channelId: result.channelId,
        messageId: result.messageIds[0] || '',
        messageIds: result.messageIds,
        fileKey: String(attachment?.metadata?.fileKey || attachment?.attachmentId || ''),
        attachmentId: attachment?.attachmentId,
        fileName: attachment?.fileName || input.fileName || '',
        fileSize: attachment?.fileSize || 0,
        metadata: result.metadata,
      };
    }
    if (!runtime.sendFile) {
      throw new Error(`Channel platform does not support sending files: ${platform}`);
    }
    return runtime.sendFile(workspaceId, input);
  }

  async sendMessage(platform: string, workspaceId: string, input: ChannelOutboundMessageInput): Promise<ChannelOutboundMessageResult> {
    const runtime = this.resolve(platform);
    if (!runtime.sendOutboundMessage) {
      throw new Error(`Channel platform does not support outbound messages: ${platform}`);
    }
    return runtime.sendOutboundMessage(workspaceId, input);
  }

  async sendBotMessage(platform: string, workspaceId: string, input: ChannelBotMessageInput): Promise<ChannelBotMessageResult> {
    const runtime = this.resolve(platform);
    if (!runtime.sendBotMessage) throw new Error(`Channel platform does not support bot-to-bot messages: ${platform}`);
    return runtime.sendBotMessage(workspaceId, input);
  }

  async resolveBotMemberId(platform: string, workspaceId: string, input: ChannelBotMemberLookupInput): Promise<string> {
    const runtime = this.resolve(platform);
    if (!runtime.resolveBotMemberId) throw new Error(`Channel platform does not support bot member lookup: ${platform}`);
    return runtime.resolveBotMemberId(workspaceId, input);
  }

  async getQrCode(platform: string, workspaceId: string, instanceId?: string): Promise<LocalCoreChannelQrCode> {
    const runtime = this.resolve(platform);
    if (!runtime.getQrCode) {
      throw new Error(`Channel platform does not support QR setup: ${platform}`);
    }
    return runtime.getQrCode(workspaceId, instanceId);
  }

  async checkQrCodeStatus(
    platform: string,
    workspaceId: string,
    ticket: string,
    instanceId?: string,
  ): Promise<LocalCoreChannelQrCodeStatus> {
    const runtime = this.resolve(platform);
    if (!runtime.checkQrCodeStatus) {
      throw new Error(`Channel platform does not support QR setup: ${platform}`);
    }
    return runtime.checkQrCodeStatus(workspaceId, ticket, instanceId);
  }

  async refreshBindings() {
    await Promise.all(
      [...this.runtimes.values()].map((runtime) => runtime.refreshBindings?.()),
    );
  }

  assertPlatform(platform: string) {
    this.resolve(platform);
  }

  private resolve(platform: string): ChannelRuntime {
    const runtime = this.runtimes.get(platform);
    if (runtime) {
      return runtime;
    }
    throw new Error(`Unsupported channel platform: ${platform}`);
  }
}
