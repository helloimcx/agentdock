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

test('heap watcher fires onSustainedError once after a full window of error samples', () => {
  const lines: string[] = [];
  const pinned: Sample = { heapUsed: heapUsedOfLimit(0.94), rss: rssOf(0.9), external: 0 };
  let fired = 0;
  const watcher = createHeapWatcher({
    log: (message) => lines.push(message),
    limitBytes: 1_000_000_000,
    sample: () => pinned,
    sustainedWindowSamples: 4,
    onSustainedError: () => {
      fired += 1;
    },
  });
  for (let tick = 0; tick < 10; tick += 1) {
    watcher.check();
  }
  assert.equal(fired, 1, `expected one sustained-error callback, got ${fired}`);
  assert.ok(
    lines.some((line) => line.includes('sustained') && line.includes('94%')),
    `expected a sustained line, got ${JSON.stringify(lines)}`,
  );
});

test('heap watcher re-arms the sustained episode after recovery', () => {
  const lines: string[] = [];
  const samples: Sample[] = [
    { heapUsed: heapUsedOfLimit(0.95), rss: rssOf(0.9), external: 0 },
    { heapUsed: heapUsedOfLimit(0.95), rss: rssOf(0.9), external: 0 },
    { heapUsed: heapUsedOfLimit(0.30), rss: rssOf(0.3), external: 0 },
    { heapUsed: heapUsedOfLimit(0.95), rss: rssOf(0.9), external: 0 },
    { heapUsed: heapUsedOfLimit(0.95), rss: rssOf(0.9), external: 0 },
    { heapUsed: heapUsedOfLimit(0.95), rss: rssOf(0.9), external: 0 },
    { heapUsed: heapUsedOfLimit(0.95), rss: rssOf(0.9), external: 0 },
  ];
  const lastSample = samples[samples.length - 1];
  const totalChecks = samples.length + 1;
  let fired = 0;
  const watcher = createHeapWatcher({
    log: (message) => lines.push(message),
    limitBytes: 1_000_000_000,
    sample: () => samples.shift() ?? lastSample,
    sustainedWindowSamples: 3,
    onSustainedError: () => {
      fired += 1;
    },
  });
  for (let tick = 0; tick < totalChecks; tick += 1) {
    watcher.check();
  }
  assert.equal(fired, 1, `expected one fire in the second episode only, got ${fired}`);
});

// 2026-11-16 prod death: error.log shows one full hour of 87-92% sawtooth
// around the 90% error line (warn dips reset any consecutive streak) and the
// process still died by V8 abort at 15:35. A window mean must catch this.
test('sawtooth oscillation around the error line still fires (2026-11-16 death pattern)', () => {
  const lines: string[] = [];
  let tick = 0;
  let fired = 0;
  const watcher = createHeapWatcher({
    log: (message) => lines.push(message),
    limitBytes: 1_000_000_000,
    sample: () => {
      tick += 1;
      const fraction = tick % 2 === 0 ? 0.92 : 0.87;
      return { heapUsed: heapUsedOfLimit(fraction), rss: rssOf(0.9), external: 0 };
    },
    onSustainedError: () => {
      fired += 1;
    },
  });
  for (let check = 0; check < 35; check += 1) {
    watcher.check();
  }
  assert.equal(fired, 1, `expected one fire under oscillation, got ${fired}`);
  const sustained = lines.filter((line) => line.includes('sustained window'));
  assert.equal(sustained.length, 1, `expected one sustained line, got ${JSON.stringify(lines)}`);
  assert.ok(sustained[0].includes('90%'), sustained[0]);
});

