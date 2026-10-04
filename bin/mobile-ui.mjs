#!/usr/bin/env node
import { runMobileUiCli } from '../dist-electron/services/local-ai-core/src/mesh/mobile-ui/cli.js';

runMobileUiCli().catch((err) => {
  console.error('[mobile-ui] Fatal error:', err.message || err);
  process.exitCode = 1;
});
