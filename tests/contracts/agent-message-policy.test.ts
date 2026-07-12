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

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
