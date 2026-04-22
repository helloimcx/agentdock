import type { RuntimePlugin } from '../../../../packages/plugin-sdk/src/index.js';

export class LocalCorePluginRegistry {
  private readonly plugins = new Map<string, RuntimePlugin>();

  register(plugin: RuntimePlugin) {
    if (this.plugins.has(plugin.manifest.id)) {
      throw new Error(`Plugin already registered: ${plugin.manifest.id}`);
    }
    this.plugins.set(plugin.manifest.id, plugin);
  }

  get(pluginId: string) {
    return this.plugins.get(pluginId) || null;
  }

  list() {
    return [...this.plugins.values()];
  }
}
