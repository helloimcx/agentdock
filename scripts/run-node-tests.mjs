import { discoverTestFiles } from './test-files.mjs';
import { runChildProcess } from './run-child-process.mjs';

const root = process.cwd();
let files;
try {
  files = discoverTestFiles(root);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

process.exitCode = runChildProcess(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
