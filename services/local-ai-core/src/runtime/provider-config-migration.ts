import type { DesktopConnectConfig, DesktopProjectConfig, RuntimeConfigState } from '@cc/superai-contracts';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import { normalizeDesktopProviderForStorage } from './config-migration.js';

export interface ProviderConfigMigrationResult {
  config: DesktopConnectConfig;
  changed: boolean;
  warnings: string[];
}

export function migrateLegacyProjectProvidersToStore(
  input: DesktopConnectConfig,
  store: Pick<LocalCoreAcpStore, 'upsertModelProvider'>,
): ProviderConfigMigrationResult {
  const config = cloneConfig(input);
  const warnings: string[] = [];
  let changed = false;
  for (const project of Array.isArray(config.projects) ? config.projects : []) {
    const legacyProviders = Array.isArray(project.agent?.providers) ? project.agent.providers : [];
    if (legacyProviders.length === 0) {
      continue;
    }
    project.agent ||= { type: 'pi', options: {}, providers: [] };
    project.agent.options ||= {};
    const migratedProviderIds: string[] = [];
    for (const provider of legacyProviders) {
      const migrated = store.upsertModelProvider(normalizeDesktopProviderForStorage(provider));
      migratedProviderIds.push(migrated.id);
    }
    if (!project.agent.options.provider_id && migratedProviderIds[0]) {
      project.agent.options.provider_id = migratedProviderIds[0];
    }
    delete (project.agent as DesktopProjectConfig['agent']).providers;
    warnings.push(`Project "${project.name}" migrated embedded providers to shared providers.`);
    changed = true;
  }
  return { config, changed, warnings };
}

export async function applyLegacyProviderMigration<T extends RuntimeConfigState>(
  current: T,
  store: Pick<LocalCoreAcpStore, 'upsertModelProvider'>,
  save: (config: DesktopConnectConfig) => T | Promise<T>,
): Promise<T> {
  const migrated = migrateLegacyProjectProvidersToStore(current.config, store);
  if (!migrated.changed) {
    return current;
  }
  const saved = await save(migrated.config);
  return {
    ...saved,
    warnings: [
      ...(current.warnings || []),
      ...(saved.warnings || []),
      ...migrated.warnings,
    ],
  };
}

function cloneConfig(input: DesktopConnectConfig): DesktopConnectConfig {
  return JSON.parse(JSON.stringify(input || {}));
}
