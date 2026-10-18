import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { dirname } from 'node:path';
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
  updated_at: string;
};

/**
 * Single source of truth for the desktop runtime configuration.
 *
 * The full `DesktopConnectConfig` (including projects and platform
 * credentials) lives in the `runtime_config` SQLite row as JSON. There is no
 * file-based config: no config.toml, no legacy import, no settings.json
 * configPath indirection.
 */
export class LocalRuntimeConfigStore {
  private readonly baseDir: string;
  private readonly selectStmt: StatementSync;
  private readonly insertStmt: StatementSync;
  private readonly updateStmt: StatementSync;

  constructor(
    private readonly db: DatabaseSync,
    private readonly databasePath: string,
  ) {
    this.baseDir = dirname(databasePath);
    this.selectStmt = db.prepare(`
      SELECT config_json, base_dir, updated_at
      FROM runtime_config
      WHERE id = ?
    `);
    this.insertStmt = db.prepare(`
      INSERT INTO runtime_config (id, config_json, base_dir, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    this.updateStmt = db.prepare(`
      UPDATE runtime_config
      SET config_json = ?, base_dir = ?, updated_at = ?
      WHERE id = ?
    `);
  }

  read(): RuntimeConfigState {
    const row = this.selectStmt.get(RUNTIME_CONFIG_ID) as RuntimeConfigRow | undefined;
    if (!row) {
      return this.save({ projects: [] });
    }
    const config = parseJson<DesktopConnectConfig>(row.config_json, {});
    const migrated = migrateDesktopConnectConfig(config);
    if (migrated.changed) {
      return this.writeRow(migrated.config, { warnings: migrated.warnings });
    }
    return this.toState(row, config, migrated.warnings);
  }

  save(config: DesktopConnectConfig, options: {
    warnings?: string[];
  } = {}): RuntimeConfigState {
    const migrated = migrateDesktopConnectConfig(config);
    return this.writeRow(migrated.config, {
      warnings: [
        ...(options.warnings || []),
        ...migrated.warnings,
      ],
    });
  }

  private writeRow(config: DesktopConnectConfig, options: {
    warnings?: string[];
  } = {}): RuntimeConfigState {
    const row = this.selectStmt.get(RUNTIME_CONFIG_ID) as RuntimeConfigRow | undefined;
    const now = new Date().toISOString();
    const configJson = JSON.stringify(config);
    if (row) {
      this.updateStmt.run(configJson, this.baseDir, now, RUNTIME_CONFIG_ID);
    } else {
      this.insertStmt.run(RUNTIME_CONFIG_ID, configJson, this.baseDir, now, now);
    }
    return {
      storage: 'sqlite',
      databasePath: this.databasePath,
      baseDir: this.baseDir,
      config,
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
      updatedAt: row.updated_at,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }
}
