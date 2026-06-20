import type { RuntimePlugin } from '@cc/plugin-sdk';

export class LocalCorePluginRegistry {
  private readonly plugins = new Map<string, RuntimePlugin>();
  private readonly disabledPluginIds = new Set<string>();
  private readonly registrationOrder = new Map<string, number>();
  private nextRegistrationOrder = 0;

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
    this.registrationOrder.set(plugin.manifest.id, this.nextRegistrationOrder++);
  }

  get(pluginId: string) {
    return this.plugins.get(pluginId) || null;
  }

  list() {
    const sorted: RuntimePlugin[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (plugin: RuntimePlugin) => {
      const pluginId = plugin.manifest.id;
      if (visited.has(pluginId)) {
        return;
      }
      if (visiting.has(pluginId)) {
        throw new Error(`Plugin dependency cycle detected at: ${pluginId}`);
      }
      visiting.add(pluginId);
      for (const dependencyId of plugin.manifest.dependsOn || []) {
        const dependency = this.plugins.get(dependencyId);
        if (!dependency) {
          throw new Error(`Plugin dependency missing: ${pluginId} depends on ${dependencyId}`);
        }
        visit(dependency);
      }
      visiting.delete(pluginId);
      visited.add(pluginId);
      sorted.push(plugin);
    };

    for (const plugin of [...this.plugins.values()].sort((a, b) =>
      (this.registrationOrder.get(a.manifest.id) ?? 0) - (this.registrationOrder.get(b.manifest.id) ?? 0)
    )) {
      visit(plugin);
    }
    return sorted;
  }

  isEnabled(pluginId: string) {
    return !this.disabledPluginIds.has(pluginId);
  }

  listEnabled() {
    return this.list().filter((plugin) => this.isEnabled(plugin.manifest.id));
  }
}
