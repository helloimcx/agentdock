import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { createChatEventGate } from '../../../src/components/chat/chat-event-gate.js';
import type { BddWorld } from '../support/world.js';

const SESSION = 'workspace:thread-1';

Given<BddWorld>(/^a fresh event gate for the active run "([^"]+)"$/, function (run) {
  this.gate = createChatEventGate() as never;
  this.activeRunId = run;
  this.pendingTurn = undefined;
});

Given<BddWorld>(
  /^a fresh event gate for the active run "([^"]+)" with a pending turn superseding "([^"]+)"$/,
  function (run, superseded) {
    this.gate = createChatEventGate() as never;
    this.activeRunId = run;
    this.pendingTurn = { sessionKey: SESSION, supersededRunId: superseded };
  },
);

Given<BddWorld>(/^a fresh event gate$/, function () {
  this.gate = createChatEventGate() as never;
  this.activeRunId = undefined;
  this.pendingTurn = undefined;
});

When<BddWorld>(
  /^a bridge "([^"]+)" event arrives for run "([^"]+)"(?: with content "([^"]+)")?$/,
  function (type, run, content) {
    const event: Record<string, unknown> = { type, sessionKey: SESSION, replyCtx: run };
    if (content !== undefined) event.content = content;
    this.boolResult = this.gate!.acceptBridgeEvent(event, {
      activeRunId: this.activeRunId,
      pendingTurn: this.pendingTurn,
    });
  },
);

When<BddWorld>(
  /^a core "message\.updated" event arrives for thread "([^"]+)" message "([^"]+)" with content "([^"]+)"$/,
  function (threadId, messageId, content) {
    this.boolResult = this.gate!.acceptCoreEvent({
      type: 'message.updated',
      threadId,
      message: { id: messageId, content },
    });
  },
);

When<BddWorld>(
  /^a core "stream\.updated" event arrives with an? "([^"]+)" stream for run "([^"]+)"$/,
  function (streamType, run) {
    this.boolResult = this.gate!.acceptCoreEvent({
      type: 'stream.updated',
      stream: { type: streamType, sessionKey: SESSION, replyCtx: run },
    });
  },
);

When<BddWorld>(
  /^a core "presence\.updated" event arrives with an? "([^"]+)" stream for run "([^"]+)" with content "([^"]+)"$/,
  function (streamType, run, content) {
    this.boolResult = this.gate!.acceptCoreEvent({
      type: 'presence.updated',
      live: true,
      stream: { type: streamType, sessionKey: SESSION, replyCtx: run, content },
    });
  },
);

When<BddWorld>(
  /^a core "run\.updated" event arrives for run "([^"]+)" with status "([^"]+)"$/,
  function (runId, status) {
    this.boolResult = this.gate!.acceptCoreEvent({
      type: 'run.updated',
      run: { id: runId, threadId: 'thread-1', startedAt: '', updatedAt: '', status },
    });
  },
);

Then<BddWorld>(/^it is accepted$/, function () {
  assert.equal(this.boolResult, true);
});

Then<BddWorld>(/^it is rejected$/, function () {
  assert.equal(this.boolResult, false);
});
