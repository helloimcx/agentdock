import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import {
  FileSystemInboundAttachmentStore,
  resolveInboundAttachmentUri,
} from '../../services/local-ai-core/src/channel/shared/inbound-attachment-store.js';

test('inbound attachment store streams a platform source into an atomic local file', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'channel-inbound-store-'));
  try {
    const store = new FileSystemInboundAttachmentStore();
    const stored = await store.save({
      directory: tempDir,
      storedFileName: 'message/one-report.pdf',
      displayFileName: 'report.pdf',
      source: {
        open: async () => ({
          stream: Readable.from([Buffer.from('hello '), Buffer.from('world')]),
          mimeType: 'application/pdf',
        }),
      },
    });

    assert.equal(stored.path, join(tempDir, 'message_one-report.pdf'));
    assert.equal(stored.fileName, 'report.pdf');
    assert.equal(stored.mimeType, 'application/pdf');
    assert.equal(stored.size, 11);
    assert.equal(readFileSync(stored.path, 'utf8'), 'hello world');
    assert.deepEqual(readdirSync(tempDir), ['message_one-report.pdf']);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('inbound attachment store removes partial files when the size limit is exceeded', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'channel-inbound-limit-'));
  try {
    const store = new FileSystemInboundAttachmentStore();
    await assert.rejects(() => store.save({
      directory: tempDir,
      storedFileName: 'large.bin',
      displayFileName: 'large.bin',
      maxBytes: 4,
      source: {
        open: async () => ({ stream: Readable.from([Buffer.from('12345')]) }),
      },
    }), /exceeds 4 bytes/);
    assert.deepEqual(readdirSync(tempDir), []);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('inbound attachment store finalizes the filename before commit and can return base64', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'channel-inbound-finalize-'));
  try {
    const store = new FileSystemInboundAttachmentStore();
    const stored = await store.save({
      directory: tempDir,
      storedFileName: 'image-1',
      displayFileName: 'image.png',
      includeBase64: true,
      finalizeStoredFileName: ({ storedFileName, prefix }) => {
        assert.deepEqual(prefix.subarray(0, 4), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        return `${storedFileName}.png`;
      },
      source: {
        open: async () => ({ stream: Readable.from([Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2])]) }),
      },
    });

    assert.equal(stored.path, join(tempDir, 'image-1.png'));
    assert.equal(stored.data, 'iVBORwEC');
    assert.deepEqual(readdirSync(tempDir), ['image-1.png']);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('inbound attachment store removes temporary data when filename finalization fails', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'channel-inbound-finalize-error-'));
  try {
    const store = new FileSystemInboundAttachmentStore();
    await assert.rejects(() => store.save({
      directory: tempDir,
      storedFileName: 'image-1',
      displayFileName: 'image.png',
      finalizeStoredFileName: () => {
        throw new Error('cannot identify image');
      },
      source: {
        open: async () => ({ stream: Readable.from([Buffer.from('image')]) }),
      },
    }), /cannot identify image/);
    assert.deepEqual(readdirSync(tempDir), []);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('inbound attachment URI maps workspace files into sandbox and hides external files', () => {
  assert.equal(resolveInboundAttachmentUri({
    filePath: '/host/project/.agentdock/image.png',
    workspacePath: '/host/project',
    sandboxEnabled: true,
    sandboxWorkspacePath: '/workspace',
  }), 'file:///workspace/.agentdock/image.png');
  assert.equal(resolveInboundAttachmentUri({
    filePath: '/host/state/image.png',
    workspacePath: '/host/project',
    sandboxEnabled: true,
    sandboxWorkspacePath: '/workspace',
  }), undefined);
});
