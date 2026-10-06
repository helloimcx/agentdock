import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const coreSource = resolve(process.cwd(), 'services', 'local-ai-core', 'src', 'skills', 'builtin');
const legacySource = resolve(process.cwd(), 'electron', 'managed-skills');
const source = existsSync(coreSource) ? coreSource : legacySource;

// 1. Primary destination: Local AI Core builtin skills
const destinationCore = resolve(process.cwd(), 'dist-electron', 'services', 'local-ai-core', 'src', 'skills', 'builtin');
await rm(destinationCore, { recursive: true, force: true });
await mkdir(resolve(destinationCore, '..'), { recursive: true });
await cp(source, destinationCore, { recursive: true, force: true });

// 2. Legacy mirror destination: electron/managed-skills for seamless backwards compatibility
const destinationLegacy = resolve(process.cwd(), 'dist-electron', 'electron', 'managed-skills');
await rm(destinationLegacy, { recursive: true, force: true });
await mkdir(resolve(destinationLegacy, '..'), { recursive: true });
await cp(source, destinationLegacy, { recursive: true, force: true });
