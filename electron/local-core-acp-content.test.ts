import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeThreadMessageInput } from '../services/local-ai-core/src/acp/local-core-acp-content.js';

test('thread message input keeps inbound file content parts', () => {
  const normalized = normalizeThreadMessageInput({
    displayText: '',
    contentParts: [{
      type: 'file',
      uri: 'file:///tmp/report.pdf',
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
      size: 1234,
    }],
  });

  assert.equal(normalized.displayText, '[File: report.pdf]');
  assert.deepEqual(normalized.contentParts, [{
    type: 'file',
    uri: 'file:///tmp/report.pdf',
    fileName: 'report.pdf',
    mimeType: 'application/pdf',
    size: 1234,
  }]);
});

test('thread message input summarizes multiple non-text attachments', () => {
  const normalized = normalizeThreadMessageInput({
    displayText: '',
    contentParts: [
      { type: 'image', uri: 'file:///tmp/a.png', fileName: 'a.png' },
      { type: 'file', path: '/tmp/report.pdf', fileName: 'report.pdf' },
    ],
  });

  assert.equal(normalized.displayText, '[Image: a.png]\n[File: report.pdf]');
  assert.equal(normalized.contentParts.length, 2);
});
