import { resolveExecutableCommand } from '../runtime/env-utils.js';

export interface ToolCheckResult {
  name: string;
  available: boolean;
  path?: string;
}

export interface ToolBatchResult {
  available: string[];
  missing: string[];
  details: Record<string, ToolCheckResult>;
}

export interface ToolIndexOptions {
  env?: NodeJS.ProcessEnv;
  resolver?: (toolName: string, env: NodeJS.ProcessEnv) => string | null;
}

export class ToolIndex {
  private readonly env: NodeJS.ProcessEnv;
  private readonly resolver: (toolName: string, env: NodeJS.ProcessEnv) => string | null;
  private readonly cache = new Map<string, ToolCheckResult>();

  constructor(options: ToolIndexOptions = {}) {
    this.env = options.env || process.env;
    this.resolver = options.resolver || resolveExecutableCommand;
  }

  checkTool(toolName: string): ToolCheckResult {
    const normalized = toolName.trim();
    if (!normalized) {
      return { name: toolName, available: false };
    }
    const cached = this.cache.get(normalized);
    if (cached) {
      return cached;
    }
    const resolvedPath = this.resolver(normalized, this.env);
    const result: ToolCheckResult = resolvedPath
      ? { name: normalized, available: true, path: resolvedPath }
      : { name: normalized, available: false };
    this.cache.set(normalized, result);
    return result;
  }

  checkTools(toolNames: string[]): ToolBatchResult {
    const available: string[] = [];
    const missing: string[] = [];
    const details: Record<string, ToolCheckResult> = {};

    for (const name of toolNames) {
      const res = this.checkTool(name);
      details[name] = res;
      if (res.available) {
        available.push(name);
      } else {
        missing.push(name);
      }
    }

    return { available, missing, details };
  }

  clearCache() {
    this.cache.clear();
  }
}
