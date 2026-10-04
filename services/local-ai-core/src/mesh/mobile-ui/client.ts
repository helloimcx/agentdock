import type {
  UIStatusResult,
  UIDumpResult,
  UIElement,
  ClickOptions,
  ClickResult,
  InputOptions,
  InputResult,
  ScrollOptions,
  ScrollResult,
  ActionOptions,
  ActionResult,
  WaitOptions,
  MobileUiClientOptions,
} from './types.js';

export class MobileUiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: MobileUiClientOptions = {}) {
    this.baseUrl = (options.baseUrl || 'http://127.0.0.1:19832').replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 8000;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const signal = AbortSignal.timeout(this.timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal,
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers || {}),
        },
      });

      if (!response.ok) {
        let errMessage = `HTTP ${response.status} ${response.statusText}`;
        try {
          const errBody = await response.json() as { error?: string };
          if (errBody?.error) errMessage = errBody.error;
        } catch {
          // Keep default message
        }
        throw new Error(errMessage);
      }

      return (await response.json()) as T;
    } catch (err) {
      if (err instanceof Error) {
        const msg = err.message.toLowerCase();
        if (msg.includes('econnrefused') || msg.includes('fetch failed')) {
          throw new Error(
            `Accessibility Bridge Daemon is not reachable at ${this.baseUrl}. ` +
            'Please ensure the AgentDock Accessibility APK is installed and the accessibility service is enabled in Android Settings.'
          );
        }
      }
      throw err;
    }
  }

  async getStatus(): Promise<UIStatusResult> {
    return this.request<UIStatusResult>('/api/status');
  }

  async dump(options?: { interactiveOnly?: boolean }): Promise<UIDumpResult> {
    const interactive = options?.interactiveOnly !== false;
    return this.request<UIDumpResult>(`/api/dump?interactiveOnly=${interactive}`);
  }

  async click(options: ClickOptions): Promise<ClickResult> {
    return this.request<ClickResult>('/api/click', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async input(options: InputOptions): Promise<InputResult> {
    return this.request<InputResult>('/api/input', {
      method: 'POST',
      body: JSON.stringify({
        text: options.text,
        index: options.index,
        clear: options.clear !== false,
      }),
    });
  }

  async scroll(options: ScrollOptions): Promise<ScrollResult> {
    return this.request<ScrollResult>('/api/scroll', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async action(options: ActionOptions): Promise<ActionResult> {
    return this.request<ActionResult>('/api/action', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async wait(options: WaitOptions): Promise<UIElement> {
    const timeout = (options.timeoutSeconds ?? 5) * 1000;
    const interval = options.intervalMs ?? 250;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const dump = await this.dump();
        const matched = dump.elements?.find(el => {
          if (options.text) {
            const hasText = el.text && el.text.includes(options.text);
            const hasDesc = el.desc && el.desc.includes(options.text);
            if (hasText || hasDesc) return true;
          }
          if (options.id && el.id && el.id.includes(options.id)) return true;
          return false;
        });

        if (matched) {
          return matched;
        }
      } catch {
        // Retry until timeout
      }

      await new Promise(r => setTimeout(r, interval));
    }

    throw new Error(
      `Timed out after ${options.timeoutSeconds ?? 5}s waiting for element matching ${
        options.text ? `text "${options.text}"` : `id "${options.id}"`
      }`
    );
  }
}
