export interface CoreEventSource {
  onerror: ((...args: any[]) => void) | null;
  onopen?: ((...args: any[]) => void) | null;
  addEventListener(type: string, listener: (...args: any[]) => void): void;
  close(): void;
}
