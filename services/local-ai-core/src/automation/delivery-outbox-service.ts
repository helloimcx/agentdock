import { extractChannelInstanceId } from '../channel/shared/channel-keys.js';
import type { ChannelRuntime } from '@cc/plugin-sdk';
import type { DeliveryRecord } from '@cc/superai-contracts';
import type { DeliveryOutboxStore } from '../acp/store/delivery-outbox-store.js';

/** Receipts are persisted separately from successful Agent execution. */
export class DeliveryOutboxService {
  private readonly active = new Map<string, Promise<DeliveryRecord | undefined>>();
  constructor(private readonly store: DeliveryOutboxStore,
    private readonly getChannelRuntime: (platform: string) => ChannelRuntime | undefined,
    private readonly destinationExists: (record: DeliveryRecord) => boolean = () => true) {}

  async recover(): Promise<void> {
    this.store.recover();
    for (const record of this.store.list().filter((row) => row.status === 'pending')) await this.deliver(record.id);
  }

  deliver(id: string): Promise<DeliveryRecord | undefined> {
    const active = this.active.get(id);
    if (active) return active;
    const promise = this.send(id).finally(() => this.active.delete(id));
    this.active.set(id, promise);
    return promise;
  }

  private async send(id: string): Promise<DeliveryRecord | undefined> {
    const pending = this.store.get(id);
    if (!pending || pending.status !== 'pending') return pending;
    const runtime = this.getChannelRuntime(pending.platform);
    // These checks precede claim/send; they cannot represent an uncertain remote effect.
    const record = this.store.claim(id);
    if (!record) return this.store.get(id);
    if (!this.destinationExists(record)) return this.store.settle(id, record.attempt, 'failed', [], 'Delivery owner or destination was removed.');
    if (record.platform === 'local') return this.store.settle(id, record.attempt, 'delivered');
    if (!runtime?.sendOutboundMessage) return this.store.settle(id, record.attempt, 'failed', [], 'Channel delivery is unavailable.');
    const route = { ...record.route, instanceId: record.route.instanceId || extractChannelInstanceId(record.platform, runtime.platform) || undefined };
    try {
      const status = await runtime.getStatus(record.workspaceId, route.instanceId);
      if (!status.connected) return this.store.settle(id, record.attempt, 'failed', [], 'Channel destination is disconnected.');
    } catch {
      return this.store.settle(id, record.attempt, 'failed', [], 'Channel destination is unavailable.');
    }
    let result: Awaited<ReturnType<NonNullable<ChannelRuntime['sendOutboundMessage']>>>;
    try {
      result = await runtime.sendOutboundMessage(record.workspaceId, {
        route, parts: [{ type: 'text', text: record.content }],
        metadata: { deliveryId: record.id, sourceRunId: record.acpRunId },
      });
    } catch (error) {
      return this.store.settle(id, record.attempt, 'unknown', [], error instanceof Error ? error.message : String(error));
    }
    // Persistence failures propagate. The durable sending record will become unknown on restart.
    if (result.deliveryAcknowledgement !== 'confirmed') {
      return this.store.settle(id, record.attempt, 'unknown', [], 'Channel returned no confirmed platform acknowledgement.');
    }
    return this.store.settle(id, record.attempt, 'delivered', result.messageIds);
  }
}
