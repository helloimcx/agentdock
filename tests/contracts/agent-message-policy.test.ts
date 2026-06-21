import test from 'node:test';
import assert from 'node:assert/strict';
import { composeAgentMessage } from '../../services/local-ai-core/src/thread/agent-message-policy.js';

test('agent message policy is owned by Local Core and includes selected knowledge context', () => {
  const message = composeAgentMessage('Summarize the design', [
    { id: 'kb-1', name: 'Architecture notes' },
  ]);

  assert.match(message, /\[Scheduler Tools\]/);
  assert.match(message, /\[Monitor Tools\]/);
  assert.match(message, /\[Channel Tools\]/);
  assert.match(message, /id: kb-1 \| name: Architecture notes/);
  assert.match(message, /\[User Message\]\nSummarize the design\n\[\/User Message\]/);
});

test('agent message policy leaves slash commands untouched', () => {
  assert.equal(composeAgentMessage('/agent use pi'), '/agent use pi');
});
