import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolIndex } from '../../services/local-ai-core/src/skills/tool-index.js';

test('tool index detects presence of node executable on PATH', () => {
  const toolIndex = new ToolIndex();
  const result = toolIndex.checkTool('node');
  assert.equal(result.available, true);
  assert.equal(typeof result.path, 'string');
});

test('tool index detects non-existent tool as missing', () => {
  const toolIndex = new ToolIndex();
  const result = toolIndex.checkTool('non_existent_tool_xyz_98765');
  assert.equal(result.available, false);
  assert.equal(result.path, undefined);
});

test('tool index batch checks tools and categorizes available and missing', () => {
  const toolIndex = new ToolIndex();
  const result = toolIndex.checkTools(['node', 'non_existent_tool_xyz_98765']);
  assert.deepEqual(result.available, ['node']);
  assert.deepEqual(result.missing, ['non_existent_tool_xyz_98765']);
});

test('tool index caches results and respects cache invalidation', () => {
  let callCount = 0;
  const customLookup = (cmd: string) => {
    callCount++;
    return cmd === 'mock-tool' ? '/usr/bin/mock-tool' : null;
  };
  const toolIndex = new ToolIndex({ resolver: customLookup });

  const r1 = toolIndex.checkTool('mock-tool');
  assert.equal(r1.available, true);
  assert.equal(callCount, 1);

  const r2 = toolIndex.checkTool('mock-tool');
  assert.equal(r2.available, true);
  assert.equal(callCount, 1); // cached

  toolIndex.clearCache();
  const r3 = toolIndex.checkTool('mock-tool');
  assert.equal(r3.available, true);
  assert.equal(callCount, 2); // re-resolved
});
