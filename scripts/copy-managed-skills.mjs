import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const daemonSource = resolve(process.cwd(), 'apps', 'daemon', 'src', 'skills', 'builtin');
const coreSource = resolve(process.cwd(), 'services', 'local-ai-core', 'src', 'skills', 'builtin');
const desktopSource = resolve(process.cwd(), 'apps', 'desktop', 'managed-skills');
const legacySource = resolve(process.cwd(), 'electron', 'managed-skills');
const source = existsSync(daemonSource)
  ? daemonSource
  : existsSync(coreSource)
    ? coreSource
    : existsSync(desktopSource)
      ? desktopSource
      : legacySource;

// 1. Primary destination: AgentDock daemon builtin skills
const destinationDaemon = resolve(process.cwd(), 'dist-electron', 'apps', 'daemon', 'src', 'skills', 'builtin');
await rm(destinationDaemon, { recursive: true, force: true });
await mkdir(resolve(destinationDaemon, '..'), { recursive: true });
await cp(source, destinationDaemon, { recursive: true, force: true });

// 2. Legacy mirror destination: Local AI Core builtin skills
const destinationCore = resolve(process.cwd(), 'dist-electron', 'services', 'local-ai-core', 'src', 'skills', 'builtin');
await rm(destinationCore, { recursive: true, force: true });
await mkdir(resolve(destinationCore, '..'), { recursive: true });
await cp(source, destinationCore, { recursive: true, force: true });

// 3. Desktop destination
const destinationDesktop = resolve(process.cwd(), 'dist-electron', 'apps', 'desktop', 'managed-skills');
await rm(destinationDesktop, { recursive: true, force: true });
await mkdir(resolve(destinationDesktop, '..'), { recursive: true });
await cp(source, destinationDesktop, { recursive: true, force: true });

// 4. Legacy mirror destination: electron/managed-skills for backwards compatibility
const destinationLegacy = resolve(process.cwd(), 'dist-electron', 'electron', 'managed-skills');
await rm(destinationLegacy, { recursive: true, force: true });
await mkdir(resolve(destinationLegacy, '..'), { recursive: true });
await cp(source, destinationLegacy, { recursive: true, force: true });
