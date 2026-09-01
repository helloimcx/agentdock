import type { SkillRoutingRule } from '@cc/superai-contracts/skills';

export const BUILTIN_SKILL_RULES: SkillRoutingRule[] = [
  // Stock Monitor: Chinese stock keywords and ticker patterns
  {
    skillId: 'stock-monitor',
    priority: 10,
    patterns: [
      '(?:\\b[0-9]{5,6}\\b|\\b[A-Z]{1,5}\\b).*(?:监控|盯盘|看盘|预警|行情|走势|股价)',
      '(?:监控|盯盘|看盘|预警|行情|走势|股价).*(?:\\b[0-9]{5,6}\\b|\\b[A-Z]{1,5}\\b)',
    ],
    keywords: [
      '股票', '盯盘', '看盘', '行情', '个股', '美股', '港股', 'A股',
      '证券', '标的', '涨跌幅', '布林带', '布林线', '股息率', '分红',
      '股债利差', '财报', '价格预警', '行情预警', '股价',
    ],
    negativePatterns: [
      '(?:不要|不需要|无需|别|不想).{0,8}(?:监控|盯盘|看盘|预警)',
    ],
  },
  // Stock Monitor: English stock + intent
  {
    skillId: 'stock-monitor',
    priority: 10,
    requiredGroups: [
      [
        'stock', 'stocks', 'ticker', 'tickers', 'quote', 'quotes', 'bollinger',
        'dividend', 'dividends', 'erp', 'shares', 'market-watch', 'market watch',
      ],
      [
        'monitor', 'monitoring', 'alert', 'alerts', 'watch', 'watching',
        'track', 'tracking', 'buy', 'sell', 'price', 'prices',
        'condition', 'metric', 'strategy', 'capability', 'capabilities',
      ],
    ],
    negativePatterns: [
      '(?:do not|don\'t|dont|never|without).{0,24}\\b(?:monitor|watch|alert|track)\\b',
    ],
  },
  // Condition Trigger: Chinese condition + request action
  {
    skillId: 'condition-trigger',
    priority: 10,
    requiredGroups: [
      ['条件自动化', '条件触发', '脚本条件'],
      ['创建', '新建', '设置', '添加', '建立', '配置', '制作', '实现'],
    ],
    negativePatterns: [
      '(?:不要|不需要|无需|别|仅|只是|不想).{0,8}(?:创建|新建|设置|添加|建立|配置|制作|实现)',
    ],
  },
  // Condition Trigger: English condition + automation + request action
  {
    skillId: 'condition-trigger',
    priority: 10,
    requiredGroups: [
      ['condition', 'conditional', 'script-based', 'script-backed', 'script condition'],
      ['automation', 'monitor', 'task', 'schedule'],
      ['create', 'add', 'set up', 'set', 'configure', 'build', 'author'],
    ],
    negativePatterns: [
      '(?:do not|don\'t|dont|never|without).{0,24}\\b(?:create|add|set(?:\\s+up)?|configure|build|author)\\b',
    ],
  },
];
