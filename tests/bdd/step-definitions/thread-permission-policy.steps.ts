import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import {
  taskStateAfterTypingStop,
  taskStateForBridgeButtons,
  taskStateReasonForBridgeButtons,
} from '../../../src/pages/Threads/thread-chat-task-state.js';
import {
  shouldEchoBridgeActionResponse,
  isStructuredPermissionMessage,
} from '../../../src/pages/Threads/thread-chat-permission.js';
import { shouldAcceptLiveBridgeEvent } from '../../../src/pages/Threads/thread-chat-model.js';
import type { BddWorld } from '../support/world.js';

const bool = (value: string) => value === 'present' || value === 'interactive' || value === 'true';

When<BddWorld>(/^the task state after typing stop is derived for "([^"]+)"$/, function (state) {
  this.derivedTaskState = taskStateAfterTypingStop(state as never);
});

When<BddWorld>(
  /^the bridge-button task state is derived for "([^"]+)" "([^"]+)"$/,
  function (present, interactive) {
    this.derivedTaskState = taskStateForBridgeButtons(bool(present), bool(interactive)) as string;
    this.stringResult = taskStateReasonForBridgeButtons(bool(present), bool(interactive));
  },
);

When<BddWorld>(
  /^the echo policy is evaluated for a "([^"]+)" "([^"]+)" action$/,
  function (mode, interactive) {
    this.boolResult = shouldEchoBridgeActionResponse({
      actionMode: mode as never,
      actionInteractive: bool(interactive),
    });
  },
);

When<BddWorld>(
  /^structured permission detection runs on a message with action mode "([^"]+)" and interactive "([^"]+)"$/,
  function (mode, interactive) {
    this.boolResult = isStructuredPermissionMessage({
      id: 'structured',
      role: 'assistant',
      actionMode: mode as never,
      actionInteractive: bool(interactive),
    });
  },
);

When<BddWorld>(
  /^structured permission detection runs on a text-only message "([^"]+)"$/,
  function (content) {
    this.boolResult = isStructuredPermissionMessage({
      id: 'text-only',
      role: 'assistant',
      content,
    } as never);
  },
);

Given<BddWorld>(
  /^the active run is "([^"]+)" with a pending turn superseding "([^"]+)" in session "([^"]+)"$/,
  function (run, superseded, session) {
    this.activeRunId = run;
    this.pendingTurn = { sessionKey: session, supersededRunId: superseded };
  },
);

Given<BddWorld>(/^the active run is "([^"]+)" with no pending turn$/, function (run) {
  this.activeRunId = run;
  this.pendingTurn = undefined;
});

When<BddWorld>(
  /^a live event arrives from run "([^"]+)" in session "([^"]+)"$/,
  function (run, session) {
    this.boolResult = shouldAcceptLiveBridgeEvent({
      event: { sessionKey: session, replyCtx: run },
      activeRunId: this.activeRunId,
      pendingTurn: this.pendingTurn,
    } as never);
  },
);

Then<BddWorld>(/^the reason is "([^"]+)"$/, function (reason) {
  assert.equal(this.stringResult, reason);
});

Then<BddWorld>(/^the response is "(echoed|not echoed)"$/, function (echoed) {
  assert.equal(this.boolResult, echoed === 'echoed');
});

Then<BddWorld>(/^the prompt is (structured|not structured)$/, function (structured) {
  assert.equal(this.boolResult, structured === 'structured');
});
