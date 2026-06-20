import { existsSync, readFileSync } from 'node:fs';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { dirname } from 'node:path';
import * as TOML from '@iarna/toml';
import type {
  DesktopConnectConfig,
  RuntimeConfigState,
} from '@cc/superai-contracts';
import { migrateDesktopConnectConfig } from '../../runtime/config-migration.js';
import { parseJson } from './utils.js';

const RUNTIME_CONFIG_ID = 'desktop';

type RuntimeConfigRow = {
  config_json: string;
  base_dir: string;
  migrated_from_path: string | null;
  updated_at: string;
};

export class LocalRuntimeConfigStore {
  private readonly baseDir: string;
  private readonly selectStmt: StatementSync;
  private readonly insertStmt: StatementSync;
  private readonly updateStmt: StatementSync;

  constructor(
    private readonly db: DatabaseSync,
    private readonly databasePath: string,
    private readonly legacyConfigPaths: string[],
  ) {
    this.baseDir = dirname(databasePath);
    this.selectStmt = db.prepare(`
      SELECT config_json, base_dir, migrated_from_path, updated_at
      FROM runtime_config
      WHERE id = ?
    `);
    this.insertStmt = db.prepare(`
      INSERT INTO runtime_config (id, config_json, base_dir, migrated_from_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.updateStmt = db.prepare(`
      UPDATE runtime_config
      SET config_json = ?, base_dir = ?, migrated_from_path = ?, updated_at = ?
      WHERE id = ?
    `);
  }

  read(): RuntimeConfigState {
    const row = this.selectStmt.get(RUNTIME_CONFIG_ID) as RuntimeConfigRow | undefined;
    if (row) {
      const config = parseJson<DesktopConnectConfig>(row.config_json, {});
      const migrated = migrateDesktopConnectConfig(config);
      if (migrated.changed) {
        return this.writeRow(migrated.config, {
          migratedFromPath: row.migrated_from_path || undefined,
          warnings: migrated.warnings,
        });
      }
      return this.toState(row, config, migrated.warnings);
    }

    const legacy = this.readLegacyConfig();
    if (legacy) {
      if ('error' in legacy) {
        return this.errorState(legacy.path, legacy.error);
      }
      return this.writeRow(legacy.config, {
        migratedFromPath: legacy.path,
        warnings: legacy.warnings,
      });
    }

    return this.save({ projects: [] });
  }

  save(config: DesktopConnectConfig, options: {
    migratedFromPath?: string;
    warnings?: string[];
  } = {}): RuntimeConfigState {
    const migrated = migrateDesktopConnectConfig(config);
    return this.writeRow(migrated.config, {
      migratedFromPath: options.migratedFromPath,
      warnings: [
        ...(options.warnings || []),
        ...migrated.warnings,
      ],
    });
  }

  private writeRow(config: DesktopConnectConfig, options: {
    migratedFromPath?: string;
    warnings?: string[];
  } = {}): RuntimeConfigState {
    const row = this.selectStmt.get(RUNTIME_CONFIG_ID) as RuntimeConfigRow | undefined;
    const now = new Date().toISOString();
    const migratedFromPath = options.migratedFromPath ?? row?.migrated_from_path ?? null;
    const configJson = JSON.stringify(config);
    if (row) {
      this.updateStmt.run(configJson, this.baseDir, migratedFromPath, now, RUNTIME_CONFIG_ID);
    } else {
      this.insertStmt.run(RUNTIME_CONFIG_ID, configJson, this.baseDir, migratedFromPath, now, now);
    }
    return {
      storage: 'sqlite',
      databasePath: this.databasePath,
      baseDir: this.baseDir,
      config,
      ...(migratedFromPath ? { migratedFromPath } : {}),
      updatedAt: now,
      warnings: (options.warnings || []).filter(Boolean),
    };
  }

  private toState(row: RuntimeConfigRow, config: DesktopConnectConfig, warnings: string[]): RuntimeConfigState {
    return {
      storage: 'sqlite',
      databasePath: this.databasePath,
      baseDir: row.base_dir || this.baseDir,
      config,
      ...(row.migrated_from_path ? { migratedFromPath: row.migrated_from_path } : {}),
      updatedAt: row.updated_at,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  private errorState(path: string, error: string): RuntimeConfigState {
    const migrated = migrateDesktopConnectConfig({ projects: [] });
    return {
      storage: 'sqlite',
      databasePath: this.databasePath,
      baseDir: this.baseDir,
      config: migrated.config,
      migratedFromPath: path,
      error,
      warnings: [`Failed to import legacy runtime config "${path}": ${error}`],
    };
  }

  private readLegacyConfig(): { path: string; config: DesktopConnectConfig; warnings: string[] } | { path: string; error: string } | null {
    for (const legacyConfigPath of this.legacyConfigPaths) {
      if (!existsSync(legacyConfigPath)) {
        continue;
      }
      try {
        const raw = readFileSync(legacyConfigPath, 'utf8');
        const parsed = TOML.parse(raw) as DesktopConnectConfig;
        const migrated = migrateDesktopConnectConfig(parsed);
        return {
          path: legacyConfigPath,
          config: migrated.config,
          warnings: migrated.warnings,
        };
      } catch (error) {
        return {
          path: legacyConfigPath,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return null;
  }
}
