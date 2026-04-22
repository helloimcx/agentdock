import type { EventBus, EventBusEvent } from '../../../../packages/plugin-sdk/src/index.js';

type Listener = (payload: unknown) => void;

export class LocalCoreEventBus implements EventBus {
  private readonly listeners = new Map<string, Set<Listener>>();

  emit<TPayload>(event: EventBusEvent<TPayload>) {
    const listeners = this.listeners.get(event.type);
    if (!listeners) {
      return;
    }
    for (const listener of listeners) {
      listener(event.payload);
    }
  }

  on<TPayload>(type: string, listener: (payload: TPayload) => void) {
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
