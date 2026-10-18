#!/usr/bin/env node
import { runNodeUpdateCli } from '../dist-electron/apps/daemon/src/mesh/mobile-apps/update-cli.js';

runNodeUpdateCli().catch((err) => {
  console.error('[agentdock-update] Fatal error:', err.message || err);
  process.exitCode = 1;
});
