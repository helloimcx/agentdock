import { execFileSync } from 'node:child_process';

execFileSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['--config.verify-deps-before-run=false', 'exec', 'tsc', '-p', 'apps/daemon/src/agents/pi-durable/tsconfig.worker.json'],
  { stdio: 'inherit' }
);
