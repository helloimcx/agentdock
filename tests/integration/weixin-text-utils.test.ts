import assert from 'node:assert/strict';
import test from 'node:test';
import {
  splitTextByUtf8Bytes,
  stripWeixinHtml,
  truncateTextByUtf8Bytes,
  utf8ByteLength,
} from '../../services/local-ai-core/src/channel/weixin/text-utils.js';

test('weixin text utilities preserve utf8 boundaries and decode simple html', () => {
  assert.equal(stripWeixinHtml('<p>A&amp;B</p>'), 'A&B');
  const chunks = splitTextByUtf8Bytes('你好世界', 6);
  assert.deepEqual(chunks, ['你好', '世界']);
  assert.ok(chunks.every((chunk) => utf8ByteLength(chunk) <= 6));
  assert.ok(utf8ByteLength(truncateTextByUtf8Bytes('很长的内容'.repeat(20), 80)) <= 80);
});
