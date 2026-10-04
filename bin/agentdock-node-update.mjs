#!/usr/bin/env node
import { runNodeUpdateCli } from '../dist-electron/services/local-ai-core/src/mesh/mobile-apps/update-cli.js';

runNodeUpdateCli().catch((err) => {
  console.error('[agentdock-update] Fatal error:', err.message || err);
  process.exitCode = 1;
});
