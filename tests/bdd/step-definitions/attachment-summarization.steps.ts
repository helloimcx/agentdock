import { When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { summarizeLarkInboundContentParts } from '../../../services/local-ai-core/src/channel/lark/gateway-utils.js';
import { normalizeThreadMessageInput } from '../../../services/local-ai-core/src/acp/local-core-acp-content.js';
import type { BddWorld } from '../support/world.js';

When<BddWorld>(/^lark inbound parts are summarized:$/, function (json: string) {
  this.stringResult = summarizeLarkInboundContentParts(JSON.parse(json));
});

Then<BddWorld>(/^the summary is "([^"]+)"$/, function (expected) {
  assert.equal(this.stringResult, expected);
});

When<BddWorld>(/^an ACP thread message is normalized with empty text and the parts:$/, function (json: string) {
  this.objectResult = normalizeThreadMessageInput({
    displayText: '',
    contentParts: JSON.parse(json),
  } as never);
});

Then<BddWorld>(/^the summarized text is:$/, function (docstring: string) {
  assert.equal((this.objectResult as { displayText?: string }).displayText, docstring);
});
