import { spawn, type ChildProcess } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { isIP } from 'node:net';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime';
import type {
  SandboxCapabilityProbe,
  SandboxNetworkMode,
  SandboxRunInput,
  SandboxRunResult,
  SandboxRunner,
} from './sandbox-runner.js';

export type {
  SandboxCapabilityProbe,
  SandboxNetworkMode,
  SandboxRunInput,
  SandboxRunResult,
  SandboxRunner,
} from './sandbox-runner.js';

/**
 * The manager interface is intentionally structural.  It permits deterministic
 * policy tests without importing the ESM-only runtime, while production uses
 * the package's exported `SandboxManager` singleton.
 */
export interface SandboxManagerLike {
  initialize(
    config: unknown,
    sandboxAskCallback?: (params: { host: string; port: number | undefined }) => Promise<boolean>,
    enableLogMonitor?: boolean,
  ): Promise<void>;
  wrapWithSandboxArgv?(command: string, binShell?: string): Promise<{ argv: string[]; env: NodeJS.ProcessEnv }>;
  checkDependencies?(ripgrepConfig?: { command: string; args?: string[] }): { errors: string[]; warnings: string[] };
  isSupportedPlatform?(): boolean;
  isSandboxingEnabled?(): boolean;
  waitForNetworkInitialization?(): Promise<boolean>;
  updateConfig?(config: unknown): void;
  cleanupAfterCommand?(): void;
  reset?(): Promise<void>;
}

export type AnthropicSandboxRunnerPlatform = 'macos' | 'linux' | 'windows';

export interface AnthropicSandboxRunnerOptions {
  /** Override the host platform in deterministic tests. */
  platform?: NodeJS.Platform | AnthropicSandboxRunnerPlatform;
  manager?: SandboxManagerLike;
  commandExists?: (command: string) => boolean;
  /** Set to false when an AppArmor profile grants user namespaces. */
  appArmorUsernsAvailable?: boolean | (() => boolean);
  /** Disable the startup initialize/reset probe only for pure policy tests. */
  probeInitialization?: boolean;
  /** Root where this runner creates per-run temporary directories. */
  tempRoot?: string;
}

/**
 * Explicit hostnames are kept in the runtime deny list because Sandbox Runtime
 * evaluates its allow/deny rules before its request hook.  The request hook
 * below additionally rejects all RFC1918/link-local/loopback IPs, including
 * addresses not represented by these finite host rules.
 */
export const PRIVATE_NETWORK_DENY_HOSTS = [
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  '127.0.0.1',
  '127.0.0.2',
  '127.255.255.255',
  '0.0.0.0',
  '::1',
  '[::1]',
  '169.254.169.254',
  '169.254.170.2',
  '10.0.0.1',
  '10.255.255.254',
  '172.16.0.1',
  '172.31.255.254',
  '192.168.0.1',
  '192.168.255.254',
  '100.64.0.1',
  '100.127.255.254',
  '192.0.0.1',
  '192.0.2.1',
  '198.18.0.1',
  '198.51.100.1',
  '203.0.113.1',
  'metadata.google.internal',
] as const;

const CAPABILITY_ORDER = ['sandbox_unavailable', 'bwrap', 'socat', 'rg', 'seccomp', 'network.namespace', 'sandbox_runtime', 'apparmor.userns'];
const DEFAULT_WRITE_DENY_PATHS = [
  '/tmp/claude',
  '/private/tmp/claude',
  join(homedir(), '.npm/_logs'),
  join(homedir(), '.claude/debug'),
];
const CONTROLLED_TEMP_ROOT = join(tmpdir(), 'agentdock-automation-runs');
const MAX_NETWORK_AUDIT_ENTRIES = 100;

let managerOperation: Promise<void> = Promise.resolve();

