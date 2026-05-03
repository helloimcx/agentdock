import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const rootDir = process.cwd();

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
