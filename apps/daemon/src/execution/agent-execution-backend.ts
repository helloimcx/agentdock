import type { AgentLaunchConfig } from '@cc/plugin-sdk';
import type { DesktopProjectConfig, RuntimeConfigState } from '@cc/superai-contracts';
import {
  isProjectSandboxEnabled,
  normalizeSandboxLaunchConfig,
  sandboxProxyLaunchEnv,
  sandboxProxyScriptPath,
} from '../sandbox/sandbox-config.js';
import { isRemoteMeshProject, RemoteMeshExecutionBackend } from './remote-mesh/remote-mesh-backend.js';
import type { AgentExecutionBackend, AgentExecutionBackendInput } from './agent-execution-types.js';

export type { AgentExecutionBackend, AgentExecutionBackendInput } from './agent-execution-types.js';

class LocalAgentExecutionBackend implements AgentExecutionBackend {
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

class OpenSandboxExecutionBackend implements AgentExecutionBackend {
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
  if (isProjectSandboxEnabled(input.project)) {
    return new OpenSandboxExecutionBackend().prepareLaunch(input);
  }
  if (isRemoteMeshProject(input.project)) {
    return new RemoteMeshExecutionBackend().prepareLaunch(input);
  }
  return new LocalAgentExecutionBackend().prepareLaunch(input);
}
