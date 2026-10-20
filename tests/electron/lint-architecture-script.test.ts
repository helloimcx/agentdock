import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function runArchitectureLint(spec: string, archifyScript?: string) {
  const root = mkdtempSync(join(tmpdir(), 'agentdock-arch-lint-'));
  const architectureDir = join(root, 'docs', 'architecture');
  const home = join(root, 'home');
  mkdirSync(architectureDir, { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(architectureDir, 'spec.json'), spec);
  const archifyPath = join(root, 'archify.mjs');
  if (archifyScript) {
    writeFileSync(archifyPath, archifyScript);
  }

  try {
    return spawnSync(process.execPath, [resolve('scripts/lint-architecture.mjs')], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ARCHIFY_BIN: archifyScript ? archifyPath : '', HOME: home },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('architecture lint skips unavailable Archify after checking JSON syntax', () => {
  const result = runArchitectureLint('{"diagram_type":"architecture"}');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Archify CLI not found/);
  assert.match(result.stderr, /provider validation skipped/i);
});

test('architecture lint still rejects malformed JSON when Archify is unavailable', () => {
  const result = runArchitectureLint('{ invalid json');

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Failed to parse JSON/);
});

test('architecture lint still fails when an installed Archify provider rejects a specification', () => {
  const result = runArchitectureLint(
    '{"diagram_type":"architecture"}',
    "process.stdout.write(JSON.stringify({ ok: false, error: 'schema rejected' })); process.exitCode = 1;",
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Validation failed/);
  assert.match(result.stderr, /schema rejected/);
});
