import fs from 'node:fs';
import path from 'node:path';
import { runChildProcess } from './run-child-process.mjs';

function listTests(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTests(filePath);
    return entry.isFile() && entry.name.endsWith('.test.mjs') ? [filePath] : [];
  }).sort();
}

const root = process.cwd();
const testDirectory = path.join(root, 'tests', 'scripts');
if (!fs.statSync(testDirectory, { throwIfNoEntry: false })?.isDirectory()) {
  console.error('Tooling regression test directory is missing.');
  process.exit(1);
}

const tests = listTests(testDirectory);
if (tests.length === 0) {
  console.error('No tooling regression tests were discovered.');
  process.exit(1);
}

process.exitCode = runChildProcess(process.execPath, ['--test', ...tests], { cwd: root, stdio: 'inherit' });
