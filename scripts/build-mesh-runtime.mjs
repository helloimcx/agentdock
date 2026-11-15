import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist-electron', 'mesh-runtime');
const wsLicense = await readFile(join(dirname(require.resolve('ws/package.json')), 'LICENSE'), 'utf8');
await mkdir(output, { recursive: true });
await build({
  entryPoints: [join(root, 'apps/daemon/src/mesh/bootstrap-runtime.ts')],
  outfile: join(output, 'bootstrap.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  minify: true,
  legalComments: 'eof',
  banner: { js: `/*! Bundled ws license:\n${wsLicense.replace(/\*\//g, '* /')}\n*/` },
  tsconfig: join(root, 'tsconfig.electron.json'),
  external: ['bufferutil', 'utf-8-validate'],
  logLevel: 'warning',
});
const bytes = await readFile(join(output, 'bootstrap.cjs'));
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
await writeFile(join(output, 'manifest.json'), `${JSON.stringify({
  file: 'bootstrap.cjs', protocol: 1, nodeMajor: 22, version,
  sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
}, null, 2)}\n`);
