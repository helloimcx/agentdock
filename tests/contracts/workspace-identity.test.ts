import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopProjectWorkspaceId } from '../../src/pages/Desktop/workspace-model.js';

test('desktop workspace operations keep using stable identity after a display-name change', () => {
  assert.equal(desktopProjectWorkspaceId({
    workspace_id: 'workspace-stable',
    name: 'Renamed workspace',
    agent: { type: 'pi' },
    platforms: [],
  }), 'workspace-stable');
});

test('desktop workspace identity falls back to legacy project names', () => {
  assert.equal(desktopProjectWorkspaceId({
    name: 'Legacy workspace',
    agent: { type: 'pi' },
    platforms: [],
  }), 'Legacy workspace');
});
