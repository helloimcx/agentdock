import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runChildProcess } from './run-child-process.mjs';

const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function runPnpm(args, root) {
  return runChildProcess(pnpmCommand, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

export function buildElectron({ root = process.cwd(), coverage = false, run = runPnpm } = {}) {
  fs.rmSync(path.join(root, 'dist-electron'), { recursive: true, force: true });
  const tsconfig = coverage ? 'tsconfig.coverage.json' : 'tsconfig.electron.json';
  const stages = [
    ['--config.verify-deps-before-run=false', 'exec', 'tsc', '-p', 'apps/daemon/src/agents/pi-durable/tsconfig.worker.json'],
    ['exec', 'node', 'scripts/write-electron-package.mjs'],
    ['exec', 'tsc', '-p', tsconfig],
    ['exec', 'tsc-alias', '-p', tsconfig],
    ['exec', 'node', 'scripts/copy-managed-skills.mjs'],
    ['exec', 'node', 'scripts/build-mesh-runtime.mjs'],
  ];

  for (const args of stages) {
    const status = run(args, root);
    if (status !== 0) return status;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = buildElectron();
}
