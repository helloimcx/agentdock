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
  // Mobile Automation: Chinese mobile app and UI automation
  {
    skillId: 'mobile-automation',
    priority: 10,
    requiresTools: ['mobile-apps', 'mobile-ui'],
    patterns: [
      '(?:手机|移动端|安卓|Android).*(?:操作|打开|点击|加购|搜索|运行|控制)',
      '(?:打开|启动|跳转).*(?:淘宝|美团|微信|支付宝|高德|设置)',
      '(?:点击|输入|滑动|返回|加购|加入购物车)',
    ],
    keywords: [
      '手机操作', '移动端', '安卓', 'Android', 'mobile-apps', 'mobile-ui',
      '打开应用', '淘宝', '美团', '微信', '支付宝', '高德', '扫一扫', '付款码',
      '乘车码', '加入购物车', '屏幕点击', 'UI交互', '页面元素',
    ],
    negativePatterns: [
      '(?:不要|不需要|无需|别).{0,8}(?:手机|操作|点击|打开)',
    ],
  },
  // Mobile Automation: English mobile app and UI automation
  {
    skillId: 'mobile-automation',
    priority: 10,
    requiresTools: ['mobile-apps', 'mobile-ui'],
    requiredGroups: [
      ['mobile', 'android', 'phone', 'app', 'ui', 'mobile-apps', 'mobile-ui'],
      ['open', 'launch', 'click', 'input', 'tap', 'scroll', 'dump', 'navigate', 'automate', 'cart'],
    ],
    negativePatterns: [
      '(?:do not|don\'t|dont|never|without).{0,24}\\b(?:open|click|automate)\\b',
    ],
  },
];
