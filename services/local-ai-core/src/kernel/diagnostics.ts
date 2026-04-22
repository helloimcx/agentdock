import { LocalCoreLifecycleManager } from './lifecycle-manager.js';
import { LocalCorePluginRegistry } from './plugin-registry.js';

export class LocalCoreDiagnostics {
  constructor(
    private readonly registry: LocalCorePluginRegistry,
    private readonly lifecycle: LocalCoreLifecycleManager,
  ) {}

  async snapshot() {
    const plugins = this.registry.list();
    const health = await this.lifecycle.healthCheckAll();
    return {
      pluginCount: plugins.length,
      plugins: plugins.map((plugin) => plugin.manifest),
      health,
    };
  }
}
