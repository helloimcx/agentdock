import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  renameSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep, win32 } from 'node:path';

export interface AutomationScriptPackageManifest {
  protocolVersion: 1;
  entrypoint: string;
  config: Record<string, unknown>;
  configSchema: Record<string, unknown>;
  capabilities: AutomationScriptPackageCapabilities;
  secretRefs: string[];
  env: string[];
  limits: AutomationScriptPackageLimits;
  testPlan?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AutomationScriptPackageCapabilities extends Record<string, unknown> {
  network: 'none' | 'public';
  internalAccess: boolean;
  allowedReadDirs: string[];
}

export interface AutomationScriptPackageLimits extends Record<string, unknown> {
  timeoutMs: number;
  stdoutBytes: number;
  stderrBytes: number;
  payloadBytes: number;
  stateBytes: number;
}

export interface StagedScriptPackageEntry {
  path: string;
  sha256: string;
  size: number;
}

export interface StagedScriptPackage {
  packageSha256: string;
  packagePath: string;
  shebang: string;
  manifest: AutomationScriptPackageManifest;
  entries: StagedScriptPackageEntry[];
}

export interface StageImmutableScriptPackageInput {
  userDataPath: string;
  scriptId: string;
  sourceDir: string;
}

type PackageEntry = StagedScriptPackageEntry & {
  absolutePath: string;
  content: Buffer;
};

type DirectorySnapshot = {
  dev: number;
  ino: number;
  realPath: string;
};

type ScriptPackageTestHooks = {
  beforeDirectoryRead?: (directory: string) => void;
  beforeFileRead?: (filePath: string) => void;
  beforeChmod?: (path: string) => void;
};

export function stageImmutableScriptPackage(input: StageImmutableScriptPackageInput): StagedScriptPackage {
  const scriptId = validatePathToken(input.scriptId, 'Automation script id');
  const sourceDir = resolve(input.sourceDir);
  const sourceStat = lstatSync(sourceDir);
  if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) {
    throw new Error('Automation script package source must be a real directory.');
  }

  const entries = collectPackageEntries(sourceDir);
  const manifestEntry = entries.find((entry) => entry.path === 'manifest.json');
  if (!manifestEntry) throw new Error('Automation script package manifest.json is required.');
  const manifest = parseManifest(manifestEntry.content);
  const entrypoint = normalizeRelativePosixPath(manifest.entrypoint, 'Automation script entrypoint');
  const entry = entries.find((candidate) => candidate.path === entrypoint);
  if (!entry) throw new Error(`Automation script entrypoint not found: ${entrypoint}`);
  const shebang = validateTextEntrypoint(entry.content);
  manifest.entrypoint = entrypoint;

  const packageSha256 = hashEntries(entries);
  const root = join(resolve(input.userDataPath), 'automations', 'scripts', scriptId);
  const packagePath = join(root, packageSha256);
  if (existsSync(packagePath)) {
    assertRealDirectory(packagePath, 'Existing automation script package');
    verifyPackageHash(packagePath, packageSha256);
    chmodPackageTreeReadOnly(packagePath);
    return stagedPackage(packageSha256, packagePath, shebang, manifest, entries);
  }

  mkdirSync(root, { recursive: true });
  const tempPath = join(root, `.${packageSha256}.tmp-${randomUUID()}`);
  try {
    copyEntriesReadOnly(entries, tempPath);
    verifyPackageHash(tempPath, packageSha256);
    try {
      renameSync(tempPath, packagePath);
      chmodPackageTreeReadOnly(packagePath);
    } catch (error) {
      if (!existsSync(packagePath)) throw error;
      assertRealDirectory(packagePath, 'Existing automation script package');
      verifyPackageHash(packagePath, packageSha256);
      chmodPackageTreeReadOnly(packagePath);
      rmSync(tempPath, { recursive: true, force: true });
    }
    return stagedPackage(packageSha256, packagePath, shebang, manifest, entries);
  } catch (error) {
    rmSync(tempPath, { recursive: true, force: true });
    throw error;
  }
}

