import type { LocalCoreCapabilities } from '../../../../packages/contracts/src/index.js';
import type { PluginContext } from '../../../../packages/plugin-sdk/src/index.js';
import { LocalCoreCapabilityRegistry } from './capability-registry.js';
import { LocalCoreDiagnostics } from './diagnostics.js';
import { LocalCoreEventBus } from './event-bus.js';
import { LocalCoreLifecycleManager } from './lifecycle-manager.js';
import { LocalCorePluginRegistry } from './plugin-registry.js';
import { runtimeCapabilitiesPlugin } from '../plugins/builtin/runtime-capabilities-plugin.js';

export interface LocalCoreKernel {
  context: PluginContext;
  plugins: LocalCorePluginRegistry;
  capabilities: LocalCoreCapabilityRegistry;
  lifecycle: LocalCoreLifecycleManager;
  diagnostics: LocalCoreDiagnostics;
  getCapabilitySnapshot(): LocalCoreCapabilities;
}

export function bootstrapLocalCoreKernel(options?: {
  log?: (message: string) => void;
}): LocalCoreKernel {
  const capabilities = new LocalCoreCapabilityRegistry();
  const plugins = new LocalCorePluginRegistry();
  const context: PluginContext = {
    bus: new LocalCoreEventBus(),
    capabilities,
    logger: {
      log(message: string) {
        options?.log?.(message);
      },
    },
  };
  const lifecycle = new LocalCoreLifecycleManager(plugins, context);
  const diagnostics = new LocalCoreDiagnostics(plugins, lifecycle);

  const builtIns = [runtimeCapabilitiesPlugin];
  for (const plugin of builtIns) {
    plugins.register(plugin);
    if (plugin.capabilities) {
      capabilities.registerContributions(plugin.capabilities);
    }
  }

  return {
    context,
    plugins,
    capabilities,
    lifecycle,
    diagnostics,
    getCapabilitySnapshot() {
      const snapshot = capabilities.snapshot();
      return {
        adapters: {
          channels: snapshot.channels.map((capability) => capability.platform),
          agents: snapshot.agents.map((capability) => capability.agentType),
          knowledge: snapshot.knowledge.some((capability) => capability.enabled !== false),
        },
        scheduler: {
          enabled: snapshot.schedulers.some((capability) => capability.enabled !== false),
          triggerTypes: [...new Set(snapshot.schedulers.flatMap((capability) => capability.triggerTypes))] as Array<'cron' | 'once'>,
          platforms: [...new Set(snapshot.schedulers.flatMap((capability) => capability.deliveryPlatforms))],
        },
      };
    },
  };
}
