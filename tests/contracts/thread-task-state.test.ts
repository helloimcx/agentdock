import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chatControllerActionForTaskState,
  taskStateFromControllerStatus,
} from '../../src/pages/Threads/thread-chat-model.js';

test('chatControllerActionForTaskState maps each chat task state to a named controller action', () => {
  assert.deepEqual(chatControllerActionForTaskState('idle'), { type: 'settled' });
  assert.deepEqual(chatControllerActionForTaskState('running'), { type: 'stream_started' });
  assert.deepEqual(chatControllerActionForTaskState('awaiting_input'), { type: 'input_requested' });
  assert.deepEqual(chatControllerActionForTaskState('awaiting_permission'), { type: 'permission_requested' });
  assert.deepEqual(chatControllerActionForTaskState('permission_submitted'), { type: 'permission_submitted' });
  assert.deepEqual(chatControllerActionForTaskState('stopping'), { type: 'stop_started' });
  assert.deepEqual(chatControllerActionForTaskState('error'), { type: 'failed' });
});

test('taskStateFromControllerStatus narrows the controller status without a cast', () => {
  assert.equal(taskStateFromControllerStatus('idle'), 'idle');
  assert.equal(taskStateFromControllerStatus('running'), 'running');
  assert.equal(taskStateFromControllerStatus('awaiting_input'), 'awaiting_input');
  assert.equal(taskStateFromControllerStatus('error'), 'error');
  assert.equal(taskStateFromControllerStatus('stopping'), 'stopping');
  // Terminal controller statuses Threads never dispatches map back to 'error'.
  assert.equal(taskStateFromControllerStatus('failed'), 'error');
  assert.equal(taskStateFromControllerStatus('timed_out'), 'error');
  // Session/Web-only statuses map defensively to 'running'.
  assert.equal(taskStateFromControllerStatus('sending'), 'running');
  assert.equal(taskStateFromControllerStatus('waiting'), 'running');
  assert.equal(taskStateFromControllerStatus('polling'), 'running');
  assert.equal(taskStateFromControllerStatus('activating'), 'running');
});
