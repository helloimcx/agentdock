import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ManagedSkillCatalog } from '../../services/local-ai-core/src/runtime/managed-skill-catalog.js';

const sourceSkillPath = join(process.cwd(), 'electron', 'managed-skills', 'condition-trigger', 'SKILL.md');

test('condition trigger skill requires the staged two-approval workflow and helper owns exact LAC requests', () => {
  const content = readFileSync(sourceSkillPath, 'utf8');
  assert.match(content, /temporary source bundle/i);
  assert.match(content, /manifest\.json.*entrypoint.*fixtures.*tests/is);
  assert.match(content, /stage/i);
  assert.match(content, /stop.*test authorization/is);
  assert.match(content, /sandbox test/i);
  assert.match(content, /stop.*final.*approval/is);
  assert.match(content, /create.*Automation/is);
  assert.match(content, /Do not write.*managed script directory/i);
  assert.doesNotMatch(content, /automations\/scripts\/[^\s]+\/(?:sha|hash)/i);

  const helper = readFileSync(join(process.cwd(), 'electron', 'managed-skills', 'condition-trigger', 'scripts', 'register-condition-trigger.sh'), 'utf8');
  assert.match(helper, /lac script stage --script/);
  assert.match(helper, /lac script test-approval/);
  assert.match(helper, /lac script test/);
  assert.match(helper, /lac script enable-approval/);
  assert.match(helper, /lac automation add --script-version/);
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
