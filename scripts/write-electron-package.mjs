import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export function writeElectronPackageMetadata(rootDir = process.cwd()) {
  const distElectronDir = path.join(rootDir, 'dist-electron');
  fs.mkdirSync(distElectronDir, { recursive: true });
  fs.writeFileSync(
    path.join(distElectronDir, 'package.json'),
    `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`,
    'utf8',
  );

  // Forward shim for electron/main.js -> apps/desktop/src/main.js
  const electronDir = path.join(distElectronDir, 'electron');
  fs.mkdirSync(electronDir, { recursive: true });
  fs.writeFileSync(
    path.join(electronDir, 'main.js'),
    `module.exports = require('../apps/desktop/src/main.js');\n`,
    'utf8',
  );

  // Forward shim for services/local-ai-core/src/runtime/standalone.js -> apps/daemon/src/runtime/standalone.js
  const legacyCoreRuntimeDir = path.join(distElectronDir, 'services', 'local-ai-core', 'src', 'runtime');
  fs.mkdirSync(legacyCoreRuntimeDir, { recursive: true });
  fs.writeFileSync(
    path.join(legacyCoreRuntimeDir, 'standalone.js'),
    `module.exports = require('../../../../apps/daemon/src/runtime/standalone.js');\n`,
    'utf8',
  );
}

writeElectronPackageMetadata();