function collectPackageEntries(sourceDir: string): PackageEntry[] {
  assertRealDirectory(sourceDir, 'Automation script package source');
  const rootRealPath = realpathSync(sourceDir);
  const entries: PackageEntry[] = [];
  const visit = (directory: string) => {
    for (const item of readDirectoryEntriesStable(directory, rootRealPath)) {
      const absolutePath = join(directory, item.name);
      const stat = lstatSync(absolutePath);
      if (stat.isSymbolicLink()) {
        throw new Error(`Automation script packages cannot contain symlinks: ${item.name}`);
      }
      if (stat.isDirectory()) {
        assertContainedRealPath(absolutePath, rootRealPath, 'Automation script package directory');
        visit(absolutePath);
        continue;
      }
      if (!stat.isFile()) {
        throw new Error(`Automation script packages can only contain regular files: ${item.name}`);
      }
      assertContainedRealPath(absolutePath, rootRealPath, 'Automation script package file');
      const packagePath = normalizeFilesystemPackagePath(sourceDir, absolutePath);
      const content = readRegularFileNoFollow(absolutePath, packagePath, rootRealPath);
      if (content.includes(0)) {
        throw new Error(`Automation script package file must be text, not binary: ${packagePath}`);
      }
      entries.push({
        path: packagePath,
        absolutePath,
        content,
        sha256: createHash('sha256').update(content).digest('hex'),
        size: content.byteLength,
      });
    }
  };
  visit(sourceDir);
  if (entries.length === 0) throw new Error('Automation script package cannot be empty.');
  return entries.sort(compareEntries);
}

