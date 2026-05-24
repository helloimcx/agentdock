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

const rendererPackageSourceImportAllowlist = new Set([
  'src/api/cron.ts',
  'src/api/desktop.ts',
  'src/api/knowledge.ts',
  'src/api/monitors.ts',
  'src/api/runtime-bootstrap.ts',
  'src/app/runtime.ts',
  'src/pages/Automation/MonitorList.tsx',
  'src/pages/Cron/CronList.tsx',
  'src/pages/Dashboard.tsx',
  'src/pages/Knowledge/KnowledgeDetail.tsx',
  'src/pages/Knowledge/KnowledgeHome.tsx',
  'src/pages/System/Config.tsx',
  'src/pages/Threads/thread-chat-action-types.ts',
  'src/pages/Threads/thread-chat-model.ts',
  'src/pages/Threads/thread-chat-page-state.ts',
  'src/pages/Threads/thread-chat-permission.test.ts',
  'src/pages/Threads/thread-chat-permission.ts',
  'src/pages/Threads/useThreadChatActions.ts',
  'src/pages/Threads/useThreadChatController.ts',
  'src/pages/Threads/useThreadChatConversationState.ts',
  'src/pages/Threads/useThreadChatSendingActions.ts',
  'src/pages/Threads/useThreadChatSessionBrowser.ts',
  'src/pages/Threads/ThreadChatComposer.tsx',
  'src/pages/Threads/useThreadChatThreadActions.ts',
  'src/types/window.d.ts',
]);

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

test('renderer does not add new direct imports of package source internals', () => {
  const offenders = readSourceFiles('src')
    .filter(({ content }) => /from ['"][^'"]*packages\/(?:contracts|core-sdk|plugin-sdk)\/src/.test(content))
    .map(({ relativePath }) => relativePath)
    .filter((relativePath) => !rendererPackageSourceImportAllowlist.has(relativePath));

  assert.deepEqual(
    offenders,
    [],
    'renderer code should import package APIs through stable public entrypoints; add migrations instead of new packages/*/src imports',
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
});
