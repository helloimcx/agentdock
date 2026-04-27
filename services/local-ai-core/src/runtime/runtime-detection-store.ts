import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { InstalledAgentRuntime } from '../../../../packages/contracts/src/index.js';

interface RuntimeDetectionStoreFile {
  version: 1;
  updatedAt: string;
  runtimes: InstalledAgentRuntime[];
}

export class RuntimeDetectionStore {
  readonly path: string;

  constructor(userDataPath: string) {
    this.path = join(userDataPath, 'runtime', 'runtime-detection.json');
  }

  read(): InstalledAgentRuntime[] | null {
    if (!existsSync(this.path)) {
      return null;
    }
    try {
      const payload = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<RuntimeDetectionStoreFile>;
      if (!Array.isArray(payload.runtimes)) {
        return null;
      }
      return payload.runtimes.filter(isRuntimeDetectionResult);
    } catch {
      return null;
    }
  }

  write(runtimes: InstalledAgentRuntime[]) {
    const payload: RuntimeDetectionStoreFile = {
      version: 1,
      updatedAt: new Date().toISOString(),
      runtimes,
    };
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }
}

function isRuntimeDetectionResult(value: unknown): value is InstalledAgentRuntime {
  const runtime = value as Partial<InstalledAgentRuntime>;
  return typeof runtime?.agentType === 'string'
    && typeof runtime.runtimeId === 'string'
    && typeof runtime.displayName === 'string'
    && typeof runtime.status === 'string'
    && typeof runtime.detectedAt === 'string'
    && Array.isArray(runtime.issues)
    && Array.isArray(runtime.recommendedActions);
}