test('a transient spike does not fire the sustained callback', () => {
  let fired = 0;
  const samples: Sample[] = [
    { heapUsed: heapUsedOfLimit(0.96), rss: rssOf(0.9), external: 0 },
    { heapUsed: heapUsedOfLimit(0.95), rss: rssOf(0.9), external: 0 },
    { heapUsed: heapUsedOfLimit(0.94), rss: rssOf(0.9), external: 0 },
  ];
  const settled: Sample = { heapUsed: heapUsedOfLimit(0.40), rss: rssOf(0.5), external: 0 };
  const watcher = createHeapWatcher({
    log: () => {},
    limitBytes: 1_000_000_000,
    sample: () => samples.shift() ?? settled,
    onSustainedError: () => {
      fired += 1;
    },
  });
  for (let check = 0; check < 40; check += 1) {
    watcher.check();
  }
  assert.equal(fired, 0, `a 3-sample spike must not fire the window callback, got ${fired}`);
});

test('the sustained episode re-arms only after the window mean recovers below warn', () => {
  const samples: Sample[] = [
    { heapUsed: heapUsedOfLimit(0.95), rss: rssOf(0.9), external: 0 },
    { heapUsed: heapUsedOfLimit(0.95), rss: rssOf(0.9), external: 0 },
    { heapUsed: heapUsedOfLimit(0.95), rss: rssOf(0.9), external: 0 },
    { heapUsed: heapUsedOfLimit(0.30), rss: rssOf(0.3), external: 0 },
    { heapUsed: heapUsedOfLimit(0.30), rss: rssOf(0.3), external: 0 },
    { heapUsed: heapUsedOfLimit(0.30), rss: rssOf(0.3), external: 0 },
    { heapUsed: heapUsedOfLimit(0.95), rss: rssOf(0.9), external: 0 },
    { heapUsed: heapUsedOfLimit(0.95), rss: rssOf(0.9), external: 0 },
    { heapUsed: heapUsedOfLimit(0.95), rss: rssOf(0.9), external: 0 },
    { heapUsed: heapUsedOfLimit(0.95), rss: rssOf(0.9), external: 0 },
  ];
  const lastSample = samples[samples.length - 1];
  const totalChecks = samples.length + 1;
  let fired = 0;
  const watcher = createHeapWatcher({
    log: () => {},
    limitBytes: 1_000_000_000,
    sample: () => samples.shift() ?? lastSample,
    sustainedWindowSamples: 3,
    onSustainedError: () => {
      fired += 1;
    },
  });
  for (let check = 0; check < totalChecks; check += 1) {
    watcher.check();
  }
  assert.equal(fired, 2, `expected fire, recovery, then a second fire, got ${fired}`);
});

test('sustainedWindowSamples=1 fires on the first error sample', () => {
  let fired = 0;
  const watcher = createHeapWatcher({
    log: () => {},
    limitBytes: 1_000_000_000,
    sample: () => ({ heapUsed: heapUsedOfLimit(0.95), rss: rssOf(0.9), external: 0 }),
    sustainedWindowSamples: 1,
    onSustainedError: () => {
      fired += 1;
    },
  });
  watcher.check();
  assert.equal(fired, 1, `expected fire on first error sample, got ${fired}`);
});

test('sustainedWindowSamples=0 disables the sustained callback', () => {
  let fired = 0;
  const watcher = createHeapWatcher({
    log: () => {},
    limitBytes: 1_000_000_000,
    sample: () => ({ heapUsed: heapUsedOfLimit(0.95), rss: rssOf(0.9), external: 0 }),
    sustainedWindowSamples: 0,
    onSustainedError: () => {
      fired += 1;
    },
  });
  for (let tick = 0; tick < 40; tick += 1) {
    watcher.check();
  }
  assert.equal(fired, 0, `expected no fire when disabled, got ${fired}`);
});

test('stop() clears the sustained window so a restarted watcher rebuilds it', () => {
  let fired = 0;
  const watcher = createHeapWatcher({
    log: () => {},
    limitBytes: 1_000_000_000,
    sample: () => ({ heapUsed: heapUsedOfLimit(0.95), rss: rssOf(0.9), external: 0 }),
    sustainedWindowSamples: 3,
    onSustainedError: () => {
      fired += 1;
    },
  });
  watcher.check();
  watcher.check();
  watcher.stop();
  watcher.check();
  watcher.check();
  assert.equal(fired, 0, 'stale streak must not fire early after stop');
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
