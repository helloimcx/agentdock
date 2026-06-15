import type { AgentLaunchConfig } from '../../../../packages/plugin-sdk/src/index.js';
import type { DesktopProjectConfig, RuntimeConfigState } from '../../../../packages/contracts/src/index.js';
import {
  isProjectSandboxEnabled,
  normalizeSandboxLaunchConfig,
  sandboxProxyLaunchEnv,
  sandboxProxyScriptPath,
} from '../sandbox/sandbox-config.js';

export interface AgentExecutionBackendInput {
  configState: RuntimeConfigState;
  project: DesktopProjectConfig;
  launchConfig: AgentLaunchConfig;
}

export interface AgentExecutionBackend {
  readonly mode: 'local' | 'sandbox';
  prepareLaunch(input: AgentExecutionBackendInput): AgentLaunchConfig;
}

export class LocalAgentExecutionBackend implements AgentExecutionBackend {
  readonly mode = 'local' as const;

  prepareLaunch(input: AgentExecutionBackendInput): AgentLaunchConfig {
    return {
      ...input.launchConfig,
      execution: {
        mode: 'local',
        transport: 'stdio',
      },
    };
  }
}

export class OpenSandboxExecutionBackend implements AgentExecutionBackend {
  readonly mode = 'sandbox' as const;

  prepareLaunch(input: AgentExecutionBackendInput): AgentLaunchConfig {
    const sandbox = normalizeSandboxLaunchConfig(input);
    if (!sandbox) {
      return new LocalAgentExecutionBackend().prepareLaunch(input);
    }
    return {
      ...input.launchConfig,
      command: process.execPath,
      args: [sandboxProxyScriptPath()],
      env: {
        ...sandboxProxyLaunchEnv(sandbox),
        AGENTDOCK_SANDBOX_AGENT_TYPE: input.launchConfig.agentType,
      },
      execution: {
        mode: 'sandbox',
        transport: `sandbox-${sandbox.transport}-stdio-proxy`,
        provider: sandbox.provider,
        sandbox: {
          image: sandbox.image,
          transport: sandbox.transport,
          acpPort: sandbox.acpPort,
          stateScope: sandbox.stateScope,
          stateMountPath: sandbox.stateMountPath,
        },
      },
      sandbox,
    };
  }
}

export function prepareAgentExecutionLaunch(input: AgentExecutionBackendInput): AgentLaunchConfig {
  const backend = isProjectSandboxEnabled(input.project)
    ? new OpenSandboxExecutionBackend()
    : new LocalAgentExecutionBackend();
  return backend.prepareLaunch(input);
}
