import type { LocalCoreEvent } from '@cc/superai-contracts';
import { request } from '../../cli/cli-helpers.js';

export interface LocalCoreClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  reconnectBaseDelayMs?: number;
}

export interface CoreThread {
  id: string;
  title?: string;
  workspaceId?: string;
}

export interface LocalCoreStreamHandle {
  close: () => void;
}

export interface LocalCoreStreamHandlers {
  onEvent: (event: LocalCoreEvent) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError: (error: Error) => void;
  onClose: () => void;
}

const RECONNECT_INITIAL_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 16000;
const RECONNECT_RESET_AFTER_MS = 30_000;

export class LocalCoreApiClient {
  private readonly fetchImpl: typeof fetch;
  private readonly reconnectBaseDelayMs: number;

  constructor(private readonly options: LocalCoreClientOptions) {
    this.fetchImpl = options.fetchImpl || fetch;
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? RECONNECT_INITIAL_DELAY_MS;
  }

  async createThread(workspaceId: string, title?: string): Promise<CoreThread> {
    return await request<CoreThread>(this.options.baseUrl, 'POST', '/threads', {
      workspaceId,
      ...(title ? { title } : {}),
    });
  }

  async sendThreadMessage(threadId: string, content: string): Promise<{ runId: string }> {
    return await request<{ runId: string }>(
      this.options.baseUrl,
      'POST',
      `/threads/${encodeURIComponent(threadId)}/messages`,
      { content },
    );
  }

  async interruptRun(runId: string): Promise<{ interrupted: boolean }> {
    return await request<{ interrupted: boolean }>(
      this.options.baseUrl,
      'POST',
      `/runs/${encodeURIComponent(runId)}/interrupt`,
    );
  }

  streamEvents(handlers: LocalCoreStreamHandlers): LocalCoreStreamHandle {
    const controller = new AbortController();
    void this.runEventStreamLoop(controller, handlers);
    return {
      close: () => controller.abort(),
    };
  }

  private async runEventStreamLoop(controller: AbortController, handlers: LocalCoreStreamHandlers) {
    let delayMs = this.reconnectBaseDelayMs;
    while (!controller.signal.aborted) {
      const connectedAt = Date.now();
      try {
        await this.readEventStream(controller, handlers);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        handlers.onError(error instanceof Error ? error : new Error(String(error)));
      }
      if (controller.signal.aborted) {
        return;
      }
      if (Date.now() - connectedAt >= RECONNECT_RESET_AFTER_MS) {
        delayMs = this.reconnectBaseDelayMs;
      }
      handlers.onDisconnect?.();
      await sleep(delayMs);
      if (controller.signal.aborted) {
        return;
      }
      delayMs = Math.min(delayMs * 2, RECONNECT_MAX_DELAY_MS);
    }
    handlers.onClose();
  }

  private async readEventStream(controller: AbortController, handlers: LocalCoreStreamHandlers) {
    const response = await this.fetchImpl(`${this.options.baseUrl}/events`, {
      signal: controller.signal,
      headers: { Accept: 'text/event-stream' },
    });
    if (!response.ok || !response.body) {
      throw new Error(`Local AI Core event stream failed: HTTP ${response.status}`);
    }
    handlers.onConnect?.();
    let buffer = '';
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        buffer = this.consumeSseFrames(buffer, handlers);
      }
    } finally {
      reader.releaseLock();
    }
  }

  private consumeSseFrames(buffer: string, handlers: LocalCoreStreamHandlers): string {
    let rest = buffer;
    for (;;) {
      const frameEnd = rest.indexOf('\n\n');
      if (frameEnd < 0) {
        return rest;
      }
      const frame = rest.slice(0, frameEnd);
      rest = rest.slice(frameEnd + 2);
      const event = parseSseFrame(frame);
      if (event) {
        handlers.onEvent(event);
      }
    }
  }
}

function parseSseFrame(frame: string): LocalCoreEvent | null {
  let data = '';
  for (const line of frame.split('\n')) {
    if (line.startsWith('data: ')) {
      data += line.slice('data: '.length);
    }
  }
  if (!data) {
    return null;
  }
  try {
    return JSON.parse(data) as LocalCoreEvent;
  } catch {
    return null;
  }
}

export function isRunBridgeEvent(event: LocalCoreEvent): event is Extract<LocalCoreEvent, { type: 'stream.updated' }> {
  return event.type === 'stream.updated';
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
