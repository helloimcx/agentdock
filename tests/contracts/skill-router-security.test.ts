import test from 'node:test';
import assert from 'node:assert/strict';
import { SkillRouter } from '../../services/local-ai-core/src/skills/skill-router.js';
import type { SkillInfo, SkillRoutingRule } from '@cc/superai-contracts/skills';

function skillWithMetadata(id: string, metadata: Record<string, unknown>): SkillInfo {
  return {
    id,
    name: id,
    description: `${id} skill`,
    scope: 'workspace',
    path: `/mock/${id}/SKILL.md`,
    enabled: true,
    overridden: false,
    metadata: metadata as SkillInfo['metadata'],
  };
}

test('wildcard trigger metadata from untrusted skills is matched literally, never as regex', () => {
  const evil = skillWithMetadata('evil-skill', { triggers: ['.*'] });
  const router = new SkillRouter();
  const result = router.route('帮我写一段冒泡排序', [evil]);
  assert.equal(result.matches.length, 0);
  assert.equal(result.selectedSkills.length, 0);
});

test('catastrophic backtracking trigger metadata cannot gain regex power on the hot path', () => {
  const evil = skillWithMetadata('evil-skill', { triggers: ['(a+)+b'] });
  const router = new SkillRouter();
  const result = router.route('a'.repeat(24), [evil]);
  assert.equal(result.selectedSkills.length, 0);
});

test('untrusted metadata rules do not get regex semantics for patterns or negativePatterns', () => {
  const evil = skillWithMetadata('evil-skill', {
    rules: [{ skillId: 'evil-skill', patterns: ['.*监控.*'] }] as SkillRoutingRule[],
  });
  const router = new SkillRouter();
  const routed = router.route('帮我监控茅台股价', [evil]);
  assert.equal(routed.selectedSkills.length, 0);

  const victim = skillWithMetadata('victim-skill', {
    triggers: ['自动化'],
    rules: [{ skillId: 'victim-skill', negativePatterns: ['(?:不要|别).{0,8}自动化'] }] as SkillRoutingRule[],
  });
  const negated = new SkillRouter().route('不要自动化', [victim]);
  assert.equal(negated.matches.length, 1);
});

test('trusted builtin and router-provided rules keep full regex semantics', () => {
  const rules: SkillRoutingRule[] = [
    {
      skillId: 'trusted-skill',
      priority: 10,
      patterns: ['(?:股票|股价)'],
      keywords: ['行情'],
      negativePatterns: ['(?:不要|别).{0,8}监控'],
    },
  ];
  const skill = skillWithMetadata('trusted-skill', {});
  const router = new SkillRouter({ rules });

  const routed = router.route('帮我看看股票行情', [skill]);
  assert.equal(routed.selectedSkills.length, 1);

  const negated = router.route('不要帮我监控股票行情', [skill]);
  assert.equal(negated.matches.length, 0);
});

test('literal terms with regex metacharacters still match as plain substrings', () => {
  const skill = skillWithMetadata('cpp-helper', { triggers: ['c++', 'node.js'] });
  const router = new SkillRouter();
  const matched = router.route('用 c++ 写个快排，再用 node.js 跑', [skill]);
  assert.equal(matched.selectedSkills.length, 1);
});
