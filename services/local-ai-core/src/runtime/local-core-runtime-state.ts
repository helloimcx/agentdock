import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as TOML from '@iarna/toml';
import type {
  ConfigFileState,
  DesktopConnectConfig,
  DesktopSettings,
  DesktopSettingsInput,
  KnowledgeConfig,
} from '../../../../packages/contracts/src/index.js';
import { AgentDockRotatingLogger, inferLogLevel, type AgentDockLogEntry, type AgentDockLogFile } from '../kernel/rotating-logger.js';
import { migrateDesktopConnectConfig } from './config-migration.js';

const DEFAULT_CONFIG = `# Managed by Local AI Core
# Add [[projects]] entries from the workspace page before starting a conversation.
`;

type RuntimeSettingsFile = {
  configPath: string;
  defaultProject: string;
  autoStartService: boolean;
  plugins: DesktopSettings['plugins'];
  knowledge: {
    baseUrl: string;
    authMode: 'none' | 'bearer' | 'header';
    token: string;
    headerName: string;
    defaultCollection: string;
  };
};

export interface LocalCoreRuntimeState {
  readonly userDataPath: string;
  readonly runtimeDir: string;
  readonly settingsPath: string;
  readonly cliBinDir: string;
  readonly logPath: string;
  getSettings(): DesktopSettings;
  saveSettings(input: DesktopSettingsInput): Promise<DesktopSettings>;
  getKnowledgeConfig(): KnowledgeConfig;
  updateKnowledgeConfig(input: Partial<KnowledgeConfig>): Promise<KnowledgeConfig>;
  getLogs(limit?: number): string[];
  getLogEntries(level?: string, limit?: number): AgentDockLogEntry[];
  pushLog(message: string): void;
  readConfigFile(): Promise<ConfigFileState>;
  saveRawConfigFile(raw: string): Promise<ConfigFileState>;
  saveStructuredConfigFile(config: DesktopConnectConfig): Promise<ConfigFileState>;
}

class FileBackedLocalCoreRuntimeState implements LocalCoreRuntimeState {
  readonly runtimeDir: string;
  readonly settingsPath: string;
  readonly cliBinDir: string;
  readonly logPath: string;
  private settings: DesktopSettings;
  private readonly logs: string[] = [];
  private readonly logger: AgentDockRotatingLogger;

  constructor(
    readonly userDataPath: string,
    private readonly onLog?: (message: string) => void,
  ) {
    this.runtimeDir = join(userDataPath, 'runtime');
    this.settingsPath = join(this.runtimeDir, 'local-core-settings.json');
    this.logger = new AgentDockRotatingLogger({ scope: 'local-ai-core' });
    this.logPath = this.logger.sysLogPath;
    mkdirSync(this.runtimeDir, { recursive: true });
    this.cliBinDir = this.ensureCliWrapper();
    this.settings = this.loadSettings();
    this.ensureConfigFile();
  }

  getSettings(): DesktopSettings {
    return this.settings;
  }

  async saveSettings(input: DesktopSettingsInput): Promise<DesktopSettings> {
    this.settings = {
      ...this.settings,
      ...(input.defaultProject !== undefined ? { defaultProject: input.defaultProject } : {}),
      ...(typeof input.autoStartService === 'boolean' ? { autoStartService: input.autoStartService } : {}),
      ...(input.configPath ? { configPath: input.configPath } : {}),
      plugins: input.plugins
        ? Object.fromEntries(
            Object.entries({
              ...this.settings.plugins,
              ...Object.fromEntries(
                Object.entries(input.plugins).map(([pluginId, value]) => [
                  pluginId,
                  {
                    ...this.settings.plugins[pluginId],
                    ...value,
                    config: {
                      ...(this.settings.plugins[pluginId]?.config || {}),
                      ...(value.config || {}),
                    },
                  },
                ]),
              ),
            }),
          )
        : this.settings.plugins,
      knowledge: input.knowledge
        ? {
            ...this.settings.knowledge,
            ...input.knowledge,
          }
        : this.settings.knowledge,
    };
    this.persistSettings();
    return this.settings;
  }

  getKnowledgeConfig(): KnowledgeConfig {
    return this.settings.knowledge;
  }

  async updateKnowledgeConfig(input: Partial<KnowledgeConfig>): Promise<KnowledgeConfig> {
    this.settings = {
      ...this.settings,
      knowledge: {
        ...this.settings.knowledge,
        ...input,
      },
    };
    this.persistSettings();
    return this.settings.knowledge;
  }

  getLogs(limit = 200): string[] {
    return this.logger.tailSysLog(limit);
  }

  getLogEntries(level = 'sys', limit = 200): AgentDockLogEntry[] {
    const normalizedLevel = normalizeLogFile(level);
    return this.logger.tail(normalizedLevel, limit)
      .map(parseLogEntry)
      .filter((entry): entry is AgentDockLogEntry => Boolean(entry));
  }

  pushLog(message: string) {
    if (!message) {
      return;
    }
    this.logs.push(message);
    this.logger.write(inferLogLevel(message), message);
    this.onLog?.(message);
    if (this.logs.length > 400) {
      this.logs.splice(0, this.logs.length - 400);
    }
  }

