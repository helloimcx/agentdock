import { appendFileSync, chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as TOML from '@iarna/toml';
import type {
  ConfigFileState,
  DesktopConnectConfig,
  DesktopSettings,
  DesktopSettingsInput,
  KnowledgeConfig,
} from '../../../../packages/contracts/src/index.js';

const DEFAULT_CONFIG = `# Managed by Local AI Core
# Add [[projects]] entries from the workspace page before starting a conversation.
`;
const LOG_FILE_NAME = 'local-core.log';
const LOG_FILE_MAX_BYTES = 2 * 1024 * 1024;
const LOG_TAIL_CHUNK_BYTES = 64 * 1024;
const LOG_MAX_RETURN_LINES = 5000;

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

  constructor(
    readonly userDataPath: string,
    private readonly onLog?: (message: string) => void,
  ) {
    this.runtimeDir = join(userDataPath, 'runtime');
    this.settingsPath = join(this.runtimeDir, 'local-core-settings.json');
    this.logPath = join(this.runtimeDir, LOG_FILE_NAME);
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
    const normalizedLimit = normalizeLogLimit(limit);
    const current = tailLogFile(this.logPath, normalizedLimit);
    if (current.length >= normalizedLimit) {
      return current.slice(-normalizedLimit);
    }
    const rotated = tailLogFile(`${this.logPath}.1`, normalizedLimit - current.length);
    return [...rotated, ...current].slice(-normalizedLimit);
  }

  pushLog(message: string) {
    if (!message) {
      return;
    }
    this.logs.push(message);
    this.appendLogFile(message);
    this.onLog?.(message);
    if (this.logs.length > 400) {
      this.logs.splice(0, this.logs.length - 400);
    }
  }

  private appendLogFile(message: string) {
    try {
      if (existsSync(this.logPath) && statSync(this.logPath).size > LOG_FILE_MAX_BYTES) {
        const rotatedPath = `${this.logPath}.1`;
        try {
          renameSync(this.logPath, rotatedPath);
        } catch {
          // Keep runtime logging best-effort; stdout/UI logs still work.
        }
      }
      const line = `${new Date().toISOString()} ${message.replace(/\r?\n/g, '\\n')}\n`;
      appendFileSync(this.logPath, line, 'utf-8');
    } catch {
      // File logging must never break Local AI Core runtime behavior.
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
      return { path, exists: true, raw, parsed };
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
    mkdirSync(dirname(this.settings.configPath), { recursive: true });
    writeFileSync(this.settings.configPath, TOML.stringify(config as any), 'utf8');
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

function normalizeLogLimit(limit: number) {
  if (!Number.isFinite(limit)) {
    return 200;
  }
  return Math.min(Math.max(Math.floor(limit), 1), LOG_MAX_RETURN_LINES);
}

function tailLogFile(path: string, limit: number): string[] {
  if (limit <= 0 || !existsSync(path)) {
    return [];
  }
  let fd = -1;
  try {
    const size = statSync(path).size;
    if (size <= 0) {
      return [];
    }
    fd = openSync(path, 'r');
    const chunks: Buffer[] = [];
    let position = size;
    let newlineCount = 0;
    while (position > 0 && newlineCount <= limit) {
      const bytesToRead = Math.min(LOG_TAIL_CHUNK_BYTES, position);
      position -= bytesToRead;
      const chunk = Buffer.allocUnsafe(bytesToRead);
      const bytesRead = readSync(fd, chunk, 0, bytesToRead, position);
      const slice = bytesRead === bytesToRead ? chunk : chunk.subarray(0, bytesRead);
      chunks.unshift(slice);
      for (let index = 0; index < slice.length; index += 1) {
        if (slice[index] === 10) {
          newlineCount += 1;
        }
      }
    }
    return Buffer.concat(chunks)
      .toString('utf8')
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .slice(-limit);
  } catch {
    return [];
  } finally {
    if (fd >= 0) {
      try {
        closeSync(fd);
      } catch {
        // Log reads are best-effort; failed closes cannot be surfaced to callers.
      }
    }
  }
}

export function createLocalCoreRuntimeState(options: {
  userDataPath: string;
  onLog?: (message: string) => void;
}): LocalCoreRuntimeState {
  return new FileBackedLocalCoreRuntimeState(options.userDataPath, options.onLog);
}
