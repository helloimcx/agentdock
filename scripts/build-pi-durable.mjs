import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const tscPath = existsSync('apps/daemon/src/agents/pi-durable/tsconfig.worker.json')
  ? 'apps/daemon/src/agents/pi-durable/tsconfig.worker.json'
  : 'services/local-ai-core/src/agents/pi-durable/tsconfig.worker.json';

execFileSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['--config.verify-deps-before-run=false', 'exec', 'tsc', '-p', tscPath],
  { stdio: 'inherit' }
);

// Backward-compatibility mirror for legacy paths
const primaryWorkerDir = resolve(process.cwd(), 'dist-electron', 'apps', 'daemon', 'src', 'agents', 'pi-durable', 'worker');
const legacyWorkerDir = resolve(process.cwd(), 'dist-electron', 'services', 'local-ai-core', 'src', 'agents', 'pi-durable', 'worker');
if (existsSync(primaryWorkerDir)) {
  mkdirSync(resolve(legacyWorkerDir, '..'), { recursive: true });
  cpSync(primaryWorkerDir, legacyWorkerDir, { recursive: true, force: true });
}
