import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { ManagedSkillCatalog } from '../../services/local-ai-core/src/runtime/managed-skill-catalog.js';

const sourceSkillPath = join(process.cwd(), 'electron', 'managed-skills', 'condition-trigger', 'SKILL.md');

test('condition trigger skill requires the staged two-approval workflow and helper owns exact LAC requests', () => {
  const content = readFileSync(sourceSkillPath, 'utf8');
  assert.match(content, /temporary source bundle/i);
  assert.match(content, /create.*Automation Script.*record/is);
  assert.match(content, /manifest\.json.*entrypoint.*fixtures.*tests/is);
  assert.match(content, /stage/i);
  assert.match(content, /stop.*test authorization/is);
  assert.match(content, /apply.*approved.*decision.*before.*test/is);
  assert.match(content, /sandbox test/i);
  assert.match(content, /stop.*final.*approval/is);
  assert.match(content, /apply.*approved.*decision.*before.*Automation/is);
  assert.match(content, /create.*Automation/is);
  assert.match(content, /Do not write.*managed script directory/i);
  assert.doesNotMatch(content, /automations\/scripts\/[^\s]+\/(?:sha|hash)/i);

  const helper = readFileSync(join(process.cwd(), 'electron', 'managed-skills', 'condition-trigger', 'scripts', 'register-condition-trigger.sh'), 'utf8');
  assert.match(helper, /lac script stage --script/);
  assert.match(helper, /lac script create --title/);
  assert.match(helper, /lac script test-approval/);
  assert.match(helper, /lac script test/);
  assert.match(helper, /lac script enable-approval/);
  assert.match(helper, /lac script approve/);
  assert.match(helper, /lac automation add --script-version/);
  assert.match(helper, /--source-file/);
  assert.doesNotMatch(helper, /--source-json/);
  assert.match(helper, /openSync.*O_NOFOLLOW.*fstatSync/s);
  assert.match(helper, /MAX_FILES.*MAX_BYTES/s);
  assert.match(helper, /O_NOFOLLOW.*fstatSync.*readSync/s);
});

test('managed skill catalog loads exact source and packaged condition-trigger skill layouts', () => {
  const source = new ManagedSkillCatalog({ rootDir: join(process.cwd(), 'electron', 'managed-skills') }).get('condition-trigger');
  assert(source);
  assert.equal(source.content, readFileSync(sourceSkillPath, 'utf8'));
  const packagedRoot = join(process.cwd(), 'dist-electron', 'electron', 'managed-skills');
  assert.equal(existsSync(join(packagedRoot, 'condition-trigger', 'SKILL.md')), true);
  const packaged = new ManagedSkillCatalog({ rootDir: packagedRoot }).get('condition-trigger');
  assert(packaged);
  assert.equal(packaged.content, source.content);
});

test('condition trigger helper creates source-only staging input through a temporary file and rejects symlink roots', async () => {
  const root = mkdtempSync(join(tmpdir(), 'condition-trigger-skill-'));
  const source = join(root, 'source');
  const bin = join(root, 'bin');
  const captureArgs = join(root, 'args');
  const captureBody = join(root, 'body');
  mkdirSync(source);
  mkdirSync(bin);
  writeFileSync(join(source, 'manifest.json'), '{}');
  writeFileSync(join(source, 'check.js'), '#!/usr/bin/env node\n');
  const fakeLac = join(bin, 'lac');
  writeFileSync(fakeLac, '#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURE_ARGS"\nfor argument in "$@"; do last="$argument"; done\ncat "$last" > "$CAPTURE_BODY"\n');
  chmodSync(fakeLac, 0o755);
  const helper = join(process.cwd(), 'electron', 'managed-skills', 'condition-trigger', 'scripts', 'register-condition-trigger.sh');
  const run = (args: string[]) => new Promise<void>((resolve, reject) => {
    execFile(helper, args, {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH || ''}`, CAPTURE_ARGS: captureArgs, CAPTURE_BODY: captureBody },
    }, (error) => error ? reject(error) : resolve());
  });
  try {
    await run(['stage', 'script-1', source]);
    const args = readFileSync(captureArgs, 'utf8').trim().split('\n');
    assert.deepEqual(args.slice(0, 5), ['script', 'stage', '--script', 'script-1', '--source-file']);
    assert.equal(existsSync(args[5]!), false, 'temporary serialized source is removed after lac exits');
    assert.deepEqual(JSON.parse(readFileSync(captureBody, 'utf8')), [
      { path: 'check.js', content: '#!/usr/bin/env node\n' },
      { path: 'manifest.json', content: '{}' },
    ]);
    const symlink = join(root, 'source-link');
    symlinkSync(source, symlink);
    await assert.rejects(run(['stage', 'script-1', symlink]), /source root must be a non-symlink directory/);
    mkdirSync(join(source, 'nested'));
    await assert.rejects(run(['stage', 'script-1', source]), /source bundle must be flat/);
    rmSync(join(source, 'nested'), { recursive: true, force: true });
    for (let index = 0; index < 65; index += 1) writeFileSync(join(source, `limit-${index}.txt`), 'x');
    await assert.rejects(run(['stage', 'script-1', source]), /source bundle exceeds 64 files/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