async function withManagerLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = managerOperation;
  let release!: () => void;
  managerOperation = new Promise<void>((resolveRelease) => { release = resolveRelease; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

export class SandboxUnavailableError extends Error {
  readonly code = 'sandbox_unavailable';
  constructor(readonly missing: string[]) {
    super(`sandbox_unavailable${missing.length > 0 ? `: ${missing.join(', ')}` : ''}`);
    this.name = 'SandboxUnavailableError';
  }
}

/**
 * Build the native runtime policy from one script invocation.  Keeping this
 * pure makes the security policy testable without starting proxy processes.
 */
export function buildSandboxRuntimeConfig(input: SandboxRunInput): SandboxRuntimeConfig {
  const cwd = input.cwd || input.workspacePath || process.cwd();
  const packagePath = absolutePath(input.packagePath || input.packageRoot || cwd);
  const tempRoot = absolutePath(input.tempRoot || CONTROLLED_TEMP_ROOT);
  assertSafeTempRoot(tempRoot);
  const tempPath = absolutePath(input.tempDir || input.tempPath || input.temporaryDirectory || join(tempRoot, 'run'));
  assertContainedPath(tempPath, tempRoot, 'tempDir');
  const mode = resolveNetworkMode(input);
  const manifestCapabilities = input.manifest?.capabilities;
  const allowedReadDirs = uniqueAbsolutePaths([
    ...(input.allowedReadDirs || []),
    ...(manifestCapabilities?.allowedReadDirs || []),
  ]);
  const explicitDenyRead = uniqueAbsolutePaths(input.denyRead || []);
  const interpreterPath = input.interpreterPath ? absolutePath(input.interpreterPath) : process.execPath;
  const allowRead = uniqueAbsolutePaths([packagePath, tempPath, interpreterPath, dirname(interpreterPath), ...allowedReadDirs])
    .filter((path) => !explicitDenyRead.some((deny) =>
      path === deny || path.startsWith(`${deny}${sep}`) || deny.startsWith(`${path}${sep}`)));
  const systemTemp = resolve(tmpdir());
  const broadReadDeny = [cwd, homedir(), dirname(packagePath), ...(input.userDataPath ? [absolutePath(input.userDataPath)] : [])]
    .filter((path) => path !== sep && path !== systemTemp && !systemTemp.startsWith(`${path}${sep}`));
  if (dirname(cwd) !== sep && dirname(cwd) !== systemTemp && !systemTemp.startsWith(`${dirname(cwd)}${sep}`)) broadReadDeny.push(dirname(cwd));
  const denyRead = uniqueAbsolutePaths([
    // ASRT uses deny-then-allow semantics. Keep workspace/user data denied,
    // then carve out only the immutable package and declared read roots.
    ...broadReadDeny,
    ...explicitDenyRead,
  ]);
  // Keep every request on the callback path. A non-empty ASRT allowlist would
  // short-circuit the callback for matching hosts and reintroduce DNS/private
  // destination bypasses.
  const allowedDomains: string[] = [];
  const deniedDomains = mode === 'none'
    ? ['*']
    : [...PRIVATE_NETWORK_DENY_HOSTS];

  return {
    network: {
      // Public mode intentionally leaves the allowlist empty and delegates
      // each host to the ask callback. This keeps numeric private addresses
      // and DNS aliases on the same callback path as HTTPS CONNECT/SOCKS.
      allowedDomains,
      deniedDomains: [...deniedDomains],
      strictAllowlist: mode === 'none',
      allowLocalBinding: false,
      allowUnixSockets: [],
      filterRequest: async (request: Request) => {
        const host = new URL(request.url).hostname;
        if (await isPrivateOrLocalHost(host)) {
          return { action: 'deny', reason: 'private or localhost egress is not permitted' };
        }
        return { action: 'allow' };
      },
    },
    filesystem: {
      // The staged package is readable but never writable.  `allowWrite` is
      // intentionally a singleton: no cwd/package/config writes are allowed.
      denyRead,
      allowRead,
      allowWrite: [tempPath],
      denyWrite: [packagePath, ...DEFAULT_WRITE_DENY_PATHS],
      allowGitConfig: false,
    },
    allowPty: false,
  } as SandboxRuntimeConfig;
}

/** Alias kept small and discoverable for callers that name the policy a sandbox config. */
export const buildSandboxConfig = buildSandboxRuntimeConfig;

export class AnthropicSandboxRunner implements SandboxRunner {
  private readonly platform: AnthropicSandboxRunnerPlatform;
  private readonly commandExists: (command: string) => boolean;
  private readonly managerOverride?: SandboxManagerLike;
  private readonly appArmorUsernsAvailable?: boolean | (() => boolean);
  private readonly probeInitialization: boolean;
  private readonly tempRoot: string;
  private managerPromise?: Promise<SandboxManagerLike>;
  private probePromise?: Promise<SandboxCapabilityProbe>;
  private initialized = false;

  constructor(options: AnthropicSandboxRunnerOptions = {}) {
    this.platform = normalizePlatform(options.platform || process.platform);
    this.commandExists = options.commandExists || defaultCommandExists;
    this.managerOverride = options.manager;
    this.appArmorUsernsAvailable = options.appArmorUsernsAvailable;
    this.probeInitialization = options.probeInitialization !== false;
    this.tempRoot = absolutePath(options.tempRoot || CONTROLLED_TEMP_ROOT);
    assertSafeTempRoot(this.tempRoot);
    mkdirSync(this.tempRoot, { recursive: true });
  }

  async probe(): Promise<SandboxCapabilityProbe> {
    if (!this.probePromise) {
      this.probePromise = withManagerLock(() => this.probeInternal()).then((result) => {
        // Do not permanently cache a transient initialization/reset failure;
        // a later diagnostics/run call must be able to recover.
        if (!result.available) this.probePromise = undefined;
        return result;
      });
    }
    return this.probePromise;
  }

  async run(input: SandboxRunInput): Promise<SandboxRunResult> {
    const capability = await this.probe();
    if (!capability.available) throw new SandboxUnavailableError(capability.missing);

    return withManagerLock(() => this.runLocked(input));
  }

  private async runLocked(input: SandboxRunInput): Promise<SandboxRunResult> {
    const suppliedTempPath = input.tempDir || input.tempPath || input.temporaryDirectory;
    const tempPath = absolutePath(suppliedTempPath || join(this.tempRoot, `run-${randomUUID()}`));
    const ownsTempPath = !suppliedTempPath;
    assertContainedPath(tempPath, this.tempRoot, 'tempDir');
    mkdirSync(tempPath, { recursive: true });
    const effectiveInput = { ...input, tempDir: tempPath, tempRoot: this.tempRoot };

    const manager = await this.getManager();
    const config = buildSandboxRuntimeConfig(effectiveInput);
    const networkAudit: Array<{ host: string; port?: number; allowed: boolean; timestamp: string }> = [];
    // SandboxManager is a process-global singleton. Always tear down any
    // previous owner before applying this invocation's filesystem policy.
    try {
      await manager.reset?.();
      const mode = resolveNetworkMode(effectiveInput);
      const allowedDomains = effectiveInput.allowedDomains ?? effectiveInput.manifest?.capabilities?.allowedDomains ?? [];
      await manager.initialize(config, async ({ host, port }) => {
        const allowed = mode !== 'none' && !(await isPrivateOrLocalHost(host))
          && (mode !== 'restricted' || allowedDomains.some((pattern) => matchesDomain(host, pattern)));
        if (networkAudit.length < MAX_NETWORK_AUDIT_ENTRIES) {
          networkAudit.push({ host: sanitizeAuditHost(host), ...(port === undefined ? {} : { port }), allowed, timestamp: new Date().toISOString() });
        }
        return allowed;
      }, false);
      this.initialized = true;
    } catch (error) {
      this.initialized = false;
      if (ownsTempPath) rmSync(tempPath, { recursive: true, force: true });
      throw new SandboxUnavailableError(['sandbox_runtime']);
    }

    try {
      if (manager.waitForNetworkInitialization) {
        const ready = await manager.waitForNetworkInitialization();
        if (!ready) throw new SandboxUnavailableError(['sandbox_runtime']);
      }
      // The wrapped command is deliberately scoped to this method.  It is
      // never returned, logged, or attached to SandboxRunResult.
      if (!manager.wrapWithSandboxArgv) throw new SandboxUnavailableError(['sandbox_runtime']);
      const tempEnvKeys = ['TMPDIR', 'TMP', 'TEMP', 'CLAUDE_CODE_TMPDIR', 'CLAUDE_TMPDIR'] as const;
      const previousTempEnv = Object.fromEntries(tempEnvKeys.map((key) => [key, process.env[key]]));
      for (const key of tempEnvKeys) process.env[key] = tempPath;
      let wrapped: { argv: string[]; env: NodeJS.ProcessEnv };
      try {
        wrapped = await manager.wrapWithSandboxArgv(effectiveInput.command);
      } finally {
        for (const key of tempEnvKeys) {
          if (previousTempEnv[key] === undefined) delete process.env[key];
          else process.env[key] = previousTempEnv[key];
        }
      }
      const result = await spawnWrappedCommand(wrapped, effectiveInput);
      return { ...result, ...(networkAudit.length === 0 ? {} : { networkAudit }) };
    } finally {
      manager.cleanupAfterCommand?.();
      try {
        await manager.reset?.();
      } finally {
        this.initialized = false;
        if (ownsTempPath) rmSync(tempPath, { recursive: true, force: true });
      }
    }
  }

  private async probeInternal(): Promise<SandboxCapabilityProbe> {
    const missing = new Set<string>();
    if (this.platform === 'windows') {
      return { available: false, platform: this.platform, missing: ['sandbox_unavailable'] };
    }

    const manager = await this.getManager().catch(() => undefined);
    if (!manager) missing.add('sandbox_runtime');
    if (manager?.isSupportedPlatform && !manager.isSupportedPlatform()) missing.add('sandbox_unavailable');

    if (this.platform === 'linux') {
      try {
        const deps = manager?.checkDependencies?.() || { errors: [], warnings: [] };
        addDependencyNames(missing, [...deps.errors, ...deps.warnings]);
      } catch {
        missing.add('sandbox_runtime');
      }
      try {
        if (!this.isAppArmorUsernsAvailable()) missing.add('apparmor.userns');
      } catch {
        missing.add('apparmor.userns');
      }
    } else {
      if (!this.commandExists('sandbox-exec')) missing.add('sandbox-exec');
      if (!this.commandExists('rg')) missing.add('rg');
    }

    if (missing.size === 0 && manager && this.probeInitialization) {
      let attempted = false;
      try {
        const probeConfig = buildSandboxRuntimeConfig({
          command: 'true',
          cwd: process.cwd(),
          packagePath: process.cwd(),
          tempRoot: CONTROLLED_TEMP_ROOT,
          tempDir: join(CONTROLLED_TEMP_ROOT, 'probe'),
          network: 'none',
        });
        attempted = true;
        await manager.initialize(probeConfig);
        if (manager.waitForNetworkInitialization && !(await manager.waitForNetworkInitialization())) {
          missing.add('sandbox_runtime');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
        if (message.includes('user namespace') || message.includes('apparmor')) missing.add('apparmor.userns');
        else missing.add('sandbox_runtime');
      } finally {
        if (attempted) {
          try {
            await manager.reset?.();
          } catch {
            missing.add('sandbox_runtime');
          }
        }
      }
    }

    return {
      available: missing.size === 0,
      platform: this.platform,
      missing: orderCapabilities(missing),
    };
  }

  private isAppArmorUsernsAvailable() {
    if (typeof this.appArmorUsernsAvailable === 'function') return this.appArmorUsernsAvailable();
    if (typeof this.appArmorUsernsAvailable === 'boolean') return this.appArmorUsernsAvailable;
    try {
      // Ubuntu's restriction is opt-in.  A missing sysctl means no AppArmor
      // userns gate is present, so do not report a false negative elsewhere.
      return readFileSync('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8').trim() !== '1';
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '';
      if (code === 'ENOENT' && !existsSync('/sys/module/apparmor')) return true;
      return false;
    }
  }

  private async getManager() {
    if (this.managerOverride) return this.managerOverride;
    if (!this.managerPromise) {
      this.managerPromise = importSandboxRuntimeManager();
    }
    return this.managerPromise;
  }
}

export function createAnthropicSandboxRunner(options: AnthropicSandboxRunnerOptions = {}) {
  return new AnthropicSandboxRunner(options);
}

async function importSandboxRuntimeManager(): Promise<SandboxManagerLike> {
  // TypeScript emits CommonJS for Electron.  A native dynamic import through
  // Function avoids transpiling this call to require(), since ASRT is ESM.
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<{ SandboxManager: SandboxManagerLike }>;
  const module = await dynamicImport('@anthropic-ai/sandbox-runtime');
  return module.SandboxManager;
}

function resolveNetworkMode(input: SandboxRunInput): SandboxNetworkMode {
  return input.networkMode || input.network || input.manifest?.capabilities?.network || 'none';
}

function normalizePlatform(value: NodeJS.Platform | AnthropicSandboxRunnerPlatform): AnthropicSandboxRunnerPlatform {
  if (value === 'darwin' || value === 'macos') return 'macos';
  if (value === 'win32' || value === 'windows') return 'windows';
  if (value === 'linux') return 'linux';
  return 'windows';
}

function absolutePath(path: string) {
  if (!isAbsolute(path)) throw new Error('Sandbox paths must be absolute.');
  return resolve(path);
}

function assertContainedPath(candidate: string, root: string, label: string) {
  const candidatePath = resolve(candidate);
  const rootPath = resolve(root);
  const relativePath = relative(rootPath, candidatePath);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`${label} must be inside the controlled temporary root.`);
  }
}

function assertSafeTempRoot(root: string) {
  const normalized = resolve(root);
  if (normalized === sep || normalized === resolve(tmpdir()) || normalized === resolve(homedir())) {
    throw new Error('tempRoot must be a dedicated, non-broad temporary directory.');
  }
}

function uniqueAbsolutePaths(paths: string[]) {
  return [...new Set(paths.filter(Boolean).map(absolutePath))];
}

function addDependencyNames(missing: Set<string>, errors: string[]) {
  for (const error of errors) {
    const lower = error.toLowerCase();
    if (lower.includes('bwrap') || lower.includes('bubblewrap')) missing.add('bwrap');
    if (lower.includes('socat')) missing.add('socat');
    if (lower.includes('ripgrep') || /\brg\b/.test(lower)) missing.add('rg');
    if (lower.includes('seccomp')) missing.add('seccomp');
    if (lower.includes('network namespace') || lower.includes('unshare-net')) missing.add('network.namespace');
    if (lower.includes('unsupported platform')) missing.add('sandbox_unavailable');
    if (lower.includes('sandbox')) missing.add('sandbox_runtime');
  }
}

function orderCapabilities(values: Set<string>) {
  return [...values].sort((left, right) => {
    const leftIndex = CAPABILITY_ORDER.indexOf(left);
    const rightIndex = CAPABILITY_ORDER.indexOf(right);
    return (leftIndex < 0 ? CAPABILITY_ORDER.length : leftIndex) - (rightIndex < 0 ? CAPABILITY_ORDER.length : rightIndex) || left.localeCompare(right);
  });
}

function defaultCommandExists(command: string) {
  const pathValue = process.env.PATH || '';
  return pathValue.split(delimiter).some((directory) => existsSync(join(directory, command)));
}

async function spawnWrappedCommand(wrapped: { argv: string[]; env: NodeJS.ProcessEnv }, input: SandboxRunInput): Promise<SandboxRunResult> {
  if (wrapped.argv.length === 0 || !isAbsolute(wrapped.argv[0])) {
    throw new SandboxUnavailableError(['sandbox_runtime']);
  }
  const runtimePath = wrapped.env.PATH || '/usr/bin:/bin';
  const allowedEnv = input.allowedEnv ?? input.manifest?.env ?? [];
  const inputEnv = Object.fromEntries(
    Object.entries(input.env || {}).filter(([key]) => allowedEnv.includes(key) && !isProxyEnvKey(key)),
  );
  const tempPath = absolutePath(input.tempDir || input.tempPath || input.temporaryDirectory || CONTROLLED_TEMP_ROOT);
  const child = spawn(wrapped.argv[0], wrapped.argv.slice(1), {
    cwd: input.cwd || input.workspacePath || process.cwd(),
    env: {
      ...sanitizeRuntimeEnv(wrapped.env),
      ...sanitizeRuntimeEnv(inputEnv, allowedEnv),
      PATH: runtimePath,
      TMPDIR: tempPath,
      TMP: tempPath,
      TEMP: tempPath,
      CLAUDE_CODE_TMPDIR: tempPath,
      CLAUDE_TMPDIR: tempPath,
    },
    shell: false,
    // A new process group lets timeout/overflow termination include shell
    // descendants rather than leaving a detached child running in the sandbox.
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (input.stdin !== undefined) child.stdin?.end(input.stdin, 'utf8');
  else child.stdin?.end();
  return collectChildResult(child, input.timeoutMs, input.signal, input);
}

function sanitizeRuntimeEnv(runtimeEnv: NodeJS.ProcessEnv, allowedDataKeys: string[] = []): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  const blocked = new Set(['BASH_ENV', 'ENV', 'SHELLOPTS', 'NODE_OPTIONS', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH', 'PATH']);
  for (const [key, value] of Object.entries(runtimeEnv)) {
    if (value === undefined) continue;
    if (blocked.has(key)) continue;
    if (allowedDataKeys.includes(key) && !blocked.has(key) && !isProxyEnvKey(key)) {
      result[key] = value;
    } else if (
      key === 'PATH' || key === 'HOME' || key === 'USER' || key === 'SHELL' ||
      key === 'LANG' || key.startsWith('LC_') || key.startsWith('HTTP_PROXY') ||
      key.startsWith('HTTPS_PROXY') || key.startsWith('ALL_PROXY') ||
      key.startsWith('http_proxy') || key.startsWith('https_proxy') || key.startsWith('all_proxy') ||
      key === 'SSL_CERT_FILE' || key === 'GIT_SSL_CAINFO' || key === 'CURL_CA_BUNDLE' ||
      key === 'REQUESTS_CA_BUNDLE' || key === 'PIP_CERT' || key === 'AWS_CA_BUNDLE' ||
      key === 'CARGO_HTTP_CAINFO' || key === 'DENO_CERT' || key === 'CLOUDSDK_CORE_CUSTOM_CA_CERTS_FILE' ||
      key === 'CLAUDE_CODE_TMPDIR' || key === 'CLAUDE_TMPDIR' ||
      key === 'CLAUDE_CODE_HOST_HTTP_PROXY_PORT' || key === 'CLAUDE_CODE_HOST_SOCKS_PROXY_PORT'
    ) {
      result[key] = value;
    }
  }
  // NO_PROXY is intentionally omitted: it would let a script bypass the
  // mediated proxy and defeat public/private host policy.
  delete result.NO_PROXY;
  delete result.no_proxy;
  return result;
}

function isProxyEnvKey(key: string) {
  return key === 'HTTP_PROXY' || key === 'HTTPS_PROXY' || key === 'ALL_PROXY' ||
    key === 'http_proxy' || key === 'https_proxy' || key === 'all_proxy' ||
    key === 'NO_PROXY' || key === 'no_proxy';
}

function collectChildResult(child: ChildProcess, timeoutMs = 30_000, signal?: AbortSignal, input?: Pick<SandboxRunInput, 'stdoutBytes' | 'stderrBytes'>): Promise<SandboxRunResult> {
  return new Promise((resolveResult) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let outputLimitExceeded: 'stdout' | 'stderr' | undefined;
    const terminateTree = () => {
      if (child.pid && process.platform !== 'win32') {
        try { process.kill(-child.pid, 'SIGKILL'); return; } catch { /* child may have already exited */ }
      }
      child.kill('SIGKILL');
    };
    const timer = setTimeout(terminateTree, timeoutMs);
    const abort = () => terminateTree();
    signal?.addEventListener('abort', abort, { once: true });
    const stdoutParts: Buffer[] = [];
    const stderrParts: Buffer[] = [];
    let stdoutSize = 0;
    let stderrSize = 0;
    const append = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
      const limit = stream === 'stdout' ? input?.stdoutBytes : input?.stderrBytes;
      const current = stream === 'stdout' ? stdoutSize : stderrSize;
      const remaining = limit === undefined ? undefined : limit - current;
      if (remaining === undefined || remaining >= chunk.byteLength) {
        if (stream === 'stdout') { stdoutParts.push(chunk); stdoutSize += chunk.byteLength; }
        else { stderrParts.push(chunk); stderrSize += chunk.byteLength; }
        return;
      }
      const truncated = truncateUtf8(chunk, Math.max(0, remaining));
      if (stream === 'stdout') { stdoutParts.push(truncated); stdoutSize += truncated.byteLength; }
      else { stderrParts.push(truncated); stderrSize += truncated.byteLength; }
      if (!outputLimitExceeded) {
        outputLimitExceeded = stream;
        terminateTree();
      }
    };
    child.stdout?.on('data', (chunk: Buffer) => append('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => append('stderr', chunk));
    const finish = (exitCode: number | null, childSignal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      stdout = Buffer.concat(stdoutParts).toString('utf8');
      stderr = Buffer.concat(stderrParts).toString('utf8');
      resolveResult({ exitCode, signal: childSignal, stdout, stderr, ...(outputLimitExceeded ? { outputLimitExceeded } : {}) });
    };
    child.once('error', (error) => {
      stderrParts.push(Buffer.from(error instanceof Error ? error.message : String(error), 'utf8'));
      finish(null, null);
    });
    child.once('exit', (exitCode, childSignal) => {
      // Retain the normal stdout tail while streams close. If a background
      // descendant inherited them, tear down the process group shortly after
      // wrapper exit instead of allowing an orphan to keep the run open.
      setTimeout(() => {
        if (settled) return;
        let groupAlive = false;
        if (child.pid && process.platform !== 'win32') {
          try { process.kill(-child.pid, 0); groupAlive = true; } catch { /* group exited; let pipes drain */ }
        }
        if (groupAlive) {
          terminateTree();
          child.stdout?.destroy();
          child.stderr?.destroy();
          finish(exitCode, childSignal);
          return;
        }
        // A closed group should normally emit close immediately. Retain tail
        // output, but still bound a pathological inherited pipe hang.
        setTimeout(() => {
          if (settled) return;
          child.stdout?.destroy();
          child.stderr?.destroy();
          finish(exitCode, childSignal);
        }, 1_000);
      }, 50);
    });
    child.once('close', (exitCode, childSignal) => finish(exitCode, childSignal));
  });
}

function truncateUtf8(value: Buffer, limit: number): Buffer {
  if (value.byteLength <= limit) return value;
  // Keep the longest valid UTF-8 prefix. Only the final code point can be
  // partial, so four attempts cover UTF-8's maximum sequence width while
  // preserving legitimate U+FFFD characters already present in the stream.
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let end = limit; end >= Math.max(0, limit - 3); end -= 1) {
    try {
      decoder.decode(value.subarray(0, end));
      return value.subarray(0, end);
    } catch { /* try a shorter final boundary */ }
  }
  return Buffer.alloc(0);
}

async function isPrivateOrLocalHost(host: string) {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (PRIVATE_NETWORK_DENY_HOSTS.some((entry) => entry.replace(/^\[|\]$/g, '').toLowerCase() === normalized)) return true;
  const ipVersion = isIP(normalized);
  if (ipVersion === 4 && isPrivateIpv4(normalized)) return true;
  if (ipVersion === 6 && isPrivateIpv6(normalized)) return true;
  if (ipVersion === 0) {
    try {
      const addresses = await lookup(normalized, { all: true, verbatim: true });
      // 198.18/15 is a reserved benchmark range commonly used by local
      // network shims for public DNS answers. Direct numeric destinations in
      // that range remain denied; DNS aliases still deny RFC1918/link-local.
      return addresses.length === 0 || addresses.some((address) => address.family === 4 ? isPrivateIpv4(address.address, false) : isPrivateIpv6(address.address));
    } catch {
      // A transient DNS failure is reported by the proxy and does not turn
      // into host-side execution: fail closed on resolver errors.
      return true;
    }
  }
  return false;
}

/** Deterministic policy seam used by capability/network tests. */
export const isPrivateNetworkAddress = isPrivateOrLocalHost;

function matchesDomain(host: string, pattern: string) {
  const normalizedHost = host.toLowerCase().replace(/\.$/, '');
  const normalizedPattern = pattern.toLowerCase().replace(/\.$/, '');
  return normalizedPattern === '*' || normalizedPattern === normalizedHost ||
    (normalizedPattern.startsWith('*.') && normalizedHost.endsWith(`.${normalizedPattern.slice(2)}`));
}

function sanitizeAuditHost(value: string) {
  const host = value.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return /^[a-z0-9.:-]+$/i.test(host) && !host.includes('..') ? host : 'invalid-host';
}

function isPrivateIpv4(address: string, includeBenchmarkRange = true) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const value = (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]);
  const first16 = value >>> 16;
  return parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 0) ||
    (first16 >= 0x6440 && first16 <= 0x647f) ||
    (parts[0] === 192 && parts[1] === 0) ||
    (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) ||
    (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) ||
    (includeBenchmarkRange && first16 >= 0xc612 && first16 <= 0xc613);
}

function isPrivateIpv6(address: string) {
  const normalized = address.toLowerCase();
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length);
    if (isIP(mapped) === 4) return isPrivateIpv4(mapped);
    const groups = mapped.split(':');
    if (groups.length >= 2) {
      const high = Number.parseInt(groups[groups.length - 2], 16);
      const low = Number.parseInt(groups[groups.length - 1], 16);
      if (Number.isInteger(high) && Number.isInteger(low)) {
        const dotted = `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
        return isPrivateIpv4(dotted);
      }
    }
    return true;
  }
  return normalized === '::1' || normalized === '::' || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('fc') || normalized.startsWith('fd');
}
