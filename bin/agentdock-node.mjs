#!/usr/bin/env node
import { runNodeCli } from '../dist-electron/services/local-ai-core/src/mesh/node-cli.js';

runNodeCli().catch(() => {
  // Request and credential-file errors can contain credentials; do not dump them.
  console.error('[mesh] Command failed. Check server access, credentials, arguments and file permissions.');
  process.exitCode = 1;
});
