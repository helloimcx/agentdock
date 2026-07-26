import { When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { createChannelThreadMessageInput } from '../../../services/local-ai-core/src/channel/shared/content.js';
import { resolveChannelFilePath } from '../../../services/local-ai-core/src/channel/shared/file-utils.js';
import type { BddWorld } from '../support/world.js';

When<BddWorld>(
  /^a channel thread message is built from "([^"]+)" with a single text part "([^"]+)"$/,
  function (displayText, text) {
    this.objectResult = createChannelThreadMessageInput(displayText, [{ type: 'text', text }] as never);
  },
);

When<BddWorld>(/^a channel thread message is built from "([^"]+)" with the parts:$/, function (displayText, json) {
  this.objectResult = createChannelThreadMessageInput(displayText, JSON.parse(json));
});

Then<BddWorld>(/^the input is the plain text "([^"]+)"$/, function (expected) {
  assert.equal(this.objectResult, expected);
});

Then<BddWorld>(/^the display text is "([^"]+)"$/, function (expected) {
  assert.equal((this.objectResult as { displayText?: string }).displayText, expected);
});

Then<BddWorld>(/^there are (\d+) content parts$/, function (count) {
  assert.equal((this.objectResult as { contentParts?: unknown[] }).contentParts?.length, Number(count));
});

When<BddWorld>(/^a channel file path "([^"]+)" is resolved against "([^"]+)"$/, function (filePath, root) {
  this.stringResult = resolveChannelFilePath(filePath, root);
});

Then<BddWorld>(/^the resolved path is "([^"]+)"$/, function (expected) {
  assert.equal(this.stringResult, expected);
});
