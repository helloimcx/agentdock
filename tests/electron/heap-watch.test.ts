import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { createHeapWatcher } from '../../apps/daemon/src/kernel/heap-watch.js';

interface Sample {
  heapUsed: number;
  rss: number;
  external: number;
}

function heapUsedOfLimit(fraction: number, limit = 1_000_000_000) {
  return Math.round(limit * fraction);
}

function rssOf(fraction: number) {
  return Math.round(2_000_000_000 * fraction);
}

test('heap watcher logs warn and error once each while heap climbs toward the limit', () => {
  const lines: string[] = [];
  const samples: Sample[] = [
    { heapUsed: heapUsedOfLimit(0.10), rss: rssOf(0.2), external: 30_000_000 },
    { heapUsed: heapUsedOfLimit(0.78), rss: rssOf(0.6), external: 30_000_000 },
    { heapUsed: heapUsedOfLimit(0.92), rss: rssOf(0.9), external: 30_000_000 },
    { heapUsed: heapUsedOfLimit(0.93), rss: rssOf(0.95), external: 30_000_000 },
  ];
  const lastSample = samples[samples.length - 1];
  const watcher = createHeapWatcher({
    log: (message) => lines.push(message),
    limitBytes: 1_000_000_000,
    sample: () => samples.shift() ?? lastSample,
  });
  watcher.check();
  watcher.check();
  watcher.check();
  watcher.check();
  const warn = lines.filter((line) => line.includes('level=warn'));
  const error = lines.filter((line) => line.includes('level=error'));
  assert.equal(warn.length, 1, `expected one warn line, got ${JSON.stringify(lines)}`);
  assert.equal(error.length, 1, `expected one error line, got ${JSON.stringify(lines)}`);
  assert.ok(warn[0].includes('78%'), warn[0]);
  assert.ok(error[0].includes('92%'), error[0]);
  assert.match(warn[0], /\[heap-watch\]/);
  assert.match(warn[0], /rss=/);
});

test('heap watcher does not spam while steady above a threshold', () => {
  const lines: string[] = [];
  let tick = 0;
  const steadyHigh: Sample = { heapUsed: heapUsedOfLimit(0.85), rss: rssOf(0.7), external: 0 };
  const watcher = createHeapWatcher({
    log: (message) => lines.push(message),
    limitBytes: 1_000_000_000,
    sample: () => steadyHigh,
  });
  for (tick = 0; tick < 20; tick += 1) {
    watcher.check();
  }
  assert.equal(lines.length, 1, `expected a single line for steady-high heap, got ${lines.length}`);
  assert.ok(lines[0].includes('level=warn'));
});

test('heap watcher re-arms after recovery so a later crossing logs again', () => {
  const lines: string[] = [];
  const samples: Sample[] = [
    { heapUsed: heapUsedOfLimit(0.80), rss: rssOf(0.6), external: 0 },
    { heapUsed: heapUsedOfLimit(0.30), rss: rssOf(0.3), external: 0 },
    { heapUsed: heapUsedOfLimit(0.82), rss: rssOf(0.6), external: 0 },
  ];
  const lastSample = samples[samples.length - 1];
  const watcher = createHeapWatcher({
    log: (message) => lines.push(message),
    limitBytes: 1_000_000_000,
    sample: () => samples.shift() ?? lastSample,
  });
  watcher.check();
  watcher.check();
  watcher.check();
  const warn = lines.filter((line) => line.includes('level=warn'));
  assert.equal(warn.length, 2, `expected warn on both crossings, got ${JSON.stringify(lines)}`);
  assert.equal(lines.filter((line) => line.includes('recovered')).length, 1);
});

test('heap watcher start() samples on the interval and stop() clears it', () => {
  const lines: string[] = [];
  using timers = mock.timers;
  timers.enable({ apis: ['setInterval'] });
  const watcher = createHeapWatcher({
    log: (message) => lines.push(message),
    limitBytes: 1_000_000_000,
    sample: () => ({ heapUsed: heapUsedOfLimit(0.95), rss: rssOf(0.9), external: 0 }),
    intervalMs: 30_000,
  });
  watcher.start();
  timers.tick(30_000);
  timers.tick(30_000);
  assert.equal(lines.length, 1, `expected one error line while running, got ${JSON.stringify(lines)}`);
  watcher.stop();
  watcher.stop();
  timers.tick(120_000);
  assert.equal(lines.length, 1, `expected no further lines after stop, got ${JSON.stringify(lines)}`);
});
