import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseLocalAiCoreRoute } from '../../services/local-ai-core/src/runtime/server-routes.js';
import { registerFilesystemHandlers } from '../../services/local-ai-core/src/runtime/handlers/fs-handler.js';
import type { RouteHandler } from '../../services/local-ai-core/src/runtime/server-helpers.js';

test('parseLocalAiCoreRoute recognizes fs.directories route', () => {
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/fs/directories'), { name: 'fs.directories' });
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/fs/directories'), { name: 'fs.directories' });
});

test('fs-handler lists directories, filters files, and handles invalid paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentdock-fs-test-'));
  await mkdir(join(root, 'alpha'));
  await mkdir(join(root, 'beta'));
  await mkdir(join(root, '.hidden_dir'));
  await writeFile(join(root, 'regular_file.txt'), 'hello');

  try {
    const handlers = new Map<string, RouteHandler>();
    registerFilesystemHandlers(handlers);
    const handler = handlers.get('fs.directories');
    assert.ok(handler, 'fs.directories handler should be registered');

    // 1. Success case: POST with target path
    let responseBody: any = null;
    const fakeRes: any = {
      statusCode: 200,
      setHeader: () => {},
      end: (data: string) => { responseBody = JSON.parse(data); },
    };

    const fakeReq: any = {
      method: 'POST',
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from(JSON.stringify({ path: root }));
      },
    };

    await handler({ name: 'fs.directories' } as any, fakeReq, fakeRes, new URL('http://127.0.0.1/api/local/v1/fs/directories'));
    assert.equal(fakeRes.statusCode, 200);
    assert.equal(responseBody.ok, true);
    assert.equal(responseBody.data.path, root);
    assert.deepEqual(responseBody.data.directories, ['alpha', 'beta']);

    // 2. Success case: includeHidden = true
    await handler(
      { name: 'fs.directories' } as any,
      fakeReq,
      fakeRes,
      new URL('http://127.0.0.1/api/local/v1/fs/directories?includeHidden=true')
    );
    assert.equal(fakeRes.statusCode, 200);
    assert.ok(responseBody.data.directories.includes('.hidden_dir'));

    // 3. Error case: path does not exist
    const nonExistentReq: any = {
      method: 'POST',
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from(JSON.stringify({ path: join(root, 'non-existent') }));
      },
    };
    await handler({ name: 'fs.directories' } as any, nonExistentReq, fakeRes, new URL('http://127.0.0.1/api/local/v1/fs/directories'));
    assert.equal(fakeRes.statusCode, 400);
    assert.equal(responseBody.ok, false);
    assert.match(responseBody.error, /does not exist/);

    // 4. Error case: target is a file, not a directory
    const fileReq: any = {
      method: 'POST',
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from(JSON.stringify({ path: join(root, 'regular_file.txt') }));
      },
    };
    await handler({ name: 'fs.directories' } as any, fileReq, fakeRes, new URL('http://127.0.0.1/api/local/v1/fs/directories'));
    assert.equal(fakeRes.statusCode, 400);
    assert.equal(responseBody.ok, false);
    assert.match(responseBody.error, /not a directory/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
