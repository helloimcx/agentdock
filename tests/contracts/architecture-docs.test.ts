import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';

const rootDir = process.cwd();
const sourceFileExtensions = new Set(['.ts', '.tsx', '.mts', '.mjs']);

function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['dist', 'dist-electron', 'node_modules', 'release'].includes(entry.name)) {
        continue;
      }
      files.push(...listSourceFiles(path));
      continue;
    }
    if (entry.isFile() && sourceFileExtensions.has(path.slice(path.lastIndexOf('.')))) {
      files.push(path);
    }
  }
  return files;
}

function readSourceFiles(scope: string) {
  const dir = join(rootDir, scope);
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    return [];
  }
  return listSourceFiles(dir).map((path) => ({
    path,
    relativePath: relative(rootDir, path),
    content: readFileSync(path, 'utf8'),
  }));
}

test('state ownership docs identify Local AI Core owners for durable chat and channel state', () => {
  const content = readFileSync(join(rootDir, 'docs', 'architecture', 'state-ownership.md'), 'utf8');

  for (const state of [
    'Task lifecycle',
    'Run lifecycle',
    'Thread messages',
    'Permission requests',
    'Attachments',
    'Channel inbound content',
    'Channel outbound content',
  ]) {
    assert.match(content, new RegExp(`\\| ${state} \\|[^\\n]*Local AI Core`), `${state} must have a Local AI Core owner`);
  }
  assert.match(content, /Renderer owns transient UI state only/, 'renderer ownership must remain transient');
  assert.match(content, /Shared packages define cross-process data shapes/, 'shared contracts boundary must remain explicit');
});

test('message and channel contract docs cover canonical concepts and field lifecycles', () => {
  const content = readFileSync(join(rootDir, 'docs', 'architecture', 'message-and-channel-contracts.md'), 'utf8');

  for (const concept of [
    'Thread',
    'Run',
    'Task',
    'PermissionRequest',
    'MessageBlock',
    'Attachment',
    'ChannelInboundContent',
    'ChannelOutboundContent',
  ]) {
    assert.match(content, new RegExp(`\\| ${concept} \\|`), `${concept} must be listed in the contract index`);
  }
  for (const heading of ['Persisted fields', 'Streamed fields', 'Rendered fields', 'Platform-specific fields']) {
    assert.match(content, new RegExp(`\\| ${heading} `), `${heading} must stay documented`);
  }
  assert.match(content, /Permission requests are durable thread\/run state/, 'permission state must not be renderer-inferred');
  assert.match(content, /Thinking blocks are not overwritten by final answer blocks/, 'thinking/final separation invariant must remain documented');
  assert.match(content, /Sending files through a channel uses one outbound path/, 'outbound file path invariant must remain documented');
});

test('thread chat renderer state types reuse canonical contracts instead of ad hoc duplicates', () => {
  const taskStateSource = readFileSync(join(rootDir, 'src', 'pages', 'Threads', 'thread-chat-task-state.ts'), 'utf8');
  const permissionSource = readFileSync(join(rootDir, 'src', 'pages', 'Threads', 'thread-chat-permission.ts'), 'utf8');

  assert.match(
    taskStateSource,
    /import type \{ ChatTaskState \} from '\.\/thread-chat-model';/,
    'task-state helpers must reuse the canonical Thread Chat task-state type',
  );
  assert.doesNotMatch(
    taskStateSource,
    /type ChatTaskState\s*=/,
    'task-state helpers must not redeclare ChatTaskState',
  );
  assert.match(
    permissionSource,
    /export type PendingPermissionRequest = ThreadPendingPermissionRequest;/,
    'renderer pending permission state must alias the shared thread permission contract',
  );
  assert.doesNotMatch(
    permissionSource,
    /type PermissionTaskState\s*=/,
    'permission helpers must not carry a second task-state union',
  );
});

test('production code imports workspace packages through public package names', () => {
  const offenders = ['src', 'services', 'packages']
    .flatMap(readSourceFiles)
    .filter(({ relativePath }) => !relativePath.startsWith('packages/contracts/src/'))
    .filter(({ content }) => /(?:packages\/(?:contracts|core-sdk|plugin-sdk|knowledge-api)|(?:contracts|core-sdk|plugin-sdk))\/src/.test(content))
    .map(({ relativePath }) => relativePath);

  assert.deepEqual(
    offenders,
    [],
    'production code must import workspace dependencies through @cc/* public entrypoints',
  );
});

