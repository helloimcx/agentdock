import type { RuntimePlugin } from '../../../../packages/plugin-sdk/src/index.js';

export class LocalCorePluginRegistry {
  private readonly plugins = new Map<string, RuntimePlugin>();
  private readonly disabledPluginIds = new Set<string>();

  constructor(disabledPluginIds: string[] = []) {
    for (const pluginId of disabledPluginIds) {
      this.disabledPluginIds.add(pluginId);
    }
  }

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

  isEnabled(pluginId: string) {
    return !this.disabledPluginIds.has(pluginId);
  }

  listEnabled() {
    return this.list().filter((plugin) => this.isEnabled(plugin.manifest.id));
  }
}
