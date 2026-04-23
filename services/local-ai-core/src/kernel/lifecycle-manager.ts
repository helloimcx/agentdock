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
    for (const plugin of this.registry.listEnabled()) {
      try {
        await plugin.init?.(this.context);
      } catch (error) {
        this.context.logger.log(`[plugin:${plugin.manifest.id}] init failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.initialized = true;
  }

  async startAll() {
    if (this.started) {
      return;
    }
    await this.initAll();
    for (const plugin of this.registry.listEnabled()) {
      try {
        await plugin.start?.();
      } catch (error) {
        this.context.logger.log(`[plugin:${plugin.manifest.id}] start failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.started = true;
  }

  async stopAll() {
    if (!this.initialized) {
      return;
    }
    const plugins = this.registry.listEnabled().slice().reverse();
    for (const plugin of plugins) {
      try {
        await plugin.stop?.();
      } catch (error) {
        this.context.logger.log(`[plugin:${plugin.manifest.id}] stop failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.started = false;
  }

  async healthCheckAll(): Promise<Array<{ pluginId: string; health: PluginHealth }>> {
    const results: Array<{ pluginId: string; health: PluginHealth }> = [];
    for (const plugin of this.registry.list()) {
      if (!this.registry.isEnabled(plugin.manifest.id)) {
        results.push({
          pluginId: plugin.manifest.id,
          health: { status: 'degraded', summary: 'Plugin is disabled by runtime settings.' },
        });
        continue;
      }
      let health: PluginHealth;
      try {
        health = await plugin.healthCheck?.() || { status: 'healthy' };
      } catch (error) {
        health = {
          status: 'failed',
          summary: error instanceof Error ? error.message : String(error),
        };
      }
      results.push({
        pluginId: plugin.manifest.id,
        health,
      });
    }
    return results;
  }
}
