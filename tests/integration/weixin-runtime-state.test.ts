import assert from 'node:assert/strict';
import test from 'node:test';
import type { DesktopBridgeEvent } from '../../packages/contracts/src/index.js';
import {
  consumeWeixinBridgeEvent,
  createWeixinTurnState,
  isTerminalWeixinBridgeMessage,
  renderWeixinTurnText,
} from '../../services/local-ai-core/src/channel/weixin/runtime-state.js';

test('weixin turn state keeps thought, tool progress, and final reply ordered', () => {
  const turn = createWeixinTurnState('workspace:thread');
  consumeWeixinBridgeEvent(turn, { type: 'typing_start', sessionKey: turn.sessionKey });
  consumeWeixinBridgeEvent(turn, { type: 'update_message', sessionKey: turn.sessionKey, bridgeKind: 'thought', content: 'Inspecting' });
  consumeWeixinBridgeEvent(turn, { type: 'reply', sessionKey: turn.sessionKey, bridgeKind: 'tool', content: 'Search - running' });
  const finalEvent = { type: 'reply', sessionKey: turn.sessionKey, bridgeKind: 'assistant', content: 'Done' } as const;
  consumeWeixinBridgeEvent(turn, finalEvent);

  const rendered = renderWeixinTurnText(turn);
  assert.match(rendered, /Inspecting/);
  assert.match(rendered, /Done/);
  assert.equal(isTerminalWeixinBridgeMessage(finalEvent, rendered), true);
});

test('weixin permission events remain terminal and render fallback actions', () => {
  const turn = createWeixinTurnState('workspace:thread');
  const event: DesktopBridgeEvent = {
    type: 'buttons',
    sessionKey: turn.sessionKey,
    buttonRows: [[{ text: 'Allow', data: 'allow' }]],
  };
  consumeWeixinBridgeEvent(turn, event);

  const rendered = renderWeixinTurnText(turn);
  assert.match(rendered, /allow all/);
  assert.equal(isTerminalWeixinBridgeMessage(event, rendered), true);
});
