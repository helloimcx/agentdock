#!/usr/bin/env node
import { runMobileAppsCli } from '../dist-electron/services/local-ai-core/src/mesh/mobile-apps/cli.js';

runMobileAppsCli().catch((err) => {
  console.error('[mobile-apps] Fatal error:', err.message || err);
  process.exitCode = 1;
});