test('renderer does not import Electron or Local AI Core internals', () => {
  const offenders = readSourceFiles('src')
    .filter(({ content }) => {
      return (
        /from ['"]electron(?:\/[^'"]*)?['"]/.test(content) ||
        /from ['"][^'"]*\/electron(?:\/[^'"]*)?['"]/.test(content) ||
        /from ['"][^'"]*services\/local-ai-core\/src/.test(content)
      );
    })
    .map(({ relativePath }) => relativePath);

  assert.deepEqual(
    offenders,
    [],
    'renderer code must communicate with Electron and Local AI Core through shared contracts and API adapters',
  );
});

test('workspace packages declare public package entrypoints', () => {
  for (const packagePath of [
    'packages/contracts/package.json',
    'packages/core-sdk/package.json',
    'packages/plugin-sdk/package.json',
  ]) {
    const packageJson = JSON.parse(readFileSync(join(rootDir, packagePath), 'utf8')) as {
      exports?: Record<string, string>;
    };
    assert.equal(
      packageJson.exports?.['.'],
      './src/index.ts',
      `${packagePath} must expose its public source entrypoint for workspace consumers`,
    );
  }

  const contracts = JSON.parse(readFileSync(join(rootDir, 'packages/contracts/package.json'), 'utf8')) as {
    exports?: Record<string, string>;
  };
  const domains = ['runtime', 'threads', 'channels', 'scheduler', 'automation', 'knowledge'];
  for (const domain of domains) {
    assert.ok(contracts.exports?.[`./${domain}`], `contracts must expose the ${domain} domain entrypoint`);
  }

  for (const packageName of ['contracts', 'core-sdk', 'plugin-sdk']) {
    const packageJson = JSON.parse(readFileSync(join(rootDir, `packages/${packageName}/package.json`), 'utf8')) as {
      exports?: Record<string, string>;
    };
    for (const domain of domains) {
      assert.equal(
        packageJson.exports?.[`./${domain}`],
        `./src/${domain}.ts`,
        `${packageName} must expose the ${domain} domain through its dedicated entrypoint`,
      );
    }
  }
});

test('core sdk domain entrypoints do not re-export the top-level sdk', () => {
  for (const domain of ['runtime', 'threads', 'channels', 'scheduler', 'automation', 'knowledge']) {
    const source = readFileSync(join(rootDir, `packages/core-sdk/src/${domain}.ts`), 'utf8');
    assert.doesNotMatch(
      source,
      /(?:from|import\s*\()\s*['"]\.\/index\.js['"]/,
      `core-sdk/${domain} must own its implementation without depending on the aggregate entrypoint`,
    );
    assert.match(source, /coreRequest|coreClient/, `core-sdk/${domain} must own executable domain behavior`);
  }
});

test('package domain modules do not depend on aggregate entrypoints', () => {
  for (const packageName of ['contracts', 'core-sdk', 'plugin-sdk']) {
    for (const domain of ['runtime', 'threads', 'channels', 'scheduler', 'automation', 'knowledge']) {
      const source = readFileSync(join(rootDir, `packages/${packageName}/src/${domain}.ts`), 'utf8');
      assert.doesNotMatch(
        source,
        /(?:from|import\s*\()\s*['"]\.\/index(?:\.js)?['"]/,
        `${packageName}/${domain} must not reach back through its aggregate entrypoint`,
      );
    }
  }
});

test('desktop contracts are consumed through the contracts package outside their owner', () => {
  const offenders = ['src', 'services', 'packages']
    .flatMap(readSourceFiles)
    .filter(({ relativePath }) => !relativePath.startsWith('packages/contracts/src/'))
    .filter(({ content }) => /shared\/desktop/.test(content))
    .map(({ relativePath }) => relativePath);

  assert.deepEqual(offenders, [], 'business code must consume shared desktop contracts through @cc/superai-contracts');
});

test('renderer does not branch features through the retired runtime provider string', () => {
  const offenders = readSourceFiles('src')
    .filter(({ content }) => /RuntimeProvider|getRuntimeProvider|runtimeProvider\s*(?:===|!==)/.test(content))
    .map(({ relativePath }) => relativePath);

  assert.deepEqual(offenders, [], 'renderer features must use capabilities or the Local Core contract directly');
});

test('chat syntax highlighting stays behind a lazy code-block boundary', () => {
  const markdown = readFileSync(join(rootDir, 'src/components/chat/ChatMarkdown.tsx'), 'utf8');
  const highlighted = readFileSync(join(rootDir, 'src/components/chat/HighlightedMarkdown.tsx'), 'utf8');

  assert.doesNotMatch(markdown, /from ['"]rehype-highlight['"]/, 'base chat markdown must not eagerly load highlighting');
  assert.match(markdown, /lazy\(\(\) =>\s*import\('\.\/HighlightedMarkdown'\)/, 'highlighting must use a lazy chunk');
  for (const language of ['typescript', 'javascript', 'json', 'bash', 'python', 'xml', 'css', 'sql', 'yaml']) {
    assert.match(highlighted, new RegExp(`highlight\\.js/lib/languages/${language}`), `${language} must remain in the supported subset`);
  }
});

test('conditional automation architecture documents its security and ownership invariants', () => {
  const content = readFileSync(join(rootDir, 'docs', 'architecture', 'conditional-automation.md'), 'utf8');

  for (const invariant of [
    'Activation → Condition → Action → Delivery',
    'immutable package',
    'two-stage approval',
    'previousState',
    'public egress',
    'private-address deny',
    'Windows fail-closed',
    '30 days',
    '1000',
    'legacy Scheduler and Monitor facades',
    'DNS rebinding',
    'detached process',
  ]) {
    assert.match(content, new RegExp(invariant, 'i'), `conditional automation docs must cover ${invariant}`);
  }
  assert.match(content, /macOS[^\n]+Linux|Linux[^\n]+macOS/i);
});

test('deployment docs require a dedicated AppArmor profile without weakening the global userns policy', () => {
  const content = readFileSync(join(rootDir, 'docs', 'operations', 'release-workflow.md'), 'utf8');

  assert.match(content, /Ubuntu 24\.04\+/);
  assert.match(content, /dedicated AppArmor profile/i);
  assert.match(content, /kernel\.apparmor_restrict_unprivileged_userns/);
  assert.match(content, /must not|do not|禁止/i);
  assert.match(content, /behaviorally executes|behavioral/i);
  assert.match(content, /sysctl is only failure-classification context/i);
  assert.doesNotMatch(content, /sysctl\s+-w\s+kernel\.apparmor_restrict_unprivileged_userns=0/);
});
