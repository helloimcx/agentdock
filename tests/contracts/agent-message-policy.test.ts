import test from 'node:test';
import assert from 'node:assert/strict';
import { composeAgentMessage } from '../../services/local-ai-core/src/thread/agent-message-policy.js';
import { ManagedSkillCatalog } from '../../services/local-ai-core/src/runtime/managed-skill-catalog.js';
import { join } from 'node:path';

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
  for (const message of ['触发一次普通任务', 'Please trigger a response now.', '解释条件自动化的概念，但不要创建它']) {
    assert.doesNotMatch(composeAgentMessage(message, [], catalog), /\[Condition Trigger Skill\]/);
  }
});

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
