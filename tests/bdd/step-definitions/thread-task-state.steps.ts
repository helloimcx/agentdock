import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import {
  taskStateFromControllerStatus,
  chatControllerActionForTaskState,
} from '../../../src/pages/Threads/thread-chat-model.js';
import type { BddWorld } from '../support/world.js';

Given<BddWorld>(/^a controller status of "([^"]+)"$/, function (status: string) {
  this.controllerStatus = status;
});

When<BddWorld>(/^the task state is derived$/, function () {
  this.derivedTaskState = taskStateFromControllerStatus(this.controllerStatus! as never);
});

Then<BddWorld>(/^the resulting task state is "([^"]+)"$/, function (taskState: string) {
  assert.equal(this.derivedTaskState, taskState);
});

Given<BddWorld>(/^a task state of "([^"]+)"$/, function (taskState: string) {
  this.inputTaskState = taskState;
});

When<BddWorld>(/^the controller action is derived$/, function () {
  this.controllerActionType = chatControllerActionForTaskState(this.inputTaskState! as never).type;
});

Then<BddWorld>(/^the resulting controller action is "([^"]+)"$/, function (action: string) {
  assert.equal(this.controllerActionType, action);
});
