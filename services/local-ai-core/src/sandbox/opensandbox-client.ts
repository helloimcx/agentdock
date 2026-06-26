import { LocalCoreError, formatSafeError } from '../kernel/local-core-errors.js';

export type OpenSandboxVolume = {
  host: string;
  container: string;
  mode?: 'ro' | 'rw' | string;
};

export type OpenSandboxCreateInput = {
  image: string;
  entrypoint: string[];
  env: Record<string, string>;
  metadata: Record<string, string>;
  volumes: OpenSandboxVolume[];
  ports: number[];
  timeoutSeconds: number;
  cpu: string;
  memory: string;
};

export type OpenSandboxRecord = {
  id: string;
  status?: string;
  state?: string;
  sandboxId?: string;
  [key: string]: unknown;
};

export type OpenSandboxEndpoint = {
  endpoint: string;
  [key: string]: unknown;
};

export class OpenSandboxClient {
  constructor(private readonly options: {
    serverUrl: string;
    apiKey?: string;
    fetchImpl?: typeof fetch;
  }) {}

  async health() {
    return this.request<Record<string, unknown>>('GET', '/health');
  }

  async createSandbox(input: OpenSandboxCreateInput): Promise<OpenSandboxRecord> {
    const response = await this.request<any>('POST', '/v1/sandboxes', {
      image: {
        uri: input.image,
      },
      entrypoint: input.entrypoint,
      env: input.env,
      metadata: input.metadata,
      volumes: input.volumes.map((volume, index) => ({
        name: `agentdock-${index + 1}`,
        host: {
          path: volume.host,
        },
        mountPath: volume.container,
        readOnly: volume.mode === 'ro',
      })),
      ports: input.ports,
      timeout: input.timeoutSeconds,
      timeoutSeconds: input.timeoutSeconds,
      resourceLimits: {
        cpu: input.cpu,
        memory: input.memory,
      },
    });
    const sandbox = response?.sandbox || response?.data || response;
    const id = String(sandbox?.id || sandbox?.sandboxId || '').trim();
    if (!id) {
      throw new LocalCoreError('sandbox_start_failed', 'OpenSandbox create response did not include a sandbox id.', {
        details: { response },
      });
    }
    return { ...sandbox, id };
  }

  async getSandbox(sandboxId: string): Promise<OpenSandboxRecord> {
    const response = await this.request<any>('GET', `/v1/sandboxes/${encodeURIComponent(sandboxId)}`);
    const sandbox = response?.sandbox || response?.data || response;
    return { ...sandbox, id: String(sandbox?.id || sandbox?.sandboxId || sandboxId) };
  }

  async getEndpoint(sandboxId: string, port: number): Promise<OpenSandboxEndpoint> {
    const response = await this.request<any>('GET', `/v1/sandboxes/${encodeURIComponent(sandboxId)}/endpoints/${port}`);
    const endpoint = String(response?.endpoint || response?.data?.endpoint || response?.url || response?.data?.url || '').trim();
    if (!endpoint) {
      throw new LocalCoreError('sandbox_endpoint_missing', `OpenSandbox did not return an endpoint for port ${port}.`, {
        details: { sandboxId, port, response },
      });
    }
    return { ...response, endpoint };
  }

  async deleteSandbox(sandboxId: string): Promise<void> {
    await this.request('DELETE', `/v1/sandboxes/${encodeURIComponent(sandboxId)}`);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const fetchImpl = this.options.fetchImpl || fetch;
    const headers: Record<string, string> = {
      accept: 'application/json',
    };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    if (this.options.apiKey) {
      headers['OPEN-SANDBOX-API-KEY'] = this.options.apiKey;
      headers.authorization = `Bearer ${this.options.apiKey}`;
    }
    let response: Response;
    try {
      response = await fetchImpl(`${this.options.serverUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      const message = formatSafeError(error);
      throw new LocalCoreError('sandbox_unavailable', `OpenSandbox request failed: ${message}`, {
        cause: message,
        details: { method, path, serverUrl: this.options.serverUrl },
      });
    }
    const text = await response.text();
    const json = text ? parseJson(text) : {};
    if (!response.ok) {
      throw new LocalCoreError(response.status === 401 || response.status === 403 ? 'sandbox_unauthorized' : 'sandbox_request_failed', `OpenSandbox ${method} ${path} failed with ${response.status}.`, {
        details: {
          method,
          path,
          status: response.status,
          response: json || text,
        },
      });
    }
    return (json || {}) as T;
  }
}

function parseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
