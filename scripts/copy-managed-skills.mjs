import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = resolve(process.cwd(), 'electron', 'managed-skills');
const destination = resolve(process.cwd(), 'dist-electron', 'electron', 'managed-skills');
await rm(destination, { recursive: true, force: true });
await mkdir(resolve(destination, '..'), { recursive: true });
await cp(source, destination, { recursive: true, force: true });
