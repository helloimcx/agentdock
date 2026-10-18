import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

const rootDir = process.cwd();
const daemonEntry = path.join(rootDir, 'dist-electron', 'apps', 'daemon', 'src', 'runtime', 'standalone.js');
const legacyEntry = path.join(rootDir, 'dist-electron', 'services', 'local-ai-core', 'src', 'runtime', 'standalone.js');
const entry = fs.existsSync(daemonEntry) ? daemonEntry : legacyEntry;

if (!fs.existsSync(entry)) {
  console.error('[daemon] Missing compiled AgentDock daemon entry. Run `pnpm build:electron` first.');
  process.exit(1);
}

await import(pathToFileURL(entry).href);
