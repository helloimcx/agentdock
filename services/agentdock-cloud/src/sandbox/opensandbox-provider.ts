import type { SandboxProvider, SandboxRunEvent, SandboxRunRequest } from '../../../../packages/cloud-core/src/index.js';

interface OpenSandboxCreateResponse {
  sandboxID?: string;
  sandboxId?: string;
}

interface OpenSandboxDetailResponse {
  status?: string;
  sandbox?: {
    status?: string;
    endpoints?: Array<{
      port?: number;
      host?: string;
      protocol?: string;
      url?: string;
      headers?: Record<string, string>;
    }>;
  };
}

type OpenSandboxEndpoint = NonNullable<NonNullable<OpenSandboxDetailResponse['sandbox']>['endpoints']>[number];

export class OpenSandboxProvider implements SandboxProvider {
  private readonly sandboxByTaskId = new Map<string, string>();

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string,
  ) {}

  async run(request: SandboxRunRequest, onEvent: (event: SandboxRunEvent) => void | Promise<void>) {
    const sandboxId = await this.createSandbox(request);
    this.sandboxByTaskId.set(request.taskId, sandboxId);
    await onEvent({ type: 'sandbox_created', sandboxId });
    try {
      const endpoint = await this.waitForExecEndpoint(sandboxId);
      const code = await this.execCommand(endpoint, request, onEvent);
      await onEvent({ type: 'exit', code });
    } finally {
      await this.deleteSandbox(sandboxId).catch(() => undefined);
      this.sandboxByTaskId.delete(request.taskId);
    }
  }

  async cancel(taskId: string) {
    const sandboxId = this.sandboxByTaskId.get(taskId);
    if (!sandboxId) {
      return false;
    }
    await this.deleteSandbox(sandboxId);
    this.sandboxByTaskId.delete(taskId);
    return true;
  }

  private async createSandbox(request: SandboxRunRequest) {
    const response = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/v1/sandboxes`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        image: { uri: request.image },
        env: request.env,
        entrypoint: ['tail', '-f', '/dev/null'],
        metadata: {
          taskId: request.taskId,
          workspaceId: request.workspaceId,
          threadId: request.threadId,
          sessionId: request.sessionId,
        },
        volumes: request.mounts.map((mount, index) => ({
          name: `agentdock-volume-${index}`,
          host: { path: mount.hostPath },
          mountPath: mount.containerPath,
          readOnly: Boolean(mount.readonly),
        })),
      }),
    });
    if (!response.ok) {
      throw new Error(`SANDBOX_CREATE_FAILED ${response.status}: ${await response.text()}`);
    }
    const json = await response.json() as OpenSandboxCreateResponse;
    const sandboxId = json.sandboxID || json.sandboxId;
    if (!sandboxId) {
      throw new Error('SANDBOX_CREATE_FAILED: OpenSandbox response did not include sandboxID.');
    }
    return sandboxId;
  }

  private async waitForExecEndpoint(sandboxId: string) {
    const deadline = Date.now() + 30_000;
    let lastStatus = 'unknown';
    while (Date.now() < deadline) {
      const response = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/v1/sandboxes/${encodeURIComponent(sandboxId)}?use_server_proxy=true`, {
        headers: this.headers(false),
      });
      if (response.ok) {
        const detail = await response.json() as OpenSandboxDetailResponse;
        lastStatus = detail.sandbox?.status || detail.status || lastStatus;
        const endpoint = detail.sandbox?.endpoints?.find((item) => item.port === 44772) || detail.sandbox?.endpoints?.[0];
        if (endpoint?.url || endpoint?.host) {
          return endpoint;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`SANDBOX_CREATE_FAILED: no exec endpoint after status ${lastStatus}.`);
  }

  private async execCommand(
    endpoint: OpenSandboxEndpoint,
    request: SandboxRunRequest,
    onEvent: (event: SandboxRunEvent) => void | Promise<void>,
  ) {
    const url = endpoint.url || `${endpoint.protocol || 'http'}://${endpoint.host}`;
    const response = await fetch(`${url.replace(/\/+$/, '')}/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...endpoint.headers,
      },
      body: JSON.stringify({
        command: shellJoin(request.command),
        cwd: '/workspace',
        timeout: 3600,
      }),
    });
    if (!response.ok || !response.body) {
      throw new Error(`SANDBOX_EXEC_FAILED ${response.status}: ${await response.text()}`);
    }
    return this.readCommandStream(response.body, onEvent);
  }

  private async readCommandStream(body: ReadableStream<Uint8Array>, onEvent: (event: SandboxRunEvent) => void | Promise<void>) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let exitCode = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        const data = part.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice('data:'.length).trim()).join('\n');
        if (!data) {
          continue;
        }
        const result = await this.handleExecData(data, onEvent);
        if (typeof result === 'number') {
          exitCode = result;
        }
      }
    }
    if (buffer.trim()) {
      const result = await this.handleExecData(buffer.trim(), onEvent);
      if (typeof result === 'number') {
        exitCode = result;
      }
    }
    return exitCode;
  }

  private async handleExecData(data: string, onEvent: (event: SandboxRunEvent) => void | Promise<void>) {
    try {
      const parsed = JSON.parse(data) as Record<string, unknown>;
      const stdout = stringField(parsed, 'stdout') || stringField(parsed, 'output') || stringField(parsed, 'data');
      const stderr = stringField(parsed, 'stderr') || stringField(parsed, 'error');
      if (stdout) {
        await onEvent({ type: 'stdout', data: stdout.endsWith('\n') ? stdout : `${stdout}\n` });
      }
      if (stderr) {
        await onEvent({ type: 'stderr', data: stderr.endsWith('\n') ? stderr : `${stderr}\n` });
      }
      const code = numberField(parsed, 'exitCode') ?? numberField(parsed, 'code');
      return code;
    } catch {
      await onEvent({ type: 'stdout', data: data.endsWith('\n') ? data : `${data}\n` });
      return undefined;
    }
  }

  private async deleteSandbox(sandboxId: string) {
    await fetch(`${this.baseUrl.replace(/\/+$/, '')}/v1/sandboxes/${encodeURIComponent(sandboxId)}`, {
      method: 'DELETE',
      headers: this.headers(false),
    });
  }

  private headers(json = true) {
    return {
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(this.apiKey ? { 'OPEN-SANDBOX-API-KEY': this.apiKey } : {}),
    };
  }
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

function numberField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'number' ? value : undefined;
}

function shellJoin(command: string[]) {
  return command.map((part) => `'${part.replace(/'/g, `'\\''`)}'`).join(' ');
}