function normalizeFilesystemPackagePath(sourceDir: string, absolutePath: string) {
  const rawRelative = relative(sourceDir, absolutePath);
  const parts = rawRelative.split(sep);
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Automation script package path must be relative and normalized: ${rawRelative}`);
  }
  return normalizeRelativePosixPath(parts.join(posix.sep), 'Automation script package path');
}

function normalizeRelativePosixPath(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const input = value.trim();
  if (isAbsolute(input) || posix.isAbsolute(input) || win32.isAbsolute(input)) {
    throw new Error(`${label} must be a relative POSIX path, not an absolute path.`);
  }
  if (input.includes('\\')) throw new Error(`${label} must be a relative POSIX path.`);
  const segments = input.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`${label} must not contain path traversal.`);
  }
  const normalized = posix.normalize(input);
  if (normalized !== input) throw new Error(`${label} must already be normalized.`);
  return normalized;
}

function validatePathToken(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const token = value.trim();
  if (
    isAbsolute(token) ||
    posix.isAbsolute(token) ||
    win32.isAbsolute(token) ||
    token.includes('/') ||
    token.includes('\\') ||
    token === '.' ||
    token === '..' ||
    token.includes('..')
  ) {
    throw new Error(`${label} cannot contain path separators or traversal.`);
  }
  return token;
}

function parseManifest(content: Buffer): AutomationScriptPackageManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.toString('utf8'));
  } catch (error) {
    throw withContext('Automation script manifest must be valid JSON', error);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Automation script manifest must be an object.');
  }
  const manifest = parsed as Record<string, unknown>;
  if (manifest.protocolVersion !== 1) {
    throw new Error('Automation script manifest protocolVersion must be 1.');
  }
  const capabilities = parseCapabilities(manifest.capabilities);
  const limits = parseLimits(manifest.limits);
  return {
    ...manifest,
    protocolVersion: 1,
    entrypoint: normalizeRelativePosixPath(manifest.entrypoint, 'Automation script entrypoint'),
    config: asRecord(manifest.config, 'Automation script manifest config'),
    configSchema: asRecord(manifest.configSchema, 'Automation script manifest configSchema'),
    capabilities,
    secretRefs: stringArray(manifest.secretRefs, 'Automation script manifest secretRefs'),
    env: stringArray(manifest.env, 'Automation script manifest env'),
    limits,
  };
}

function parseCapabilities(value: unknown): AutomationScriptPackageCapabilities {
  const capabilities = asRecord(value, 'Automation script manifest capabilities');
  const network = requiredString(capabilities.network, 'Automation script manifest capabilities.network');
  if (network !== 'none' && network !== 'public') {
    throw new Error('Automation script manifest capabilities.network must be none or public.');
  }
  if (typeof capabilities.internalAccess !== 'boolean') {
    throw new Error('Automation script manifest capabilities.internalAccess must be a boolean.');
  }
  return {
    ...capabilities,
    network,
    internalAccess: capabilities.internalAccess,
    allowedReadDirs: stringArray(capabilities.allowedReadDirs, 'Automation script manifest capabilities.allowedReadDirs'),
  };
}

function parseLimits(value: unknown): AutomationScriptPackageLimits {
  const limits = asRecord(value, 'Automation script manifest limits');
  return {
    ...limits,
    timeoutMs: positiveSafeInteger(limits.timeoutMs, 'Automation script manifest limits.timeoutMs'),
    stdoutBytes: positiveSafeInteger(limits.stdoutBytes, 'Automation script manifest limits.stdoutBytes'),
    stderrBytes: positiveSafeInteger(limits.stderrBytes, 'Automation script manifest limits.stderrBytes'),
    payloadBytes: positiveSafeInteger(limits.payloadBytes, 'Automation script manifest limits.payloadBytes'),
    stateBytes: positiveSafeInteger(limits.stateBytes, 'Automation script manifest limits.stateBytes'),
  };
}

function validateTextEntrypoint(content: Buffer): string {
  if (content.includes(0)) throw new Error('Automation script entrypoint must be text, not binary.');
  const text = content.toString('utf8');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  if (!firstLine.startsWith('#!') || firstLine.trim().length <= 2) {
    throw new Error('Automation script entrypoint must start with a valid shebang.');
  }
  return firstLine.trim();
}

function hashEntries(entries: PackageEntry[] | StagedScriptPackageEntry[], root?: string) {
  const hash = createHash('sha256');
  const rootRealPath = root ? realpathSync(root) : undefined;
  for (const entry of [...entries].sort(compareEntries)) {
    const content = 'content' in entry
      ? entry.content
      : readPackageFileFromRoot(root || '', rootRealPath, entry.path);
    hash.update(entry.path, 'utf8');
    hash.update('\0');
    hash.update(createHash('sha256').update(content).digest('hex'), 'utf8');
    hash.update('\0');
    hash.update(String(content.byteLength), 'utf8');
    hash.update('\0');
  }
  return hash.digest('hex');
}

function copyEntriesReadOnly(entries: PackageEntry[], destination: string) {
  mkdirSync(destination, { recursive: true });
  const destinationRealPath = realpathSync(destination);
  for (const entry of entries) {
    const target = join(destination, entry.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entry.content, { mode: 0o444 });
    chmodPathWithStableParent(target, 0o444, destinationRealPath, 'Automation script package file');
  }
}

function verifyPackageHash(packagePath: string, expectedSha256: string) {
  assertRealDirectory(packagePath, 'Automation script package');
  const entries = collectPackageEntries(packagePath);
  const actualSha256 = hashEntries(entries);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Copied automation script package hash mismatch for ${basename(packagePath)}.`);
  }
}

function stagedPackage(
  packageSha256: string,
  packagePath: string,
  shebang: string,
  manifest: AutomationScriptPackageManifest,
  entries: PackageEntry[],
): StagedScriptPackage {
  return {
    packageSha256,
    packagePath,
    shebang,
    manifest,
    entries: entries.map(({ path, sha256, size }) => ({ path, sha256, size })),
  };
}

