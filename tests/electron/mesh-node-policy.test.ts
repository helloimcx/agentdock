import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, chmod, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { NodeCapabilities } from '../../services/local-ai-core/src/mesh/node-capabilities.js';
import { createPrivateJson, readPrivateJson, writePrivateJson } from '../../services/local-ai-core/src/mesh/node-credentials.js';
import type { MeshExecution } from '../../packages/contracts/src/mesh.js';

test('Node independently rejects shell without opt-in, oversized files and command output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentdock-node-policy-'));
  const request = (capability: MeshExecution['capability'], args: Record<string, unknown>): MeshExecution => ({
    id: `mesh-request:${randomUUID()}`, nodeId: `node:${randomUUID()}`, capability, args, status: 'running', createdAt: new Date().toISOString(),
  });
  try {
    const disabled = new NodeCapabilities(root);
    await assert.rejects(disabled.execute(request('shell.exec', { program: process.execPath }), new AbortController().signal), /disabled/);
    await writeFile(join(root, 'large'), Buffer.alloc(32 * 1024 + 1));
    await assert.rejects(disabled.execute(request('filesystem.read', { path: 'large' }), new AbortController().signal), /32 KiB/);
    const enabled = new NodeCapabilities(root, true);
    await assert.rejects(enabled.execute(request('shell.exec', { program: process.execPath, arguments: ['-e', 'process.stdout.write("x".repeat(40000))'] }), new AbortController().signal), /32 KiB/);
    const controller = new AbortController();
    const execution = enabled.execute(request('shell.exec', { program: process.execPath, arguments: ['-e', 'setTimeout(()=>{},5000)'] }), controller.signal);
    controller.abort();
    await assert.rejects(execution, /cancelled/);
    await assert.rejects(disabled.execute(request('filesystem.read', { path: root }), new AbortController().signal), /relative/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Credential files use private permissions, cannot overwrite and reserve before enrollment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentdock-mesh-credentials-'));
  try {
    const file = join(root, 'credentials.json');
    await writePrivateJson(file, { token: 'test-only-token' });
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await readPrivateJson(file)).token, 'test-only-token');
    let consumed = false;
    await assert.rejects(createPrivateJson(file, async () => { consumed = true; return {}; }), /EEXIST/);
    assert.equal(consumed, false);
    assert.match(await readFile(file, 'utf8'), /test-only-token/);
    await chmod(file, 0o644);
    await assert.rejects(readPrivateJson(file), /0600/);
    const failed = join(root, 'failed.json');
    await assert.rejects(createPrivateJson(failed, async () => { throw new Error('enrollment denied'); }), /denied/);
    await assert.rejects(stat(failed), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Node capabilities safely writes files, creates parent directories, and rejects escapes and oversized content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentdock-mesh-write-'));
  const request = (args: Record<string, unknown>): MeshExecution => ({
    id: `mesh-request:${randomUUID()}`, nodeId: `node:${randomUUID()}`, capability: 'filesystem.write', args, status: 'running', createdAt: new Date().toISOString(),
  });
  try {
    const node = new NodeCapabilities(root);
    // Write new file in nested directory
    const res = await node.execute(request({ path: 'nested/sub/hello.txt', content: 'Hello Mesh Write!' }), new AbortController().signal) as { path: string; bytes: number };
    assert.equal(res.path, 'nested/sub/hello.txt');
    assert.equal(res.bytes, 17);
    assert.equal(await readFile(join(root, 'nested/sub/hello.txt'), 'utf8'), 'Hello Mesh Write!');

    // Base64 encoding write
    const b64Res = await node.execute(request({ path: 'binary.bin', content: Buffer.from('bin-data').toString('base64'), encoding: 'base64' }), new AbortController().signal) as { bytes: number };
    assert.equal(b64Res.bytes, 8);
    assert.equal(await readFile(join(root, 'binary.bin'), 'utf8'), 'bin-data');

    // Overwrite existing file atomically
    await node.execute(request({ path: 'nested/sub/hello.txt', content: 'Overwritten content' }), new AbortController().signal);
    assert.equal(await readFile(join(root, 'nested/sub/hello.txt'), 'utf8'), 'Overwritten content');

    // Rejection of path traversal
    await assert.rejects(node.execute(request({ path: '../escape.txt', content: 'bad' }), new AbortController().signal), /outside the approved root/);
    await assert.rejects(node.execute(request({ path: '/etc/passwd', content: 'bad' }), new AbortController().signal), /relative path/);

    // Rejection of oversized file (> 1 MiB)
    await assert.rejects(node.execute(request({ path: 'huge.txt', content: 'x'.repeat(1024 * 1024 + 1) }), new AbortController().signal), /1 MiB/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

