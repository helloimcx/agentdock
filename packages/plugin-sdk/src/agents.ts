import type { PluginContext, PluginManifest, RuntimePlugin } from './runtime-types.js';

export interface AgentCapability {
  id: string;
  agentType: string;
  displayName?: string;
}

export interface AgentLaunchConfig {
  workspaceId: string;
  agentType: string;
  workDir: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  model: string;
  execution?: AgentExecutionDescriptor;
  sandbox?: AgentSandboxLaunchConfig;
  mcpServers?: AgentMcpServerConfig[];
}

export type AgentMcpTransportType = 'stdio' | 'sse' | 'http';

export interface AgentMcpServerConfig {
  name: string;
  type: AgentMcpTransportType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export type AgentExecutionMode = 'local' | 'sandbox';

export interface AgentExecutionDescriptor {
  mode: AgentExecutionMode;
  transport: string;
  provider?: string;
  sandbox?: {
    image: string;
    transport?: AgentSandboxTransport;
    acpPort: number;
    stateScope: AgentSandboxStateScope;
    stateMountPath: string;
  };
}

export type AgentSandboxStateScope = 'user' | 'project' | 'thread' | 'run';
export type AgentSandboxTransport = 'http-ndjson';
export type AgentSandboxLifecycle = 'per_run' | 'per_thread';

export interface AgentStateMount {
  userId: string;
  projectId: string;
  agentType: string;
  scope: AgentSandboxStateScope;
  hostPath?: string;
  containerPath: string;
}

export interface AgentSandboxLaunchConfig {
  enabled: boolean;
  provider: string;
  transport: AgentSandboxTransport;
  serverUrl: string;
  apiKeyEnv: string;
  image: string;
  acpPort: number;
  entrypoint: string[];
  timeoutSeconds: number;
  lifecycle: AgentSandboxLifecycle;
  idleSeconds: number;
  warmPoolSize: number;
  cpu: string;
  memory: string;
  userId: string;
  projectId: string;
  stateScope: AgentSandboxStateScope;
  workspaceHostPath: string;
  workspaceMountPath: string;
  proxyCwd?: string;
  stateHostPath?: string;
  stateMountPath: string;
  stateMount?: AgentStateMount;
  runtimeCommand: string;
  runtimeArgs: string[];
  runtimeEnv: Record<string, string>;
}

export interface AgentRuntimeRoute {
  kind: string;
  agentType: string;
  transport: string;
  config: AgentLaunchConfig;
  supportsStreamingProbe?: boolean;
}

export interface AgentRuntime {
  readonly agentType: string;
  readonly transport: string;
  readonly displayName?: string;
  matchesProject(project: import('@cc/superai-contracts').DesktopProjectConfig): boolean;
  createRoute(
    configState: import('@cc/superai-contracts').RuntimeConfigState,
    project: import('@cc/superai-contracts').DesktopProjectConfig,
  ): AgentRuntimeRoute | null;
}

export interface AgentRuntimeRegistration {
  runtime: AgentRuntime;
}

export interface AgentPlugin extends RuntimePlugin {
  manifest: PluginManifest & { kind: 'agent' | 'composite' };
  createRuntime?(ctx: PluginContext): Promise<AgentRuntimeRegistration> | AgentRuntimeRegistration;
}
