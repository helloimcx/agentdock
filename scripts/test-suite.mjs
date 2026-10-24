import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildElectron as buildElectronProcess } from './build-electron.mjs';
import { runChildProcess } from './run-child-process.mjs';
import { discoverTestFiles } from './test-files.mjs';

const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function runPnpm(args, root) {
  return runChildProcess(pnpmCommand, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

function runStage(args, root) {
  return runPnpm(args, root);
}

export async function runTestSuite({
  mode,
  root = process.cwd(),
  files,
  discoverTests = () => discoverTestFiles(root),
  runPnpm = (args) => runStage(args, root),
  runNodeTests = (testFiles, options) => runNodeTestsProcess(testFiles, { ...options, root }),
  buildElectron = (options) => buildElectronProcess({ ...options, root }),
} = {}) {
  if (!['test', 'coverage', 'ci'].includes(mode)) throw new Error(`Unknown test mode: ${mode}`);
  if (files !== undefined && (!Array.isArray(files) || files.length === 0)) {
    throw new Error('No compiled tests were discovered.');
  }

  const run = (args) => runPnpm(args, root);
  if (mode !== 'coverage') {
    let status = run(['test:tooling']);
    if (status !== 0) return status;
  }
  if (mode === 'test') {
    const typecheckStatus = run(['typecheck']);
    if (typecheckStatus !== 0) return typecheckStatus;
  }

  const rendererStatus = run(['build:renderer']);
  if (rendererStatus !== 0) return rendererStatus;

  const electronStatus = buildElectron({ coverage: mode !== 'test' });
  if (electronStatus !== 0) return electronStatus;

  const coverage = mode !== 'test';
  const compiledFiles = files ?? discoverTests();
  if (!Array.isArray(compiledFiles) || compiledFiles.length === 0) {
    throw new Error('No compiled tests were discovered.');
  }
  const testsStatus = runNodeTests(compiledFiles, { coverage, root });
  if (testsStatus !== 0) return testsStatus;

  return mode === 'coverage' ? 0 : run(['test:bdd']);
}

export function runNodeTestsProcess(files, { coverage, root, spawn }) {
  const args = coverage
    ? ['exec', 'c8', 'node', '--test', ...files]
    : ['exec', 'node', '--test', ...files];
  return runChildProcess(pnpmCommand, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  }, spawn);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = await runTestSuite({ mode: process.argv[2] });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
