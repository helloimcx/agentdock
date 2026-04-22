import type { PluginContext, PluginHealth, RuntimePlugin } from '../../../../packages/plugin-sdk/src/index.js';
import { LocalCorePluginRegistry } from './plugin-registry.js';

export class LocalCoreLifecycleManager {
  private initialized = false;
  private started = false;

  constructor(
    private readonly registry: LocalCorePluginRegistry,
    private readonly context: PluginContext,
  ) {}

  async initAll() {
    if (this.initialized) {
      return;
    }
    for (const plugin of this.registry.list()) {
      await plugin.init?.(this.context);
    }
    this.initialized = true;
  }

  async startAll() {
    if (this.started) {
      return;
    }
    await this.initAll();
    for (const plugin of this.registry.list()) {
      await plugin.start?.();
    }
    this.started = true;
  }

  async stopAll() {
    if (!this.initialized) {
      return;
    }
    const plugins = this.registry.list().slice().reverse();
    for (const plugin of plugins) {
      await plugin.stop?.();
    }
    this.started = false;
  }

  async healthCheckAll(): Promise<Array<{ pluginId: string; health: PluginHealth }>> {
    const results: Array<{ pluginId: string; health: PluginHealth }> = [];
    for (const plugin of this.registry.list()) {
      results.push({
        pluginId: plugin.manifest.id,
        health: await plugin.healthCheck?.() || { status: 'healthy' },
      });
    }
    return results;
  }
}
