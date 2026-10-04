import type {
  UIStatusResult,
  ScreenStatusResult,
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

class BridgeHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

class ScreenControlError extends Error {}

export function validateScreenDuration(durationSeconds: number): void {
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 600) {
    throw new Error('Screen duration must be an integer between 1 and 600 seconds.');
  }
}

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
        throw new BridgeHttpError(response.status, errMessage);
      }

      const result = await response.json() as T;
      if ((result as { code?: string })?.code === 'USER_UNLOCK_REQUIRED') {
        throw new ScreenControlError((result as { error?: string }).error || 'Unlock the phone before continuing.');
      }
      return result;
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

  async getScreenStatus(owner?: string): Promise<ScreenStatusResult> {
    if (owner) return this.request<ScreenStatusResult>('/api/screen', { method: 'POST', body: JSON.stringify({ action: 'status', owner }) });
    return this.request<ScreenStatusResult>('/api/screen');
  }

  async keepScreenAwake(durationSeconds = 120, owner?: string): Promise<ScreenStatusResult> {
    return this.changeScreenHold('acquire', durationSeconds, owner);
  }

  async renewScreenAwake(durationSeconds = 120, owner?: string): Promise<ScreenStatusResult> {
    return this.changeScreenHold('renew', durationSeconds, owner);
  }

  private async changeScreenHold(action: 'acquire' | 'renew', durationSeconds: number, owner?: string): Promise<ScreenStatusResult> {
    validateScreenDuration(durationSeconds);
    if (owner && action === 'acquire') await this.assertOwnedScreenProtocol(owner);
    const result = await this.request<ScreenStatusResult>('/api/screen', {
      method: 'POST', body: JSON.stringify({ action, durationSeconds, ...(owner ? { owner } : {}) }),
    });
    this.assertScreenHoldResponse(result, owner);
    return result;
  }

  private async assertOwnedScreenProtocol(owner: string): Promise<void> {
    const status = await this.getScreenStatus(owner);
    if (status.screenProtocol !== 2 || status.owner !== owner) {
      throw new ScreenControlError('OWNED_SCREEN_PROTOCOL_REQUIRED: Update the remote mobile-ui CLI and Android bridge before starting managed keep-awake.');
    }
  }

  private assertScreenHoldResponse(result: ScreenStatusResult, owner?: string): void {
    if (!result.ok || result.locked || result.interactive === false) {
      throw new ScreenControlError(`${result.code || 'SCREEN_CONTROL_FAILED'}: ${result.error || 'Unlock the phone before continuing mobile automation.'}`);
    }
    const invalid = result.interactive !== true || result.locked !== false || result.keepAwake !== true
      || (owner && (result.owner !== owner || !(typeof result.ownerRemainingMs === 'number' && result.ownerRemainingMs > 0)));
    if (invalid) throw new ScreenControlError('Bridge returned an invalid screen hold response.');
  }

  async releaseScreen(owner?: string): Promise<ScreenStatusResult> {
    const result = await this.request<ScreenStatusResult>('/api/screen', {
      method: 'POST', body: JSON.stringify({ action: 'release', ...(owner ? { owner } : {}) }),
    });
    if (!result.ok || (owner ? result.owner !== owner || result.ownerRemainingMs !== 0 : result.keepAwake !== false && result.ownerRemainingMs !== 0)) {
      throw new ScreenControlError(result.error || 'Failed to release screen hold.');
    }
    return result;
  }

  private async prepareScreen(): Promise<void> {
    try {
      const result = await this.getScreenStatus();
      if (!result.ok || result.interactive !== true || result.locked !== false) {
        throw new ScreenControlError(result.error || 'Unlock the phone before continuing mobile automation.');
      }
    }
    catch (error) {
      if (error instanceof BridgeHttpError && error.status === 404) {
        console.warn('[mobile-ui] Screen keep-awake is unavailable on this bridge; update the APK.');
        return;
      }
      throw error instanceof ScreenControlError ? error : new ScreenControlError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async getStatus(): Promise<UIStatusResult> {
    return this.request<UIStatusResult>('/api/status');
  }

  async dump(options?: { interactiveOnly?: boolean }): Promise<UIDumpResult> {
    await this.prepareScreen();
    const interactive = options?.interactiveOnly !== false;
    return this.request<UIDumpResult>(`/api/dump?interactiveOnly=${interactive}`);
  }

  async click(options: ClickOptions): Promise<ClickResult> {
    await this.prepareScreen();
    return this.request<ClickResult>('/api/click', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async input(options: InputOptions): Promise<InputResult> {
    await this.prepareScreen();
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
    await this.prepareScreen();
    return this.request<ScrollResult>('/api/scroll', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async action(options: ActionOptions): Promise<ActionResult> {
    await this.prepareScreen();
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
      } catch (error) {
        if (error instanceof ScreenControlError) throw error;
        // Retry transient UI dump failures until timeout
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
