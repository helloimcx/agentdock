import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ManagedSkillCatalog } from '../../apps/daemon/src/runtime/managed-skill-catalog.js';
import { SkillRouter } from '../../apps/daemon/src/skills/skill-router.js';
import { ToolIndex } from '../../apps/daemon/src/skills/tool-index.js';

const builtinSkillsDir = join(process.cwd(), 'apps', 'daemon', 'src', 'skills', 'builtin');
const sourceSkillPath = join(builtinSkillsDir, 'briefing', 'SKILL.md');
const packagedSkillPath = join(process.cwd(), 'dist-electron', 'apps', 'daemon', 'src', 'skills', 'builtin', 'briefing', 'SKILL.md');

test('briefing skill defines phase-1 keyless sources, seen-state dedup, digest SOP, and scheduler delivery', () => {
  const content = readFileSync(sourceSkillPath, 'utf8');

  // Metadata frontmatter
  assert.match(content, /name:\s*briefing/);
  assert.match(content, /description:/);
  assert.match(content, /allowed-tools:\s*Bash\(lac scheduler:\*\)/);
  assert.match(content, /triggers:/);

  // Phase-1 keyless sources
  assert.match(content, /RSS|Atom/);
  assert.match(content, /Hacker News|hacker-news|hacker_news/i);
  assert.match(content, /GitHub Trending|github\.com\/trending/i);

  // Seen-state deduplication in the workspace
  assert.match(content, /\.agentdock\/briefing\/seen\.json/);
  assert.match(content, /30\s*天|30-day|30 days/);

  // Digest composition contract
  assert.match(content, /标题|title/i);
  assert.match(content, /链接|link/i);
  assert.match(content, /来源|source/i);

  // Scheduled delivery via the scheduler CLI
  assert.match(content, /lac scheduler add/);
  assert.match(content, /--cron/);
  assert.match(content, /--execution-mode\s+side-thread/);
  assert.match(content, /lac scheduler list/);
  assert.match(content, /lac scheduler info/);
  assert.match(content, /lac scheduler run/);
  assert.match(content, /lac scheduler del/);

  // Phase boundary: advanced editorial machinery is out of scope for phase 1
  assert.match(content, /Phase 2|后续阶段|未来扩展/);
});

test('managed skill catalog discovers the briefing skill as a builtin', () => {
  const catalog = new ManagedSkillCatalog({ rootDir: builtinSkillsDir });
  const skill = catalog.listSkills().find((s) => s.id === 'briefing');
  assert(skill);
  assert.equal(skill.scope, 'builtin');
  assert.equal(skill.enabled, true);
  assert.equal(readFileSync(skill.path, 'utf8'), readFileSync(sourceSkillPath, 'utf8'));
  assert(Array.isArray(skill.metadata?.triggers));
  assert((skill.metadata?.triggers as string[]).length > 0);
});

test('skill router selects briefing for digest requests without misrouting stock queries', () => {
  const catalog = new ManagedSkillCatalog({ rootDir: builtinSkillsDir });
  const skills = catalog.listSkills();
  const router = new SkillRouter({ toolIndex: new ToolIndex() });

  const digestQuery = '帮我做一个每日简报，聚合 RSS 和 Hacker News，每天早上八点投递';
  const digestResult = router.route(digestQuery, skills);
  assert(
    digestResult.selectedSkills.some((s) => s.skillId === 'briefing'),
    `expected briefing to be selected for: ${digestQuery} (matches: ${JSON.stringify(digestResult.matches)})`,
  );

  const englishQuery = 'Set up a daily news digest briefing from my RSS feeds';
  assert(
    router.route(englishQuery, skills).selectedSkills.some((s) => s.skillId === 'briefing'),
    `expected briefing to be selected for: ${englishQuery}`,
  );

  const stockQuery = '帮我盯一下腾讯的股票行情，跌了提醒我';
  assert(
    !router.route(stockQuery, skills).selectedSkills.some((s) => s.skillId === 'briefing'),
    'briefing must not be selected for a stock monitoring query',
  );
});

test('briefing skill is packaged into all compiled skill roots', () => {
  assert.equal(existsSync(packagedSkillPath), true);
  assert.equal(readFileSync(packagedSkillPath, 'utf8'), readFileSync(sourceSkillPath, 'utf8'));
});