function compareEntries(left: { path: string }, right: { path: string }) {
  return Buffer.compare(Buffer.from(left.path, 'utf8'), Buffer.from(right.path, 'utf8'));
}

function withContext(message: string, error: unknown) {
  return new Error(`${message}: ${error instanceof Error ? error.message : String(error)}`);
}

function assertRealDirectory(path: string, label: string) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be a real directory.`);
  }
}

function readRegularFileNoFollow(path: string, packagePath: string, rootRealPath?: string): Buffer {
  const parentDirectory = dirname(path);
  const before = rootRealPath
    ? assertDirectorySnapshot(parentDirectory, rootRealPath, 'Automation script package file parent directory')
    : undefined;
  if (rootRealPath) {
    assertContainedRealPath(path, rootRealPath, 'Automation script package file');
  }
  const fileBefore = rootRealPath
    ? assertPackagePathSnapshot(path, rootRealPath, 'Automation script package file')
    : undefined;
  runBeforeFileReadHook(path);
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  const fd = openSync(path, constants.O_RDONLY | noFollow);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) {
      throw new Error(`Automation script packages can only contain regular files: ${packagePath}`);
    }
    if (fileBefore) {
      assertSameDeviceInode(fileBefore, stat, `Automation script package file changed before open: ${path}`);
    }
    const content = readFileSync(fd);
    if (rootRealPath && before) {
      const after = assertDirectorySnapshot(parentDirectory, rootRealPath, 'Automation script package file parent directory');
      assertSameDirectorySnapshot(before, after, `Automation script package file parent directory changed during read: ${parentDirectory}`);
      const fileAfter = assertPackagePathSnapshot(path, rootRealPath, 'Automation script package file');
      if (fileBefore) {
        assertSameDirectorySnapshot(fileBefore, fileAfter, `Automation script package file changed during read: ${path}`);
      }
      assertContainedRealPath(path, rootRealPath, 'Automation script package file');
    }
    return content;
  } finally {
    closeSync(fd);
  }
}

function chmodPackageTreeReadOnly(packagePath: string) {
  const rootRealPath = realpathSync(packagePath);
  const directories: string[] = [];
  const visit = (directory: string) => {
    assertDirectorySnapshot(directory, rootRealPath, 'Automation script package directory');
    directories.push(directory);
    for (const item of readDirectoryEntriesStable(directory, rootRealPath)) {
      const absolutePath = join(directory, item.name);
      const stat = lstatSync(absolutePath);
      if (stat.isSymbolicLink()) {
        throw new Error(`Automation script packages cannot contain symlinks: ${item.name}`);
      }
      if (stat.isDirectory()) {
        assertContainedRealPath(absolutePath, rootRealPath, 'Automation script package directory');
        visit(absolutePath);
        continue;
      }
      if (!stat.isFile()) {
        throw new Error(`Automation script packages can only contain regular files: ${item.name}`);
      }
      assertContainedRealPath(absolutePath, rootRealPath, 'Automation script package file');
      chmodPathWithStableParent(absolutePath, 0o444, rootRealPath, 'Automation script package file');
    }
  };
  visit(packagePath);
  for (const directory of directories.reverse()) {
    chmodPathWithStableParent(directory, 0o555, rootRealPath, 'Automation script package directory');
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${label} must be an array of strings.`);
  }
  return value.map((item) => item.trim());
}

function positiveSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function readDirectoryEntriesStable(directory: string, rootRealPath: string) {
  const before = assertDirectorySnapshot(directory, rootRealPath, 'Automation script package directory');
  runBeforeDirectoryReadHook(directory);
  const entries = readdirSync(directory, { withFileTypes: true });
  const after = assertDirectorySnapshot(directory, rootRealPath, 'Automation script package directory');
  assertSameDirectorySnapshot(before, after, `Automation script package directory changed during traversal: ${directory}`);
  return entries;
}

