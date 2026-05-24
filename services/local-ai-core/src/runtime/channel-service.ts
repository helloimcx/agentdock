import type {
  LocalCoreAuthorizedUser,
  LocalCoreChannelAuthorizedUser,
  LocalCoreChannelConnectionResult,
  LocalCoreChannelGatewayStatus,
  LocalCoreChannelPairingRequest,
  LocalCoreChannelQrCode,
  LocalCoreChannelQrCodeStatus,
  LocalCoreLarkConnectionResult,
  LocalCoreLarkGatewayStatus,
  LocalCoreLarkQrCodeStatus,
  LocalCorePairingRequest,
  ChannelFileSendInput,
  ChannelFileSendResult,
  ChannelOutboundMessageInput,
  ChannelOutboundMessageResult,
} from '../../../../packages/contracts/src/index.js';
import type { ChannelRuntime } from '../../../../packages/plugin-sdk/src/index.js';

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

  async getWeixinQrCode(workspaceId: string, instanceId?: string): Promise<LocalCoreChannelQrCode> {
    return this.getQrCode('weixin', workspaceId, instanceId);
  }

  async checkWeixinQrCodeStatus(workspaceId: string, ticket: string, instanceId?: string): Promise<{
    status: 'wait' | 'signed' | 'confirmed' | 'expired';
    userName?: string;
    userId?: string;
  }> {
    return this.checkQrCodeStatus('weixin', workspaceId, ticket, instanceId);
  }

  // Lark convenience wrappers

  async listLarkStatuses(): Promise<LocalCoreLarkGatewayStatus[]> {
    return this.listStatuses('lark') as Promise<LocalCoreLarkGatewayStatus[]>;
  }

  async getLarkStatus(workspaceId: string, instanceId?: string): Promise<LocalCoreLarkGatewayStatus> {
    return this.getStatus('lark', workspaceId, instanceId) as Promise<LocalCoreLarkGatewayStatus>;
  }

  async testLarkConnection(workspaceId: string, instanceId?: string): Promise<LocalCoreLarkConnectionResult> {
    return this.testConnection('lark', workspaceId, instanceId) as Promise<LocalCoreLarkConnectionResult>;
  }

  async enableLark(workspaceId: string, instanceId?: string): Promise<LocalCoreLarkGatewayStatus> {
    return this.enable('lark', workspaceId, instanceId) as Promise<LocalCoreLarkGatewayStatus>;
  }

  async disableLark(workspaceId: string, instanceId?: string): Promise<LocalCoreLarkGatewayStatus> {
    return this.disable('lark', workspaceId, instanceId) as Promise<LocalCoreLarkGatewayStatus>;
  }

  async listLarkPendingPairings(workspaceId?: string): Promise<LocalCorePairingRequest[]> {
    return this.listPendingPairings('lark', workspaceId) as Promise<LocalCorePairingRequest[]>;
  }

  async approveLarkPairing(code: string): Promise<LocalCoreAuthorizedUser> {
    return this.approvePairing('lark', code) as Promise<LocalCoreAuthorizedUser>;
  }

  async rejectLarkPairing(code: string) {
    return this.rejectPairing('lark', code);
  }

  async listLarkAuthorizedUsers(workspaceId?: string): Promise<LocalCoreAuthorizedUser[]> {
    return this.listAuthorizedUsers('lark', workspaceId) as Promise<LocalCoreAuthorizedUser[]>;
  }

  async getLarkQrCode(workspaceId: string, instanceId?: string): Promise<LocalCoreChannelQrCode> {
    return this.getQrCode('lark', workspaceId, instanceId);
  }

  async checkLarkQrCodeStatus(workspaceId: string, ticket: string, instanceId?: string): Promise<LocalCoreLarkQrCodeStatus> {
    return this.checkQrCodeStatus('lark', workspaceId, ticket, instanceId) as Promise<LocalCoreLarkQrCodeStatus>;
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
