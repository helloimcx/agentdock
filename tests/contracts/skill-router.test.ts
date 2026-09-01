import test from 'node:test';
import assert from 'node:assert/strict';
import { SkillRouter } from '../../services/local-ai-core/src/skills/skill-router.js';
import { ToolIndex } from '../../services/local-ai-core/src/skills/tool-index.js';
import type { SkillInfo } from '@cc/superai-contracts/skills';

const mockSkills: SkillInfo[] = [
  {
    id: 'stock-monitor',
    name: 'Stock Monitor',
    description: 'Monitor stock prices, Bollinger bands, and dividends',
    scope: 'builtin',
    path: '/mock/stock-monitor/SKILL.md',
    enabled: true,
    overridden: false,
    metadata: {
      triggers: ['stock', 'quote'],
      requiresTools: ['lac'],
    },
  },
  {
    id: 'condition-trigger',
    name: 'Condition Trigger',
    description: 'Trigger automation on script conditions',
    scope: 'builtin',
    path: '/mock/condition-trigger/SKILL.md',
    enabled: true,
    overridden: false,
    metadata: {
      triggers: ['conditional automation'],
      requiresTools: ['lac'],
    },
  },
  {
    id: 'cad-render',
    name: 'CAD Renderer',
    description: 'Render 3D CAD files via FreeCAD',
    scope: 'user',
    path: '/mock/cad-render/SKILL.md',
    enabled: true,
    overridden: false,
    metadata: {
      triggers: ['freecad', 'render cad', '3d model'],
      requiresTools: ['freecad_cli_non_existent'],
    },
  },
];

test('skill router selects stock-monitor for stock quotes and tickers', () => {
  const router = new SkillRouter();
  const result = router.route('帮我盯一下茅台 600519 股价走势', mockSkills);

  assert.equal(result.selectedSkills.length > 0, true);
  assert.equal(result.selectedSkills[0].skillId, 'stock-monitor');
  assert.equal(result.selectedSkills[0].score >= 10, true);
});

test('skill router selects condition-trigger for explicit automation requests', () => {
  const router = new SkillRouter();
  const result = router.route('创建一个条件自动化，在脚本条件满足时触发', mockSkills);

  assert.equal(result.selectedSkills.length > 0, true);
  assert.equal(result.selectedSkills[0].skillId, 'condition-trigger');
});

test('skill router suppresses condition-trigger when negation is detected', () => {
  const router = new SkillRouter();
  const result = router.route('解释条件自动化的概念，但不要创建它', mockSkills);

  const matched = result.selectedSkills.find((s) => s.skillId === 'condition-trigger');
  assert.equal(matched, undefined);
});

test('skill router detects missing tools for tool-dependent skills', () => {
  const customToolIndex = new ToolIndex({
    resolver: (cmd) => (cmd === 'lac' ? '/usr/bin/lac' : null),
  });
  const router = new SkillRouter({ toolIndex: customToolIndex });
  const result = router.route('帮我用 freecad 渲染这个 3d model', mockSkills);

  const cadMatch = result.matches.find((s) => s.skillId === 'cad-render');
  assert(cadMatch);
  assert.equal(cadMatch.available, false);
  assert.deepEqual(cadMatch.missingTools, ['freecad_cli_non_existent']);
});

test('skill router returns empty selectedSkills for generic conversation', () => {
  const router = new SkillRouter();
  const result = router.route('你好，请帮我写一段冒泡排序', mockSkills);

  assert.equal(result.selectedSkills.length, 0);
});

test('skills.route HTTP handler processes POST and GET route requests', async () => {
  const { registerSkillsHandlers } = await import('../../services/local-ai-core/src/runtime/handlers/skills-handler.js');
  const { ManagedSkillCatalog } = await import('../../services/local-ai-core/src/runtime/managed-skill-catalog.js');
  const { join } = await import('node:path');

  const catalog = new ManagedSkillCatalog({ rootDir: join(process.cwd(), 'electron', 'managed-skills') });
  const routeMap = new Map();
  registerSkillsHandlers(routeMap, catalog);

  const routeHandler = routeMap.get('skills.route');
  assert(routeHandler);

  // Test GET
  let getData: any = null;
  const mockGetRes: any = {
    statusCode: 200,
    setHeader: () => {},
    end: (data: string) => { getData = JSON.parse(data); },
  };

  await routeHandler(
    { name: 'skills.route' },
    { method: 'GET', url: 'http://localhost/skills/route?q=' + encodeURIComponent('帮我监控茅台股价') } as any,
    mockGetRes,
  );

  assert.equal(mockGetRes.statusCode, 200);
  assert(getData.data);
  assert.equal(getData.data.selectedSkills[0]?.skillId, 'stock-monitor');

  // Test POST
  let postData: any = null;
  const mockPostRes: any = {
    statusCode: 200,
    setHeader: () => {},
    end: (data: string) => { postData = JSON.parse(data); },
  };

  const bodyStream: any = {
    method: 'POST',
    url: 'http://localhost/skills/route',
    [Symbol.asyncIterator]: async function* () {
      yield Buffer.from(JSON.stringify({ query: '创建一个条件自动化' }));
    },
  };

  await routeHandler(
    { name: 'skills.route' },
    bodyStream,
    mockPostRes,
  );

  assert.equal(mockPostRes.statusCode, 200);
  assert(postData.data);
  assert.equal(postData.data.selectedSkills[0]?.skillId, 'condition-trigger');
});