function assertDirectorySnapshot(directory: string, rootRealPath: string, label: string): DirectorySnapshot {
  const stat = lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be a real directory.`);
  }
  const realPath = assertContainedRealPath(directory, rootRealPath, label);
  return {
    dev: stat.dev,
    ino: stat.ino,
    realPath,
  };
}

function assertContainedRealPath(path: string, rootRealPath: string, label: string): string {
  const realPath = realpathSync(path);
  const relativePath = relative(rootRealPath, realPath);
  if (relativePath && (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath))) {
    throw new Error(`${label} must stay within the automation script package root.`);
  }
  return realPath;
}

function readPackageFileFromRoot(root: string, rootRealPath: string | undefined, entryPath: string): Buffer {
  const absolutePath = join(root, entryPath);
  if (rootRealPath) {
    assertContainedRealPath(absolutePath, rootRealPath, 'Automation script package file');
  }
  return readRegularFileNoFollow(absolutePath, entryPath, rootRealPath);
}

function chmodPathWithStableParent(path: string, mode: number, rootRealPath: string, label: string) {
  const pathRealBefore = assertContainedRealPath(path, rootRealPath, label);
  const protectsRootItself = pathRealBefore === rootRealPath;
  const snapshotPath = protectsRootItself ? path : dirname(path);
  const snapshotLabel = protectsRootItself ? label : `${label} parent directory`;
  const before = assertDirectorySnapshot(snapshotPath, rootRealPath, snapshotLabel);
  const targetBefore = assertPackagePathSnapshot(path, rootRealPath, label);
  runBeforeChmodHook(path);
  chmodSync(path, mode);
  const after = assertDirectorySnapshot(snapshotPath, rootRealPath, snapshotLabel);
  assertSameDirectorySnapshot(before, after, `${snapshotLabel} changed during chmod: ${snapshotPath}`);
  const targetAfter = assertPackagePathSnapshot(path, rootRealPath, label);
  assertSameDirectorySnapshot(targetBefore, targetAfter, `${label} changed during chmod: ${path}`);
  assertContainedRealPath(path, rootRealPath, label);
}

function assertSameDirectorySnapshot(before: DirectorySnapshot, after: DirectorySnapshot, message: string) {
  if (before.dev !== after.dev || before.ino !== after.ino || before.realPath !== after.realPath) {
    throw new Error(message);
  }
}

function assertSameDeviceInode(
  before: Pick<DirectorySnapshot, 'dev' | 'ino'>,
  after: Pick<DirectorySnapshot, 'dev' | 'ino'>,
  message: string,
) {
  if (before.dev !== after.dev || before.ino !== after.ino) {
    throw new Error(message);
  }
}

function assertPackagePathSnapshot(path: string, rootRealPath: string, label: string): DirectorySnapshot {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    throw new Error(`${label} must not be a symlink.`);
  }
  const realPath = assertContainedRealPath(path, rootRealPath, label);
  return {
    dev: stat.dev,
    ino: stat.ino,
    realPath,
  };
}

function runBeforeDirectoryReadHook(directory: string) {
  const hooks = (globalThis as typeof globalThis & {
    __automationScriptPackageTestHooks?: ScriptPackageTestHooks;
  }).__automationScriptPackageTestHooks;
  hooks?.beforeDirectoryRead?.(directory);
}

function runBeforeFileReadHook(path: string) {
  const hooks = (globalThis as typeof globalThis & {
    __automationScriptPackageTestHooks?: ScriptPackageTestHooks;
  }).__automationScriptPackageTestHooks;
  hooks?.beforeFileRead?.(path);
}

function runBeforeChmodHook(path: string) {
  const hooks = (globalThis as typeof globalThis & {
    __automationScriptPackageTestHooks?: ScriptPackageTestHooks;
  }).__automationScriptPackageTestHooks;
  hooks?.beforeChmod?.(path);
}
