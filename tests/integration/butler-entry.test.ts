import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLocalAiCoreRoute } from '../../services/local-ai-core/src/runtime/server-routes.js';
import { composeButlerMessage } from '../../services/local-ai-core/src/thread/butler-message-policy.js';

test('Butler routes preserve goal ID domain and reject unrecognized actions or extra path segments', () => {
  const taskId = 'butler-task:02eb1c50-43b2-4ed7-a050-92794724c352';
  assert.deepEqual(parseLocalAiCoreRoute('PUT', '/api/local/v1/butler/profile'), { name: 'butler.profile.configure' });
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/butler/tasks'), { name: 'butler.tasks.list' });
  assert.deepEqual(parseLocalAiCoreRoute('POST', `/butler/tasks/${encodeURIComponent(taskId)}/followup`), { name: 'butler.task.followup', taskId });
  assert.deepEqual(parseLocalAiCoreRoute('POST', `/butler/tasks/${encodeURIComponent(taskId)}/delegations`), { name: 'butler.task.delegate', taskId });
  assert.deepEqual(parseLocalAiCoreRoute('POST', `/butler/tasks/${encodeURIComponent(taskId)}/complete`), { name: 'butler.task.complete', taskId });
  assert.equal(parseLocalAiCoreRoute('POST', `/butler/tasks/${taskId}/approve`), null);
  assert.equal(parseLocalAiCoreRoute('GET', '/butler/profile/extra'), null);
});

test('Butler role always carries delegation tools and treats child output as data', () => {
  const content = composeButlerMessage('现在怎么样？', 'Use lac butler list');
  assert.ok(content.includes('现在怎么样？'));
  assert.ok(content.includes('Use lac butler list'));
  assert.ok(content.includes('[Butler Role]'));
  assert.ok(content.includes('untrusted task data'));
  assert.ok(content.includes('Never approve'));
});