  async readConfigFile(): Promise<ConfigFileState> {
    const path = this.settings.configPath;
    if (!existsSync(path)) {
      return { path, exists: false, raw: '', parsed: null };
    }
    const raw = readFileSync(path, 'utf8');
    try {
      const parsed = TOML.parse(raw) as DesktopConnectConfig;
      const migrated = migrateDesktopConnectConfig(parsed);
      return {
        path,
        exists: true,
        raw,
        parsed: migrated.config,
        warnings: migrated.warnings.length > 0 ? migrated.warnings : undefined,
      };
    } catch (error) {
      return {
        path,
        exists: true,
        raw,
        parsed: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async saveRawConfigFile(raw: string): Promise<ConfigFileState> {
    mkdirSync(dirname(this.settings.configPath), { recursive: true });
    writeFileSync(this.settings.configPath, raw, 'utf8');
    return this.readConfigFile();
  }

  async saveStructuredConfigFile(config: DesktopConnectConfig): Promise<ConfigFileState> {
    const migrated = migrateDesktopConnectConfig(config);
    mkdirSync(dirname(this.settings.configPath), { recursive: true });
    writeFileSync(this.settings.configPath, TOML.stringify(migrated.config as any), 'utf8');
    return this.readConfigFile();
  }

  private loadSettings(): DesktopSettings {
    const defaults: RuntimeSettingsFile = {
      configPath: join(this.runtimeDir, 'config.toml'),
      defaultProject: '',
      autoStartService: true,
      plugins: {},
      knowledge: {
        baseUrl: '',
        authMode: 'none',
        token: '',
        headerName: 'X-API-Key',
        defaultCollection: 'personal_knowledge',
      },
    };
    if (!existsSync(this.settingsPath)) {
      return {
        binaryPath: '',
        configPath: defaults.configPath,
        autoStartService: defaults.autoStartService,
        defaultProject: defaults.defaultProject,
        managementPort: 0,
        managementToken: '',
        bridgePort: 0,
        bridgeToken: '',
        bridgePath: '',
        knowledge: defaults.knowledge,
        plugins: defaults.plugins,
      };
    }
    const raw = JSON.parse(readFileSync(this.settingsPath, 'utf8')) as Partial<RuntimeSettingsFile>;
    return {
      binaryPath: '',
      configPath: String(raw.configPath || defaults.configPath),
      autoStartService: typeof raw.autoStartService === 'boolean' ? raw.autoStartService : defaults.autoStartService,
      defaultProject: String(raw.defaultProject || defaults.defaultProject),
      managementPort: 0,
      managementToken: '',
      bridgePort: 0,
      bridgeToken: '',
      bridgePath: '',
      plugins: normalizePluginSettings(raw.plugins),
      knowledge: {
        ...defaults.knowledge,
        ...(raw.knowledge || {}),
      },
    };
  }

  private persistSettings() {
    const payload: RuntimeSettingsFile = {
      configPath: this.settings.configPath,
      defaultProject: this.settings.defaultProject,
      autoStartService: this.settings.autoStartService,
      plugins: this.settings.plugins,
      knowledge: this.settings.knowledge,
    };
    mkdirSync(dirname(this.settingsPath), { recursive: true });
    writeFileSync(this.settingsPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  private ensureConfigFile() {
    if (existsSync(this.settings.configPath)) {
      return;
    }
    mkdirSync(dirname(this.settings.configPath), { recursive: true });
    writeFileSync(this.settings.configPath, DEFAULT_CONFIG, 'utf8');
  }

  private ensureCliWrapper() {
    const binDir = join(this.runtimeDir, 'bin');
    mkdirSync(binDir, { recursive: true });
    const cliEntry = join(__dirname, '..', 'cli', 'lac.js');
    const wrapperPath = join(binDir, 'lac');
    const script = [
      '#!/bin/sh',
      'export ELECTRON_RUN_AS_NODE=1',
      `exec "${process.execPath.replace(/"/g, '\\"')}" "${cliEntry.replace(/"/g, '\\"')}" "$@"`,
      '',
    ].join('\n');
    writeFileSync(wrapperPath, script, 'utf8');
    chmodSync(wrapperPath, 0o755);
    return binDir;
  }
}

function normalizeLogFile(level: string): AgentDockLogFile {
  if (level === 'debug' || level === 'info' || level === 'warn' || level === 'error') {
    return level;
  }
  return 'sys';
}

function parseLogEntry(line: string): AgentDockLogEntry | null {
  try {
    const parsed = JSON.parse(line) as Partial<AgentDockLogEntry>;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const level = normalizeLogFile(String(parsed.level || 'info'));
    if (level === 'sys') {
      return null;
    }
    return {
      ts: String(parsed.ts || ''),
      level,
      scope: String(parsed.scope || ''),
      message: String(parsed.message || ''),
      ...(parsed.meta && typeof parsed.meta === 'object' ? { meta: parsed.meta as Record<string, unknown> } : {}),
    };
  } catch {
    return null;
  }
}

function normalizePluginSettings(input: unknown): DesktopSettings['plugins'] {
  if (!input || typeof input !== 'object') {
    return {};
  }
  const output: DesktopSettings['plugins'] = {};
  for (const [pluginId, value] of Object.entries(input as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    const record = value as Record<string, unknown>;
    output[pluginId] = {
      enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
      config: record.config && typeof record.config === 'object'
        ? record.config as Record<string, unknown>
        : {},
    };
  }
  return output;
}

export function createLocalCoreRuntimeState(options: {
  userDataPath: string;
  onLog?: (message: string) => void;
}): LocalCoreRuntimeState {
  return new FileBackedLocalCoreRuntimeState(options.userDataPath, options.onLog);
}
