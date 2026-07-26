import { When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import {
  stripWeixinHtml,
  splitTextByUtf8Bytes,
  truncateTextByUtf8Bytes,
  utf8ByteLength,
} from '../../../services/local-ai-core/src/channel/weixin/text-utils.js';
import type { BddWorld } from '../support/world.js';

When<BddWorld>(/^the text "([^"]+)" is stripped of WeChat HTML$/, function (text) {
  this.stringResult = stripWeixinHtml(text);
});

When<BddWorld>(
  /^the text "([^"]+)" is split into chunks of at most (\d+) UTF-8 bytes$/,
  function (text, maxBytes) {
    this.stringList = splitTextByUtf8Bytes(text, Number(maxBytes));
  },
);

When<BddWorld>(/^a long text is truncated to (\d+) UTF-8 bytes$/, function (maxBytes) {
  this.stringResult = truncateTextByUtf8Bytes('很长的内容'.repeat(20), Number(maxBytes));
});

Then<BddWorld>(/^the stripped text is "([^"]+)"$/, function (expected) {
  assert.equal(this.stringResult, expected);
});

Then<BddWorld>(/^the chunks are:$/, function (docstring: string) {
  assert.deepEqual(this.stringList, docstring.split('\n'));
});

Then<BddWorld>(/^each chunk is at most (\d+) UTF-8 bytes$/, function (maxBytes) {
  const limit = Number(maxBytes);
  for (const chunk of this.stringList ?? []) {
    assert.ok(utf8ByteLength(chunk) <= limit, `chunk "${chunk}" exceeds ${limit} bytes`);
  }
});

Then<BddWorld>(/^the result is at most (\d+) UTF-8 bytes$/, function (maxBytes) {
  assert.ok(utf8ByteLength(this.stringResult ?? '') <= Number(maxBytes));
});
