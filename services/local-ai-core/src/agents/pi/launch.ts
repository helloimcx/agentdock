import {
  DESKTOP_PI_ACP_PACKAGE,
  DESKTOP_PI_CODING_AGENT_PACKAGE,
} from '@cc/superai-contracts';
import type { AgentLaunchResolverInput, AgentLaunchDefaults, AgentModelResolverInput } from '../shared/definition.js';
import {
  getFirstProviderModelId,
  resolveBundledAcpCommand,
  resolveBundledBinCommand,
} from '../shared/launch-utils.js';
import { materializePiProviderConfig } from './provider-materializer.js';

export function resolvePiModel(input: AgentModelResolverInput) {
  return input.rawModel || getFirstProviderModelId(input.providers);
}

export function buildPiLaunchConfig(input: AgentLaunchResolverInput): AgentLaunchDefaults {
  const bundledPiAcp = resolveBundledAcpCommand(DESKTOP_PI_ACP_PACKAGE, 'pi-acp');
  const bundledPiCommand = resolveBundledBinCommand(DESKTOP_PI_CODING_AGENT_PACKAGE, 'pi');
  return {
    command: bundledPiAcp.command,
    args: [...bundledPiAcp.args],
    env: {
      ...materializePiProviderConfig(input),
      PI_ACP_PI_COMMAND: bundledPiCommand,
    },
  };
}
