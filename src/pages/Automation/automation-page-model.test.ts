import test from 'node:test';
import assert from 'node:assert/strict';
import { originFilterFromSearch } from './automation-page-model';

test('originFilterFromSearch keeps the origin kinds emitted by the legacy entry routes', () => {
  assert.equal(originFilterFromSearch(new URLSearchParams('origin=scheduled-job').get('origin')), 'scheduled-job');
  assert.equal(originFilterFromSearch(new URLSearchParams('origin=automation-monitor').get('origin')), 'automation-monitor');
  assert.equal(originFilterFromSearch(new URLSearchParams('origin=native').get('origin')), 'native');
});

test('originFilterFromSearch falls back to all for absent or unknown values', () => {
  assert.equal(originFilterFromSearch(null), 'all');
  assert.equal(originFilterFromSearch(''), 'all');
  assert.equal(originFilterFromSearch('everything'), 'all');
  assert.equal(originFilterFromSearch('Scheduled-Job'), 'all');
});
