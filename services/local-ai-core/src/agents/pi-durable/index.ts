import { createBuiltinAgentPlugin } from '../shared/agent-plugin.js';
import type { AgentRuntimeDefinition } from '../shared/definition.js';
import { piAcpBehavior } from '../pi/behavior.js';
import { buildPiLaunchConfig, resolvePiModel } from '../pi/launch.js';

export const piDurableAgentDefinition: AgentRuntimeDefinition = {
  agentType: 'pi-durable',
  displayName: 'Pi Durable (experimental)',
  behavior: piAcpBehavior,
  resolveModel: resolvePiModel,
  buildLaunchConfig: buildPiLaunchConfig,
};

export function createBuiltinPiDurableAgentPlugin() {
  return createBuiltinAgentPlugin({
    definition: piDurableAgentDefinition,
    match: (agentType) => agentType === 'pi-durable',
  });
}
