import process from 'node:process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { LocalCoreController } from './local-core-controller.js';
import { LocalAiCoreServer } from './server.js';

async function main() {
  const userDataPath = process.env.AI_WORKSTATION_USER_DATA_DIR?.trim() || join(process.cwd(), '.ai-workstation-core');
  mkdirSync(userDataPath, { recursive: true });
  const controller = new LocalCoreController(userDataPath);
  controller.on('logs', (line: string) => {
    if (!line) {
      return;
    }
    process.stdout.write(`[local-ai-core] ${line}\n`);
  });
  controller.on('bridge', (event: unknown) => {
    process.stdout.write(`[local-ai-core bridge] ${JSON.stringify(event)}\n`);
  });
  await controller.init();
  const server = new LocalAiCoreServer(controller);
  await server.start();
  process.on('SIGINT', async () => {
    await server.stop();
    await controller.close();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await server.stop();
    await controller.close();
    process.exit(0);
  });
}

void main();
