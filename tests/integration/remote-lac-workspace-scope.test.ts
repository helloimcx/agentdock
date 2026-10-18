import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { registerSchedulerHandlers } from '../../apps/daemon/src/runtime/handlers/scheduler-handler.js';
import type { RouteHandler } from '../../apps/daemon/src/runtime/server-helpers.js';

test('scheduler ID routes reject jobs outside the supplied workspace', async () => {
  const calls: string[] = [];
  const scheduledJobs = {
    getJob: () => {
      calls.push('get');
      return { id: 'job:other', workspaceId: 'workspace:other' };
    },
    listJobRuns: () => { calls.push('runs'); return []; },
    runJobNow: () => { calls.push('run'); return {}; },
    updateJob: () => { calls.push('update'); return {}; },
    deleteJob: () => { calls.push('delete'); return {}; },
  };
  const handlers = new Map<string, RouteHandler>();
  registerSchedulerHandlers(handlers, scheduledJobs as any);

  for (const name of ['scheduler.job.get', 'scheduler.job.runs', 'scheduler.job.run', 'scheduler.job.update', 'scheduler.job.delete']) {
    const handler = handlers.get(name);
    assert.ok(handler, `${name} handler must be registered`);
    await assert.rejects(
      handler!({ name, jobId: 'job:other' } as any, Readable.from([]) as any, {} as any,
        new URL('http://127.0.0.1/api/local/v1/scheduler/jobs/job%3Aother?workspace_id=workspace%3Acurrent')),
      /Scheduled job not found/,
      name,
    );
  }
  assert.deepEqual(calls, ['get', 'get', 'get', 'get', 'get']);
});
