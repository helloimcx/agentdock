import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assistantMessageCount,
  chatHistorySignature,
  projectChatHistory,
} from '../../src/components/chat/chat-message-state.js';

test('chat history projection provides a shared stable transcript shape', () => {
  const history = [
    { role: 'user', content: 'hello', timestamp: '2026-06-20T00:00:00Z' },
    { role: 'assistant', content: 'working', kind: 'progress', timestamp: '2026-06-20T00:00:01Z' },
  ];
  const messages = projectChatHistory(history);

  assert.deepEqual(messages.map(({ role, content, kind }) => ({ role, content, kind })), [
    { role: 'user', content: 'hello', kind: 'final' },
    { role: 'assistant', content: 'working', kind: 'progress' },
  ]);
  assert.equal(messages[0].id, '2026-06-20T00:00:00Z-user-0');
  assert.equal(assistantMessageCount(history), 1);
  assert.match(chatHistorySignature(history), /assistant:progress/);
});
