import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractLarkHeaderMimeType,
  sniffLarkImageExtension,
  summarizeLarkInboundContentParts,
} from '../../services/local-ai-core/src/channel/lark/gateway-utils.js';

test('lark gateway attachment utilities preserve content summaries and mime detection', () => {
  assert.equal(summarizeLarkInboundContentParts([{ type: 'file', fileName: 'report.pdf' }]), '[File: report.pdf]');
  assert.equal(extractLarkHeaderMimeType({ 'Content-Type': 'image/png; charset=binary' }), 'image/png');
  assert.equal(sniffLarkImageExtension(Buffer.from([0x89, 0x50, 0x4e, 0x47])), 'png');
});
