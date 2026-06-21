import { spawn } from 'node:child_process';
import process from 'node:process';
import net from 'node:net';
import { writeElectronPackageMetadata } from './write-electron-package.mjs';
import { getElectronBinaryPath } from './electron-bin.mjs';

const rootDir = process.cwd();
const devServerUrl = process.env.AI_WORKSTATION_DEV_SERVER_URL ?? 'http://127.0.0.1:5173';
const isWindows = process.platform === 'win32';
const electronBinary = getElectronBinaryPath();

let electronProcess = null;
let aliasProcess = null;
let aliasRewritePending = false;
let shuttingDown = false;
let electronReady = false;
let serverReady = false;

writeElectronPackageMetadata(rootDir);

function spawnManaged(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
    shell: isWindows,
    ...options,
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }
    console.error(`[dev] ${command} exited with code ${code ?? 'null'} signal ${signal ?? 'null'}`);
    shutdown(code ?? 1);
  });

  return child;
}

const viteProcess = spawnManaged('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', '5173']);
const tscProcess = spawnManaged('pnpm', ['exec', 'tsc', '-p', 'tsconfig.electron.json', '--watch', '--preserveWatchOutput'], {
  stdio: ['inherit', 'pipe', 'pipe'],
});

tscProcess.stdout?.on('data', (chunk) => {
  handleElectronCompilerOutput(chunk, process.stdout);
});

tscProcess.stderr?.on('data', (chunk) => {
  handleElectronCompilerOutput(chunk, process.stderr);
});

function isPortOpen(port, host) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      resolve(false);
    });
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForDevServer() {
  const url = new URL(devServerUrl);
  while (!shuttingDown) {
    if (await isPortOpen(Number(url.port || 80), url.hostname)) {
      serverReady = true;
      maybeLaunchElectron();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

function maybeLaunchElectron() {
  if (shuttingDown || electronProcess || !electronReady || !serverReady) {
    return;
  }

  electronProcess = spawn(electronBinary, ['.'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      AI_WORKSTATION_DEV_SERVER_URL: devServerUrl,
      NODE_ENV: 'development',
      ELECTRON_RUN_AS_NODE: undefined,
    },
  });

  electronProcess.on('exit', (code, signal) => {
    electronProcess = null;
    if (shuttingDown) {
      return;
    }
    if (code === 0 || signal === 'SIGTERM') {
      return;
    }
    console.error(`[dev] electron exited with code ${code ?? 'null'} signal ${signal ?? 'null'}`);
    shutdown(code ?? 1);
  });
}

function restartElectron() {
  if (shuttingDown || !electronProcess) {
    maybeLaunchElectron();
    return;
  }

  const current = electronProcess;
  electronProcess = null;
  current.once('exit', () => {
    if (!shuttingDown) {
      maybeLaunchElectron();
    }
  });
  current.kill('SIGTERM');
}

function rewriteElectronAliases() {
  if (shuttingDown) {
    return;
  }
  if (aliasProcess) {
    aliasRewritePending = true;
    return;
  }

  electronReady = false;
  aliasProcess = spawn('pnpm', ['exec', 'tsc-alias', '-p', 'tsconfig.electron.json'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
    shell: isWindows,
  });

  aliasProcess.on('exit', (code, signal) => {
    aliasProcess = null;
    if (shuttingDown) {
      return;
    }
    if (code !== 0) {
      console.error(`[dev] tsc-alias exited with code ${code ?? 'null'} signal ${signal ?? 'null'}`);
      shutdown(code ?? 1);
      return;
    }
    if (aliasRewritePending) {
      aliasRewritePending = false;
      rewriteElectronAliases();
      return;
    }

    electronReady = true;
    if (electronProcess) {
      restartElectron();
    } else {
      maybeLaunchElectron();
    }
  });
}

function handleElectronCompilerOutput(chunk, stream) {
  const text = chunk.toString();
  stream.write(chunk);
  if (/Found 0 errors?\. Watching for file changes\./.test(text)) {
    rewriteElectronAliases();
  }
}

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  if (electronProcess) {
    electronProcess.kill('SIGTERM');
  }
  if (aliasProcess) {
    aliasProcess.kill('SIGTERM');
  }
  tscProcess.kill('SIGTERM');
  viteProcess.kill('SIGTERM');

  setTimeout(() => {
    process.exit(code);
  }, 100);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

void waitForDevServer();
