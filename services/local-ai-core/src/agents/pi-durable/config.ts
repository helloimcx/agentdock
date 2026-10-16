import type { LocalCoreProjectConfig } from '../../router/workspace-router-types.js';
import type { DurableConfig } from './protocol.js';

export function toDurableConfig(config: LocalCoreProjectConfig, runtimeEnv?: Record<string, string>): DurableConfig {
  return {
    agentType: config.agentType, workspaceId: config.workspaceId, command: config.command, args: config.args,
    workDir: config.workDir, model: config.model, env: { ...config.env, ...runtimeEnv },
    sandbox: config.sandbox, mcpServers: config.mcpServers,
  };
}

export function sumDurableUsage(value: unknown) {
  const models = (value as { models?: Record<string, Record<string, number>> } | undefined)?.models || {};
  return Object.values(models).reduce((sum, usage) => {
    const inputTokens = Number(usage.input ?? usage.inputTokens ?? 0);
    const outputTokens = Number(usage.output ?? usage.outputTokens ?? 0);
    const cacheTokens = Number(usage.cacheRead ?? 0) + Number(usage.cacheWrite ?? 0) + Number(usage.cacheTokens ?? 0);
    const totalTokens = Number(usage.totalTokens ?? inputTokens + outputTokens + cacheTokens);
    return { inputTokens: sum.inputTokens + inputTokens, outputTokens: sum.outputTokens + outputTokens,
      cacheTokens: sum.cacheTokens + cacheTokens, totalTokens: sum.totalTokens + totalTokens };
  }, { inputTokens: 0, outputTokens: 0, cacheTokens: 0, totalTokens: 0 });
}
