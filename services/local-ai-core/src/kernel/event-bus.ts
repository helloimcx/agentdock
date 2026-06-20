import type { DomainEventPayloadMap, DomainEventType, EventBus, EventBusEvent } from '@cc/plugin-sdk';

type Listener = (payload: unknown) => void;

export class LocalCoreEventBus implements EventBus {
  private readonly listeners = new Map<string, Set<Listener>>();

  emit<TType extends DomainEventType>(event: EventBusEvent<TType>) {
    const listeners = this.listeners.get(event.type);
    if (!listeners) {
      return;
    }
    for (const listener of listeners) {
      listener(event.payload);
    }
  }

  on<TType extends DomainEventType>(type: TType, listener: (payload: DomainEventPayloadMap[TType]) => void) {
    const listeners = this.listeners.get(type) || new Set<Listener>();
    listeners.add(listener as Listener);
    this.listeners.set(type, listeners);
    return () => {
      listeners.delete(listener as Listener);
      if (!listeners.size) {
        this.listeners.delete(type);
      }
    };
  }
}
