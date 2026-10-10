import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyWorkspaceWrite, prepareWorkspaceWrite } from '../../services/local-ai-core/src/agents/pi-durable/workspace-write.js';

test('Pi Durable Core writes new and existing workspace text atomically after a stable baseline', () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-durable-write-safe-'));
  try {
    mkdirSync(join(root, 'src'));
    const created = prepareWorkspaceWrite(root, 'src/new.txt', 'created\n');
    assert.equal(applyWorkspaceWrite(created), 'written');
    assert.equal(readFileSync(join(root, 'src/new.txt'), 'utf8'), 'created\n');

    const overwrite = prepareWorkspaceWrite(root, 'src/new.txt', 'updated\n');
    assert.equal(applyWorkspaceWrite(overwrite), 'written');
    assert.equal(readFileSync(join(root, 'src/new.txt'), 'utf8'), 'updated\n');

    assert.equal(applyWorkspaceWrite(overwrite), 'already-applied');
    assert.equal(readFileSync(join(root, 'src/new.txt'), 'utf8'), 'updated\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Pi Durable Core rejects workspace escapes, symlinks, binary text, and oversized writes', () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-durable-write-boundary-'));
  const outside = mkdtempSync(join(tmpdir(), 'pi-durable-write-outside-'));
  try {
    writeFileSync(join(outside, 'secret.txt'), 'secret');
    symlinkSync(outside, join(root, 'escape'));
    symlinkSync(join(outside, 'secret.txt'), join(root, 'target-link.txt'));
    assert.throws(() => prepareWorkspaceWrite(root, '../outside.txt', 'x'), /relative|workspace/i);
    assert.throws(() => prepareWorkspaceWrite(root, '/outside.txt', 'x'), /relative|workspace/i);
    assert.throws(() => prepareWorkspaceWrite(root, 'C:\\outside.txt', 'x'), /relative|workspace/i);
    assert.throws(() => prepareWorkspaceWrite(root, 'escape/secret.txt', 'x'), /workspace|symbolic/i);
    assert.throws(() => prepareWorkspaceWrite(root, 'target-link.txt', 'x'), /symbolic/i);
    assert.throws(() => prepareWorkspaceWrite(root, 'missing/file.txt', 'x'), /parent|directory/i);
    assert.throws(() => prepareWorkspaceWrite(root, 'binary.txt', 'a\0b'), /text|binary/i);
    assert.throws(() => prepareWorkspaceWrite(root, 'large.txt', 'x'.repeat(64 * 1024 + 1)), /64 KiB|size/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('Pi Durable Core rejects an approval whose target changed while it was pending', () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-durable-write-conflict-'));
  try {
    const target = join(root, 'existing.txt');
    writeFileSync(target, 'original');
    const approval = prepareWorkspaceWrite(root, 'existing.txt', 'approved replacement');
    writeFileSync(target, 'external change');
    assert.throws(() => applyWorkspaceWrite(approval), /conflict|changed/i);
    assert.equal(readFileSync(target, 'utf8'), 'external change');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
