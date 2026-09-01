import test from 'node:test';
import assert from 'node:assert/strict';
import { SkillRouter } from '../../services/local-ai-core/src/skills/skill-router.js';
import { ToolIndex } from '../../services/local-ai-core/src/skills/tool-index.js';
import type { SkillInfo } from '@cc/superai-contracts/skills';

const testSkills: SkillInfo[] = [
  {
    id: 'stock-monitor',
    name: 'Stock Monitor',
    description: 'Monitor stock prices, Bollinger bands, and dividends',
    scope: 'builtin',
    path: '/builtin/stock-monitor/SKILL.md',
    enabled: true,
    overridden: false,
    metadata: {
      domains: ['finance', 'stock'],
      requiresTools: ['lac'],
    },
  },
  {
    id: 'condition-trigger',
    name: 'Condition Trigger',
    description: 'Trigger automation on script conditions',
    scope: 'builtin',
    path: '/builtin/condition-trigger/SKILL.md',
    enabled: true,
    overridden: false,
    metadata: {
      domains: ['automation', 'condition'],
      requiresTools: ['lac'],
    },
  },
  {
    id: 'media-converter',
    name: 'Media Converter',
    description: 'Convert media files using ffmpeg',
    scope: 'user',
    path: '/user/media-converter/SKILL.md',
    enabled: true,
    overridden: false,
    metadata: {
      triggers: ['ffmpeg', 'convert video', 'transcode'],
      requiresTools: ['ffmpeg_mock_missing'],
    },
  },
  {
    id: 'git-helper',
    name: 'Git Helper',
    description: 'Git workflow automations',
    scope: 'user',
    path: '/user/git-helper/SKILL.md',
    enabled: true,
    overridden: false,
    metadata: {
      triggers: ['git commit', 'git branch', 'git status'],
      requiresTools: ['node'], // 'node' is available
    },
  },
];

interface RegressionCase {
  desc: string;
  query: string;
  expectedSkills: string[];
  unexpectedSkills?: string[];
  expectedAvailable?: boolean;
}

const REGRESSION_SUITE: RegressionCase[] = [
  // 1. Chinese Stock queries
  {
    desc: 'Chinese stock query with ticker code',
    query: '帮我盯一下 600519 茅台的走势',
    expectedSkills: ['stock-monitor'],
  },
  {
    desc: 'Chinese general stock market query',
    query: '今天美股和港股行情怎么样？',
    expectedSkills: ['stock-monitor'],
  },
  {
    desc: 'Chinese stock strategy query',
    query: '监控股价触及布林线下轨且股息率大于5%的个股',
    expectedSkills: ['stock-monitor'],
  },
  // 2. English Stock queries
  {
    desc: 'English stock quote query',
    query: 'Please show me AAPL stock quote and price alert',
    expectedSkills: ['stock-monitor'],
  },
  {
    desc: 'English ticker watch query',
    query: 'Monitor ticker NVDA for price changes',
    expectedSkills: ['stock-monitor'],
  },
  {
    desc: 'English Bollinger band query',
    query: 'Track TSLA bollinger bands and market watch quotes',
    expectedSkills: ['stock-monitor'],
  },
  // 3. Stock Negation queries
  {
    desc: 'Chinese stock negation query',
    query: '不要监控股票，只是随便问问',
    expectedSkills: [],
    unexpectedSkills: ['stock-monitor'],
  },
  {
    desc: 'English stock negation query',
    query: 'Do not monitor stock prices right now',
    expectedSkills: [],
    unexpectedSkills: ['stock-monitor'],
  },
  // 4. Condition Automation queries
  {
    desc: 'Chinese condition automation creation',
    query: '创建一个条件自动化，在脚本条件满足时触发',
    expectedSkills: ['condition-trigger'],
  },
  {
    desc: 'Chinese condition trigger setup',
    query: '请设置条件触发任务',
    expectedSkills: ['condition-trigger'],
  },
  {
    desc: 'English condition automation creation',
    query: 'Create an automation when a script condition matches.',
    expectedSkills: ['condition-trigger'],
  },
  {
    desc: 'English condition automation add',
    query: 'Add a task backed by script condition',
    expectedSkills: ['condition-trigger'],
  },
  // 5. Condition Negation queries
  {
    desc: 'Chinese condition negation query',
    query: '我不想创建条件自动化',
    expectedSkills: [],
    unexpectedSkills: ['condition-trigger'],
  },
  {
    desc: 'Chinese condition explanation without creation',
    query: '解释条件自动化的概念，但不要创建它',
    expectedSkills: [],
    unexpectedSkills: ['condition-trigger'],
  },
  {
    desc: 'English condition negation query',
    query: 'Do not create a condition automation.',
    expectedSkills: [],
    unexpectedSkills: ['condition-trigger'],
  },
  // 6. External Tool Availability queries
  {
    desc: 'Tool-dependent skill with installed tool',
    query: 'Help me run git commit and check git status',
    expectedSkills: ['git-helper'],
    expectedAvailable: true,
  },
  {
    desc: 'Tool-dependent skill with missing tool',
    query: 'Please convert video using ffmpeg',
    expectedSkills: ['media-converter'],
    expectedAvailable: false,
  },
  // 7. General queries (No skill should match)
  {
    desc: 'General coding question',
    query: 'How to implement a quicksort algorithm in TypeScript?',
    expectedSkills: [],
  },
  {
    desc: 'General conversational greeting',
    query: 'Hello, what can you do today?',
    expectedSkills: [],
  },
  {
    desc: 'System monitor query that should not match stock-monitor',
    query: 'Please monitor CPU usage and memory',
    expectedSkills: [],
    unexpectedSkills: ['stock-monitor'],
  },
  {
    desc: 'Word boundary test: restock should not match stock',
    query: 'restock the kitchen supplies',
    expectedSkills: [],
    unexpectedSkills: ['stock-monitor'],
  },
  {
    desc: 'Weather trend query that should not match stock-monitor',
    query: '今天天气走势怎么样？',
    expectedSkills: [],
    unexpectedSkills: ['stock-monitor'],
  },
  // 8. Compound query matching multiple skills
  {
    desc: 'Compound query matching both condition and stock',
    query: '创建一个条件自动化来监控 600519 股票行情',
    expectedSkills: ['condition-trigger', 'stock-monitor'],
  },
];

test('skill routing regression test suite covers 22 typical scenarios', () => {
  const router = new SkillRouter();

  for (const c of REGRESSION_SUITE) {
    const result = router.route(c.query, testSkills);
    const selectedIds = result.selectedSkills.map((s) => s.skillId);

    for (const expected of c.expectedSkills) {
      assert(
        selectedIds.includes(expected),
        `[${c.desc}] Expected "${expected}" in selectedSkills for query "${c.query}". Actual: [${selectedIds.join(', ')}]`,
      );
    }

    if (c.unexpectedSkills) {
      for (const unexpected of c.unexpectedSkills) {
        assert(
          !selectedIds.includes(unexpected),
          `[${c.desc}] Did NOT expect "${unexpected}" in selectedSkills for query "${c.query}". Actual: [${selectedIds.join(', ')}]`,
        );
      }
    }

    if (c.expectedAvailable !== undefined && c.expectedSkills.length > 0) {
      const match = result.selectedSkills.find((s) => s.skillId === c.expectedSkills[0]);
      if (match) {
        assert.equal(
          match.available,
          c.expectedAvailable,
          `[${c.desc}] Expected available=${c.expectedAvailable} for skill "${c.expectedSkills[0]}", but got ${match.available}`,
        );
      }
    }
  }
});
