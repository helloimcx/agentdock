import type {
  LocalCoreChannelAuthorizedUser,
  LocalCoreChannelConnectionResult,
  LocalCoreChannelGatewayStatus,
  LocalCoreChannelPairingRequest,
  LocalCoreChannelQrCode,
  LocalCoreChannelQrCodeStatus,
  ChannelFileSendInput,
  ChannelFileSendResult,
  ChannelOutboundMessageInput,
  ChannelOutboundMessageResult,
} from '@cc/superai-contracts';
import type { ChannelRuntime } from '@cc/plugin-sdk';

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
