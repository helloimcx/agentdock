import type { LocalCorePluginDiagnostics } from '../../../../packages/contracts/src/index.js';
import { LocalCoreLifecycleManager } from './lifecycle-manager.js';
import { LocalCorePluginRegistry } from './plugin-registry.js';

export class LocalCoreDiagnostics {
  constructor(
    private readonly registry: LocalCorePluginRegistry,
    private readonly lifecycle: LocalCoreLifecycleManager,
  ) {}

  async snapshot(): Promise<LocalCorePluginDiagnostics> {
    const plugins = this.registry.list();
    const health = await this.lifecycle.healthCheckAll();
    const healthByPlugin = new Map(health.map((entry) => [entry.pluginId, entry.health]));
    return {
      pluginCount: plugins.length,
      enabledPluginCount: plugins.filter((plugin) => this.registry.isEnabled(plugin.manifest.id)).length,
      plugins: plugins.map((plugin) => ({
        pluginId: plugin.manifest.id,
        enabled: this.registry.isEnabled(plugin.manifest.id),
        manifest: plugin.manifest,
        health: healthByPlugin.get(plugin.manifest.id) || { status: 'healthy' },
      })),
    };
  }
}
