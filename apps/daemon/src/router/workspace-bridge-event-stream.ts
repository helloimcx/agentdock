import type { DesktopBridgeEvent } from '@cc/superai-contracts';
import type { EventBus } from '@cc/plugin-sdk';

export class WorkspaceBridgeEventStream {
  private readonly subscribers = new Set<(event: DesktopBridgeEvent) => void>();

  constructor(private readonly eventBus: EventBus) {}

  emit(event: DesktopBridgeEvent) {
    this.eventBus.emit({
      type: 'platform.bridge.updated',
      payload: event,
    });
    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }

  subscribe(subscriber: (event: DesktopBridgeEvent) => void) {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  clear() {
    this.subscribers.clear();
  }
}
