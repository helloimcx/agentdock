import test from 'node:test';
import assert from 'node:assert/strict';
import type { DesktopBridgeEvent, DesktopBridgeToolCall } from '@agentdock/contracts';
import {
  BRIDGE_BROADCAST_MAX_CHARS,
  capBridgeEventForBroadcast,
} from '../../apps/daemon/src/runtime/bridge-broadcast-cap.js';

test('a small bridge event is returned by reference without copying', () => {
  const event: DesktopBridgeEvent = {
    type: 'reply',
    sessionKey: 'localcore-acp:ws:thread-7f0c2e91',
    replyCtx: 'run:agentdock::7f0c2e91-1a2b-4c3d-8e9f-001122334455:63cbd324-0000-4000-8000-112233445566:1795021226209',
    bridgeKind: 'assistant',
    content: 'hi',
  };
  assert.equal(capBridgeEventForBroadcast(event), event);
});

test('oversized content is capped with a dropped-char marker', () => {
  const event: DesktopBridgeEvent = {
    type: 'update_message',
    sessionKey: 'localcore-acp:ws:thread-7f0c2e91',
    bridgeKind: 'tool',
    content: `Terminal: ${'X'.repeat(BRIDGE_BROADCAST_MAX_CHARS * 2)}`,
  };
  const capped = capBridgeEventForBroadcast(event);
  assert.notEqual(capped, event);
  assert.ok(capped.content!.startsWith('Terminal: '), 'prefix must survive');
  assert.ok(capped.content!.includes('…[truncated'), `missing marker: ${capped.content!.slice(-60)}`);
  const expectedDropped = event.content!.length - BRIDGE_BROADCAST_MAX_CHARS;
  assert.match(capped.content!, new RegExp(`truncated ${expectedDropped} chars`));
  assert.ok(capped.content!.length < BRIDGE_BROADCAST_MAX_CHARS + 120, 'capped content stays near the limit');
});

test('oversized tool output is capped while other tool fields survive', () => {
  const toolCall: DesktopBridgeToolCall = {
    id: 'call_63cbd324-tool-4',
    name: 'Terminal',
    status: 'completed',
    output: 'Y'.repeat(BRIDGE_BROADCAST_MAX_CHARS + 5000),
  };
  const event: DesktopBridgeEvent = {
    type: 'update_message',
    sessionKey: 'localcore-acp:ws:thread-7f0c2e91',
    bridgeKind: 'tool',
    toolCall,
  };
  const capped = capBridgeEventForBroadcast(event);
  assert.notEqual(capped.toolCall, toolCall, 'oversized tool call must be replaced');
  assert.equal(capped.toolCall!.id, toolCall.id);
  assert.equal(capped.toolCall!.name, toolCall.name);
  assert.equal(capped.toolCall!.status, toolCall.status);
  assert.ok(capped.toolCall!.output!.includes('…[truncated 5000 chars]'), capped.toolCall!.output!.slice(-60));
  assert.ok(capped.toolCall!.output!.length < BRIDGE_BROADCAST_MAX_CHARS + 120);
});

test('a small tool call keeps its identity; object input is passed by reference', () => {
  const toolCall: DesktopBridgeToolCall = {
    id: 'call_63cbd324-tool-5',
    name: 'Edit',
    status: 'running',
    input: { file_path: '/home/ubuntu/code/agentdock/apps/daemon/src/runtime/server.ts', line: 267 },
    output: 'ok',
  };
  const event: DesktopBridgeEvent = {
    type: 'update_message',
    sessionKey: 'localcore-acp:ws:thread-7f0c2e91',
    bridgeKind: 'tool',
    toolCall,
    content: 'small',
  };
  const capped = capBridgeEventForBroadcast(event);
  assert.equal(capped, event, 'fully-small event must not be copied');
  assert.equal(capped.toolCall, toolCall);
  assert.equal(capped.toolCall!.input, toolCall.input);
});

test('oversized string tool input is capped without touching the object identity of other fields', () => {
  const toolCall = {
    id: 'call_63cbd324-tool-6',
    name: 'Terminal',
    status: 'completed',
    input: 'Z'.repeat(BRIDGE_BROADCAST_MAX_CHARS + 1),
    output: 'done',
  } as DesktopBridgeToolCall;
  const capped = capBridgeEventForBroadcast({ type: 'update_message', bridgeKind: 'tool', toolCall });
  assert.ok(typeof capped.toolCall!.input === 'string');
  assert.ok((capped.toolCall!.input as string).includes('…[truncated 1 chars]'));
  assert.equal(capped.toolCall!.output, 'done', 'small output must stay identical');
});

test('an explicit limit overrides the default', () => {
  const event: DesktopBridgeEvent = {
    type: 'reply',
    sessionKey: 'localcore-acp:ws:thread-7f0c2e91',
    content: 'A'.repeat(300),
  };
  const capped = capBridgeEventForBroadcast(event, 100);
  assert.ok(capped.content!.length < 160, `custom limit not honored, got ${capped.content!.length}`);
});
