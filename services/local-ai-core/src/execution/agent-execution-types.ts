import type { AgentLaunchConfig } from '@cc/plugin-sdk';
import type { DesktopProjectConfig, RuntimeConfigState } from '@cc/superai-contracts';

export interface AgentExecutionBackendInput {
  configState: RuntimeConfigState;
  project: DesktopProjectConfig;
  launchConfig: AgentLaunchConfig;
}

export interface AgentExecutionBackend {
  readonly mode: 'local' | 'sandbox' | 'mesh';
  prepareLaunch(input: AgentExecutionBackendInput): AgentLaunchConfig;
}
