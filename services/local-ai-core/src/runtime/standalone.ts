import process from 'node:process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { LocalCoreController } from './local-core-controller.js';
import { LocalAiCoreServer } from './server.js';

async function main() {
  const userDataPath = process.env.AI_WORKSTATION_USER_DATA_DIR?.trim() || join(process.cwd(), '.agentdock-core');
  const host = process.env.AI_WORKSTATION_HOST?.trim() || '127.0.0.1';
  mkdirSync(userDataPath, { recursive: true });
  const controller = new LocalCoreController(userDataPath);
  const server = new LocalAiCoreServer({
    controller,
    channelService: controller.channelService,
    externalService: controller.externalService,
    butler: controller.butler,
    workspaceRouter: controller.workspaceRouter,
    knowledgeProvider: controller.knowledgeProvider,
    scheduledJobs: controller.scheduledJobs,
    automationMonitors: controller.automationMonitors,
    automations: controller.automations,
    decisionLogService: controller.decisionLogService,
    store: controller.store,
    runtimeDetection: controller.runtimeDetection,
    kernel: controller.kernel,
    errorReporter: controller.errorReporter,
  }, { host });
  controller.on('logs', (line: string) => {
    if (!line) {
      return;
    }
    process.stdout.write(`[local-ai-core] ${line}\n`);
  });
  controller.on('bridge', (event: unknown) => {
    process.stdout.write(`[local-ai-core bridge] ${JSON.stringify(event)}\n`);
  });
  await server.start();
  await controller.init();
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Bounded shutdown: a hang in stop/close must not pin the process until
    // systemd gives up and SIGKILLs it, losing graceful-close side effects.
    setTimeout(() => process.exit(0), 10000).unref();
    process.stderr.write(`[local-ai-core] Received ${signal}; shutting down.\n`);
    void (async () => {
      try {
        await server.stop();
        await controller.close();
      } catch (error) {
        process.stderr.write(`[local-ai-core] Shutdown error: ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
      }
      process.exit(0);
    })();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

void main().catch((error) => {
  const code = typeof error === 'object' && error ? (error as { code?: string }).code : '';
  if (code === 'EADDRINUSE') {
    process.stderr.write('[local-ai-core] Port 9831 is already in use; another Local AI Core process is listening.\n');
    process.exit(0);
    return;
  }
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
