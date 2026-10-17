import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_LOG_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_LOG_MAX_FILES = 5;
const LOG_TAIL_CHUNK_BYTES = 64 * 1024;
const LOG_MAX_RETURN_LINES = 5000;

export type AgentDockLogLevel = 'debug' | 'info' | 'warn' | 'error';
export type AgentDockLogFile = AgentDockLogLevel | 'sys';

export type AgentDockLogEntry = {
  ts: string;
  level: AgentDockLogLevel;
  scope: string;
  message: string;
  meta?: Record<string, unknown>;
};

export type RotatingLoggerOptions = {
  logDir?: string;
  maxBytes?: number;
  maxFiles?: number;
  scope?: string;
};

const LEVEL_FILE_NAMES: Record<AgentDockLogFile, string> = {
  sys: 'sys.log',
  debug: 'debug.log',
  info: 'info.log',
  warn: 'warn.log',
  error: 'error.log',
};

export class AgentDockRotatingLogger {
  readonly logDir: string;
  readonly sysLogPath: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private readonly scope: string;

  constructor(options: RotatingLoggerOptions = {}) {
    this.logDir = options.logDir || resolveAgentDockLogDir();
    this.sysLogPath = join(this.logDir, LEVEL_FILE_NAMES.sys);
    this.maxBytes = normalizePositiveInteger(options.maxBytes, resolveLogMaxBytes());
    this.maxFiles = normalizePositiveInteger(options.maxFiles, resolveLogMaxFiles());
    this.scope = options.scope || 'local-ai-core';
    mkdirSync(this.logDir, { recursive: true });
    this.ensureLogFiles();
  }

  write(level: AgentDockLogLevel, message: string, meta?: Record<string, unknown>) {
    if (!message) {
      return;
    }
    const entry: AgentDockLogEntry = {
      ts: formatLocalLogTimestamp(new Date()),
      level,
      scope: this.scope,
      message: sanitizeLogMessage(message),
      ...(meta && Object.keys(meta).length > 0 ? { meta } : {}),
    };
    const line = `${JSON.stringify(entry)}\n`;
    this.append('sys', line);
    this.append(level, line);
  }

  tailSysLog(limit = 200) {
    return this.tail('sys', limit);
  }

  tail(level: AgentDockLogFile, limit = 200) {
    return tailRotatedLogFiles(this.pathFor(level), limit, this.maxFiles);
  }

  pathFor(level: AgentDockLogFile) {
    return join(this.logDir, LEVEL_FILE_NAMES[level]);
  }

  private ensureLogFiles() {
    for (const level of Object.keys(LEVEL_FILE_NAMES) as AgentDockLogFile[]) {
      try {
        closeSync(openSync(this.pathFor(level), 'a'));
      } catch {
        // File logging must never break Local AI Core runtime behavior.
      }
    }
  }

  private append(level: AgentDockLogLevel | 'sys', line: string) {
    try {
      const path = this.pathFor(level);
      this.rotateIfNeeded(path, Buffer.byteLength(line, 'utf8'));
      appendFileSync(path, line, 'utf8');
    } catch {
      // File logging must never break Local AI Core runtime behavior.
    }
  }

  private rotateIfNeeded(path: string, incomingBytes: number) {
    if (!existsSync(path)) {
      return;
    }
    let size = 0;
    try {
      size = statSync(path).size;
    } catch {
      return;
    }
    if (size + incomingBytes <= this.maxBytes) {
      return;
    }
    for (let index = this.maxFiles; index >= 1; index -= 1) {
      const current = `${path}.${index}`;
      const next = `${path}.${index + 1}`;
      if (!existsSync(current)) {
        continue;
      }
      try {
        if (index >= this.maxFiles) {
          unlinkSync(current);
        } else {
          renameSync(current, next);
        }
      } catch {
        // Rotation is best-effort; the append path still attempts to continue.
      }
    }
    try {
      renameSync(path, `${path}.1`);
    } catch {
      // Rotation is best-effort; the append path still attempts to continue.
    }
  }
}

export function resolveAgentDockLogDir() {
  const override = process.env.AGENTDOCK_LOG_DIR?.trim();
  if (override) {
    return override;
  }
  return join(homedir(), '.agentdock', 'logs');
}

export function inferLogLevel(message: string): AgentDockLogLevel {
  const normalized = message.toLowerCase();
  if (/\b(debug|trace)\b/.test(normalized)) {
    return 'debug';
  }
  if (/\b(warn|warning)\b/.test(normalized)) {
    return 'warn';
  }
  if (/\b(error|failed|failure|fatal|exception)\b/.test(normalized)) {
    return 'error';
  }
  return 'info';
}

export function normalizeLogLimit(limit: number) {
  if (!Number.isFinite(limit)) {
    return 200;
  }
  return Math.min(Math.max(Math.floor(limit), 1), LOG_MAX_RETURN_LINES);
}

function resolveLogMaxBytes() {
  return normalizePositiveInteger(Number(process.env.AGENTDOCK_LOG_MAX_BYTES), DEFAULT_LOG_MAX_BYTES);
}

function resolveLogMaxFiles() {
  return normalizePositiveInteger(Number(process.env.AGENTDOCK_LOG_MAX_FILES), DEFAULT_LOG_MAX_FILES);
}

function normalizePositiveInteger(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function sanitizeLogMessage(message: string) {
  return String(message).replace(/\r?\n/g, '\\n');
}

export function formatLocalLogTimestamp(date: Date) {
  return [
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
    ' ',
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}.${pad3(date.getMilliseconds())}`,
  ].join('');
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function pad3(value: number) {
  return String(value).padStart(3, '0');
}

function tailRotatedLogFiles(path: string, limit: number, maxFiles: number): string[] {
  const normalizedLimit = normalizeLogLimit(limit);
  const files = Array.from({ length: maxFiles }, (_, index) => `${path}.${maxFiles - index}`)
    .concat(path);
  const lines: string[] = [];
  for (const file of files) {
    lines.push(...tailLogFile(file, normalizedLimit));
  }
  return lines.slice(-normalizedLimit);
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
