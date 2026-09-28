import type { DesktopBridgeEvent, LocalCoreEvent } from '@cc/superai-contracts';

export interface LocalCoreClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
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
  onError: (error: Error) => void;
  onClose: () => void;
}

type JsonEnvelope<T> = {
  ok: boolean;
  data: T;
  error?: string;
};

export class LocalCoreApiClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: LocalCoreClientOptions) {
    this.fetchImpl = options.fetchImpl || fetch;
  }

  async createThread(workspaceId: string, title?: string): Promise<CoreThread> {
    return await this.requestJson<CoreThread>('POST', '/threads', {
      workspaceId,
      ...(title ? { title } : {}),
    });
  }

  async sendThreadMessage(threadId: string, content: string): Promise<{ runId: string }> {
    return await this.requestJson<{ runId: string }>(
      'POST',
      `/threads/${encodeURIComponent(threadId)}/messages`,
      { content },
    );
  }

  async interruptRun(runId: string): Promise<{ interrupted: boolean }> {
    return await this.requestJson<{ interrupted: boolean }>(
      'POST',
      `/runs/${encodeURIComponent(runId)}/interrupt`,
    );
  }

  streamEvents(handlers: LocalCoreStreamHandlers): LocalCoreStreamHandle {
    const controller = new AbortController();
    void this.readEventStream(controller, handlers).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        handlers.onError(error instanceof Error ? error : new Error(String(error)));
      }
    });
    return {
      close: () => controller.abort(),
    };
  }

  private async readEventStream(controller: AbortController, handlers: LocalCoreStreamHandlers) {
    const response = await this.fetchImpl(`${this.options.baseUrl}/events`, {
      signal: controller.signal,
      headers: { Accept: 'text/event-stream' },
    });
    if (!response.ok || !response.body) {
      throw new Error(`Local AI Core event stream failed: HTTP ${response.status}`);
    }
    let buffer = '';
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      buffer = this.consumeSseFrames(buffer, handlers);
    }
    handlers.onClose();
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

  private async requestJson<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new Error(`Local AI Core is unavailable at ${this.options.baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const payload = (await response.json().catch(() => undefined)) as JsonEnvelope<T> | undefined;
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || `Local AI Core request failed: HTTP ${response.status}`);
    }
    return payload.data;
  }
}

export function parseSseFrame(frame: string): LocalCoreEvent | null {
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

export type RunBridgeEvent = DesktopBridgeEvent;
