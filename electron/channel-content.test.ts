import test from 'node:test';
import assert from 'node:assert/strict';
import { createChannelThreadMessageInput } from '../services/local-ai-core/src/channel/shared/content.js';

test('channel thread message input stays plain text when there are no attachments', () => {
  const input = createChannelThreadMessageInput('Alice: hello', [
    { type: 'text', text: 'hello' },
  ]);

  assert.equal(input, 'Alice: hello');
});

test('channel thread message input wraps text and preserves non-text attachments', () => {
  const input = createChannelThreadMessageInput('Alice: see attached', [
    { type: 'text', text: 'see attached' },
    { type: 'image', data: 'aW1n', mimeType: 'image/png', fileName: 'a.png' },
    { type: 'file', path: '/tmp/report.pdf', fileName: 'report.pdf' },
  ]);

  assert.deepEqual(input, {
    displayText: 'Alice: see attached',
    contentParts: [
      { type: 'text', text: 'Alice: see attached' },
      { type: 'image', data: 'aW1n', mimeType: 'image/png', fileName: 'a.png' },
      { type: 'file', path: '/tmp/report.pdf', fileName: 'report.pdf' },
    ],
  });
});
