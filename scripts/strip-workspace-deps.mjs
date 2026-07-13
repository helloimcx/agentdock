// Run by `npm pack` / `npm publish` via the `prepack` lifecycle hook.
// Removes workspace-linked @cc/* deps that are bundled into the published
// tarball (dist-electron/packages/) and must not appear as external deps.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

let stripped = 0;
for (const name of Object.keys(pkg.dependencies || {})) {
  if (pkg.dependencies[name] === 'workspace:*') {
    delete pkg.dependencies[name];
    stripped++;
  }
}

if (stripped > 0) {
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`prepack: stripped ${stripped} workspace:* dep(s) from package.json`);
}
