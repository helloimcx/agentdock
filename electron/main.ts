import { app, BrowserWindow } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

let mainWindow: BrowserWindow | null = null;
let localCoreProcess: ChildProcess | null = null;
let localCoreStartupPromise: Promise<void> | null = null;
const userDataOverride = process.env.AI_WORKSTATION_USER_DATA_DIR?.trim();
const smokeOutputPath = process.env.AI_WORKSTATION_SMOKE_OUTPUT?.trim();

function appResourcePath(...segments: string[]) {
  return join(app.getAppPath(), ...segments);
}

if (userDataOverride) {
  mkdirSync(userDataOverride, { recursive: true });
  app.setPath('userData', userDataOverride);
}

function localCoreEntryPath() {
  return appResourcePath('dist-electron', 'services', 'local-ai-core', 'src', 'runtime', 'standalone.js');
}

async function isLocalCoreHealthy(timeoutMs = 350) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('http://127.0.0.1:9831/api/local/v1/health', {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForLocalCoreHealthy(timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isLocalCoreHealthy(500)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Local AI Core did not become healthy within ${timeoutMs}ms`);
}

async function fetchSmokeJson(path: string) {
  const response = await fetch(`http://127.0.0.1:9831${path}`);
  if (!response.ok) {
    throw new Error(`Smoke request failed for ${path}: HTTP ${response.status}`);
  }
  return response.json() as Promise<unknown>;
}

async function ensureLocalCoreProcess() {
  if (await isLocalCoreHealthy()) {
    return;
  }
  if (localCoreStartupPromise) {
    return localCoreStartupPromise;
  }
  localCoreStartupPromise = (async () => {
    if (!localCoreProcess) {
      const entry = localCoreEntryPath();
      if (!existsSync(entry)) {
        throw new Error(`Missing Local AI Core entry: ${entry}`);
      }
      const child = spawn(process.execPath, [entry], {
        cwd: app.getAppPath(),
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          AI_WORKSTATION_USER_DATA_DIR: app.getPath('userData'),
        },
        stdio: 'inherit',
      });
      localCoreProcess = child;
      child.on('exit', () => {
        localCoreProcess = null;
      });
    }
    await waitForLocalCoreHealthy();
  })();
  try {
    await localCoreStartupPromise;
  } finally {
    localCoreStartupPromise = null;
  }
}

function stopLocalCoreProcess() {
  if (!localCoreProcess) {
    return;
  }
  localCoreProcess.kill('SIGTERM');
  localCoreProcess = null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    title: 'AI-WorkStation',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devServerUrl = process.env.AI_WORKSTATION_DEV_SERVER_URL?.trim();
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
    return;
  }

  const indexHtmlPath = appResourcePath('dist', 'renderer', 'index.html');
  if (!existsSync(indexHtmlPath)) {
    throw new Error(`Renderer build output was not found at ${indexHtmlPath}. Run "pnpm build" first.`);
  }
  void mainWindow.loadFile(indexHtmlPath);
}

function writeSmokeResult(payload: Record<string, unknown>) {
  if (!smokeOutputPath) {
    return;
  }
  mkdirSync(dirname(smokeOutputPath), { recursive: true });
  writeFileSync(smokeOutputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

app.whenReady().then(async () => {
  await ensureLocalCoreProcess();
  createWindow();
  if (smokeOutputPath) {
    const [capabilities, pluginDiagnostics] = await Promise.all([
      fetchSmokeJson('/api/local/v1/capabilities/snapshot'),
      fetchSmokeJson('/api/local/v1/plugins/diagnostics'),
    ]);
    writeSmokeResult({ ok: true, capabilities, pluginDiagnostics });
    setTimeout(() => app.quit(), 300);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopLocalCoreProcess();
});
