import test from 'node:test';
import assert from 'node:assert/strict';
import { composeAgentMessage } from '../../services/local-ai-core/src/thread/agent-message-policy.js';
import { ManagedSkillCatalog } from '../../services/local-ai-core/src/runtime/managed-skill-catalog.js';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

test('agent message policy is owned by Local Core and includes selected knowledge context', () => {
  const message = composeAgentMessage('Summarize the design', [
    { id: 'kb-1', name: 'Architecture notes' },
  ]);

  assert.match(message, /\[Scheduler Tools\]/);
  assert.match(message, /\[Monitor Tools\]/);
  assert.match(message, /\[Channel Tools\]/);
  assert.match(message, /id: kb-1 \| name: Architecture notes/);
  assert.match(message, /\[User Message\]\nSummarize the design\n\[\/User Message\]/);
});

test('agent message policy leaves slash commands untouched', () => {
  assert.equal(composeAgentMessage('/agent use pi'), '/agent use pi');
});

test('agent message policy injects the exact managed condition trigger skill only for condition automations', () => {
  const catalog = new ManagedSkillCatalog({ rootDir: join(process.cwd(), 'electron', 'managed-skills') });
  const skill = catalog.get('condition-trigger');
  assert(skill);
  const matching = composeAgentMessage('Create an automation when a script condition matches.', [], catalog);
  assert.match(matching, new RegExp(escapeRegex(skill.content)));
  const nonMatching = composeAgentMessage('Schedule a reminder every day at noon.', [], catalog);
  assert.doesNotMatch(nonMatching, /\[Condition Trigger Skill\]/);
});

test('condition trigger skill is injected for explicit Chinese condition automation requests, not generic trigger words', () => {
  const catalog = new ManagedSkillCatalog({ rootDir: join(process.cwd(), 'electron', 'managed-skills') });
  for (const message of ['创建一个条件自动化，在脚本条件满足时触发', '请设置条件触发任务', '为这个脚本条件创建自动化']) {
    assert.match(composeAgentMessage(message, [], catalog), /\[Condition Trigger Skill\]/);
  }
  for (const message of ['触发一次普通任务', 'Please trigger a response now.', '解释条件自动化的概念，但不要创建它', 'Do not create a condition automation.', '我不想创建条件自动化']) {
    assert.doesNotMatch(composeAgentMessage(message, [], catalog), /\[Condition Trigger Skill\]/);
  }
});

test('condition helper path is catalog-owned and remains valid outside the repository cwd', () => {
  const catalog = new ManagedSkillCatalog({ rootDir: join(process.cwd(), 'electron', 'managed-skills') });
  const helperPath = catalog.getHelperPath('condition-trigger', 'scripts/register-condition-trigger.sh');
  assert(helperPath);
  const message = composeAgentMessage('Create a script condition automation.', [], catalog);
  assert.match(message, new RegExp(`\\[Condition Trigger Helper\\]\\n${escapeRegex(helperPath)}`));
  assert.equal(existsSync(helperPath), true);
});

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
