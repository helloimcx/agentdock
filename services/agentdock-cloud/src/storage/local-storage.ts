import { mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { buildSessionOutputPath, buildTaskRuntimePath, buildWorkspacePath, ensureChildPath } from '../../../../packages/cloud-core/src/index.js';

export class LocalVolumeStorage {
  constructor(
    private readonly root: string,
    private readonly tenantId: string,
    private readonly userId: string,
  ) {}

  ensureWorkspace(workspaceId: string) {
    return this.ensure(buildWorkspacePath(this.root, this.tenantId, this.userId, workspaceId));
  }

  ensureTaskRuntime(taskId: string) {
    return this.ensure(buildTaskRuntimePath(this.root, taskId));
  }

  ensureSessionOutput(sessionId: string) {
    return this.ensure(buildSessionOutputPath(this.root, sessionId));
  }

  listFiles(root: string) {
    const guardedRoot = ensureChildPath(this.root, root);
    const files: Array<{ path: string; size: number; updatedAt: string }> = [];
    const walk = (current: string) => {
      for (const name of readdirSync(current, { withFileTypes: true })) {
        const absolute = path.join(current, name.name);
        ensureChildPath(guardedRoot, absolute);
        if (name.isDirectory()) {
          walk(absolute);
          continue;
        }
        const stat = statSync(absolute);
        files.push({ path: path.relative(guardedRoot, absolute), size: stat.size, updatedAt: stat.mtime.toISOString() });
      }
    };
    try {
      walk(guardedRoot);
    } catch {
      return files;
    }
    return files;
  }

  private ensure(directory: string) {
    mkdirSync(directory, { recursive: true });
    return directory;
  }
}
