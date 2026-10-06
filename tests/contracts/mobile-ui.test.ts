import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import {
  formatElementsCompact,
  sortElementsByReadingOrder,
} from '../../services/local-ai-core/src/mesh/mobile-ui/formatter.js';
import { MobileUiClient } from '../../services/local-ai-core/src/mesh/mobile-ui/client.js';
import { runMobileUiCli } from '../../services/local-ai-core/src/mesh/mobile-ui/cli.js';
import { buildAndroidMobileInstructions } from '../../services/local-ai-core/src/execution/remote-mesh/device-environment.js';
import type { UIElement, UIDumpResult, UIStatusResult } from '../../services/local-ai-core/src/mesh/mobile-ui/types.js';

test('Mobile UI Formatter sorts and formats elements compactly', () => {
  const rawElements: UIElement[] = [
    {
      index: 1,
      text: '搜索发现: 挂耳咖啡',
      id: 'com.taobao.taobao:id/search_edit',
      className: 'android.widget.EditText',
      bounds: [40, 120, 800, 200],
      center: [420, 160],
      clickable: true,
      editable: true,
      scrollable: false,
    },
    {
      index: 2,
      text: '搜索',
      id: 'com.taobao.taobao:id/search_btn',
      className: 'android.widget.Button',
      bounds: [820, 120, 1000, 200],
      center: [910, 160],
      clickable: true,
      editable: false,
      scrollable: false,
    },
    {
      index: 3,
      text: '云南小粒精品咖啡豆 250g ¥48.0',
      className: 'android.view.ViewGroup',
      bounds: [40, 300, 1000, 600],
      center: [520, 450],
      clickable: true,
      editable: false,
      scrollable: false,
    },
  ];

  const dumpResult: UIDumpResult = {
    ok: true,
    package: 'com.taobao.taobao',
    activity: 'com.taobao.search.SearchActivity',
    screenWidth: 1080,
    screenHeight: 2400,
    count: 3,
    elements: rawElements,
  };

  const output = formatElementsCompact(dumpResult);
  assert.ok(output.includes('=== Screen: com.taobao.taobao (1080x2400) ==='));
  assert.ok(output.includes('[1] [EditText] "搜索发现: 挂耳咖啡" (id: search_edit)'));
  assert.ok(output.includes('[2] [Button] "搜索" (id: search_btn)'));
  assert.ok(output.includes('[3] [ViewGroup] "云南小粒精品咖啡豆 250g ¥48.0" (center: 520,450)'));
});

test('Mobile UI Reading Order sorts elements top-to-bottom left-to-right', () => {
  const unordered: UIElement[] = [
    {
      index: 0,
      text: '第二行右侧',
      className: 'android.widget.Button',
      bounds: [500, 300, 900, 380],
      center: [700, 340],
      clickable: true,
      editable: false,
      scrollable: false,
    },
    {
      index: 0,
      text: '第一行右侧',
      className: 'android.widget.Button',
      bounds: [600, 100, 900, 180],
      center: [750, 140],
      clickable: true,
      editable: false,
      scrollable: false,
    },
    {
      index: 0,
      text: '第一行左侧',
      className: 'android.widget.Button',
      bounds: [100, 105, 400, 185],
      center: [250, 145],
      clickable: true,
      editable: false,
      scrollable: false,
    },
    {
      index: 0,
      text: '第二行左侧',
      className: 'android.widget.Button',
      bounds: [100, 295, 450, 375],
      center: [275, 335],
      clickable: true,
      editable: false,
      scrollable: false,
    },
  ];

  const sorted = sortElementsByReadingOrder(unordered);
  assert.equal(sorted[0].text, '第一行左侧');
  assert.equal(sorted[0].index, 1);
  assert.equal(sorted[1].text, '第一行右侧');
  assert.equal(sorted[1].index, 2);
  assert.equal(sorted[2].text, '第二行左侧');
  assert.equal(sorted[2].index, 3);
  assert.equal(sorted[3].text, '第二行右侧');
  assert.equal(sorted[3].index, 4);
});

test('Mobile UI Client communicates with local daemon over HTTP', async () => {
  let lastAction = '';
  let lastPayload: any = null;

  const mockServer = http.createServer((req, res) => {
    lastAction = req.url || '';
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (body) {
        try { lastPayload = JSON.parse(body); } catch { lastPayload = body; }
      }

      if (req.url === '/api/status') {
        const statusRes: UIStatusResult = {
          ok: true,
          version: '1.0.0',
          serviceEnabled: true,
          currentPackage: 'com.taobao.taobao',
          currentActivity: 'com.taobao.MainActivity',
          screenWidth: 1080,
          screenHeight: 2400,
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(statusRes));
      } else if (req.url?.startsWith('/api/dump')) {
        const dumpRes: UIDumpResult = {
          ok: true,
          package: 'com.taobao.taobao',
          activity: 'com.taobao.MainActivity',
          screenWidth: 1080,
          screenHeight: 2400,
          count: 1,
          elements: [
            {
              index: 1,
              text: '我的淘宝',
              className: 'android.widget.TextView',
              bounds: [100, 200, 300, 260],
              center: [200, 230],
              clickable: true,
              editable: false,
              scrollable: false,
            },
          ],
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(dumpRes));
      } else if (req.url === '/api/click') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, method: 'action_click' }));
      } else if (req.url === '/api/input') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, inputText: lastPayload?.text }));
      } else if (req.url === '/api/scroll') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, direction: lastPayload?.direction }));
      } else if (req.url === '/api/action') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, action: lastPayload?.action }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Not found' }));
      }
    });
  });

  await new Promise<void>(resolve => mockServer.listen(0, '127.0.0.1', resolve));
  const port = (mockServer.address() as AddressInfo).port;
  const client = new MobileUiClient({ baseUrl: `http://127.0.0.1:${port}` });

  try {
    const status = await client.getStatus();
    assert.equal(status.ok, true);
    assert.equal(status.currentPackage, 'com.taobao.taobao');

    const dump = await client.dump();
    assert.equal(dump.elements.length, 1);
    assert.equal(dump.elements[0].text, '我的淘宝');

    const clickRes = await client.click({ index: 1 });
    assert.equal(clickRes.ok, true);
    assert.equal(lastPayload.index, 1);

    const inputRes = await client.input({ text: '咖啡豆', index: 1 });
    assert.equal(inputRes.ok, true);
    assert.equal(lastPayload.text, '咖啡豆');

    const scrollRes = await client.scroll({ direction: 'down' });
    assert.equal(scrollRes.ok, true);
    assert.equal(lastPayload.direction, 'down');

    const actionRes = await client.action({ action: 'back' });
    assert.equal(actionRes.ok, true);
    assert.equal(lastPayload.action, 'back');
  } finally {
    await new Promise<void>(resolve => mockServer.close(() => resolve()));
  }
});

test('Mobile UI Client handles server offline gracefully with helpful message', async () => {
  // Port where no server is running
  const client = new MobileUiClient({ baseUrl: 'http://127.0.0.1:59999' });
  await assert.rejects(
    async () => {
      await client.getStatus();
    },
    (err: Error) => {
      assert.ok(err.message.includes('Accessibility Bridge Daemon is not reachable'));
      return true;
    }
  );
});

test('Mobile UI CLI supports dry-run without network calls', async () => {
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = (msg?: any, ...args: any[]) => {
    logs.push([msg, ...args].join(' '));
  };

  try {
    await runMobileUiCli(['dump', '--dry-run']);
    assert.ok(logs.some(line => line.includes('[dry-run]')));
    logs.length = 0;

    await runMobileUiCli(['click', '2', '--dry-run']);
    assert.ok(logs.some(line => line.includes('[dry-run]') && line.includes('index=2')));
    logs.length = 0;

    await runMobileUiCli(['input', '特浓咖啡', '--target', '1', '--dry-run']);
    assert.ok(logs.some(line => line.includes('[dry-run]') && line.includes('特浓咖啡')));
    logs.length = 0;

    await runMobileUiCli(['scroll', 'down', '--dry-run']);
    assert.ok(logs.some(line => line.includes('[dry-run]') && line.includes('scroll down')));
    logs.length = 0;

    await runMobileUiCli(['back', '--dry-run']);
    assert.ok(logs.some(line => line.includes('[dry-run]') && line.includes('action back')));
  } finally {
    console.log = originalLog;
  }
});

test('Device environment instructions contain mobile-ui guidance', () => {
  const instructions = buildAndroidMobileInstructions();
  assert.ok(instructions.includes('mobile-ui dump'));
  assert.ok(instructions.includes('mobile-ui click'));
  assert.ok(instructions.includes('mobile-ui input'));
  assert.ok(instructions.includes('mobile-ui scroll'));
});

test('Mobile UI wait method resolves when element appears and rejects on timeout', async () => {
  let dumpCount = 0;
  const mockServer = http.createServer((req, res) => {
    if (req.url?.startsWith('/api/dump')) {
      dumpCount++;
      const elements: UIElement[] = [];
      if (dumpCount >= 2) {
        elements.push({
          index: 1,
          text: '目标已加载',
          className: 'android.widget.TextView',
          bounds: [100, 100, 300, 200],
          center: [200, 150],
          clickable: true,
          editable: false,
          scrollable: false,
        });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        package: 'com.test',
        count: elements.length,
        elements,
        screenWidth: 1080,
        screenHeight: 2400,
      }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>(resolve => mockServer.listen(0, '127.0.0.1', resolve));
  const port = (mockServer.address() as AddressInfo).port;
  const client = new MobileUiClient({ baseUrl: `http://127.0.0.1:${port}` });

  try {
    const found = await client.wait({ text: '目标已加载', timeoutSeconds: 2, intervalMs: 50 });
    assert.equal(found.text, '目标已加载');

    // Test timeout
    await assert.rejects(
      async () => {
        await client.wait({ text: '不存在的按钮', timeoutSeconds: 0.1, intervalMs: 30 });
      },
      (err: Error) => {
        assert.ok(err.message.includes('Timed out'));
        return true;
      }
    );
  } finally {
    await new Promise<void>(resolve => mockServer.close(() => resolve()));
  }
});

test('Mobile UI CLI parses coordinates strictly and treats text with commas as text', async () => {
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = (msg?: any, ...args: any[]) => {
    logs.push([msg, ...args].join(' '));
  };

  try {
    // 1. Strict coordinates
    await runMobileUiCli(['click', '720,640', '--dry-run']);
    assert.ok(logs.some(line => line.includes('"point":[720,640]')));
    logs.length = 0;

    // 2. Strict coordinates with spaces
    await runMobileUiCli(['click', '720, 640', '--dry-run']);
    assert.ok(logs.some(line => line.includes('"point":[720,640]')));
    logs.length = 0;

    // 3. Text containing comma should NOT be treated as coordinates
    await runMobileUiCli(['click', 'Coffee, 250g', '--dry-run']);
    assert.ok(logs.some(line => line.includes('"text":"Coffee, 250g"') && !line.includes('point')));
    logs.length = 0;

    // 4. Boolean flags placed before positional arguments
    await runMobileUiCli(['click', '--dry-run', '3']);
    assert.ok(logs.some(line => line.includes('index=3')));
    logs.length = 0;

    // 5. Input with --no-clear before positional text
    await runMobileUiCli(['input', '--no-clear', '特浓咖啡', '--dry-run']);
    assert.ok(logs.some(line => line.includes('"text":"特浓咖啡"') && line.includes('"clear":false')));
    logs.length = 0;
  } finally {
    console.log = originalLog;
  }
});

test('Mobile UI CLI validates arguments strictly', async () => {
  // Invalid target index
  await assert.rejects(
    async () => {
      await runMobileUiCli(['input', 'test', '--target', 'abc', '--dry-run']);
    },
    (err: Error) => {
      assert.ok(err.message.includes('Invalid target index'));
      return true;
    }
  );

  // Missing text or id for wait
  await assert.rejects(
    async () => {
      await runMobileUiCli(['wait', '--dry-run']);
    },
    (err: Error) => {
      assert.ok(err.message.includes('Please specify text or --id to wait for'));
      return true;
    }
  );

  // Invalid timeout
  await assert.rejects(
    async () => {
      await runMobileUiCli(['wait', 'test', '--timeout', '-5', '--dry-run']);
    },
    (err: Error) => {
      assert.ok(err.message.includes('Invalid timeout'));
      return true;
    }
  );
});

test('Mobile UI wait method matches elements by contentDescription (desc)', async () => {
  const mockServer = http.createServer((req, res) => {
    if (req.url?.startsWith('/api/dump')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        package: 'com.test',
        count: 1,
        screenWidth: 1080,
        screenHeight: 2400,
        elements: [
          {
            index: 1,
            text: '',
            desc: '返回上一页',
            className: 'android.widget.ImageButton',
            bounds: [0, 80, 120, 200],
            center: [60, 140],
            clickable: true,
            editable: false,
            scrollable: false,
          },
        ],
      }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>(resolve => mockServer.listen(0, '127.0.0.1', resolve));
  const port = (mockServer.address() as AddressInfo).port;
  const client = new MobileUiClient({ baseUrl: `http://127.0.0.1:${port}` });

  try {
    const found = await client.wait({ text: '返回', timeoutSeconds: 1, intervalMs: 50 });
    assert.equal(found.desc, '返回上一页');
  } finally {
    await new Promise<void>(resolve => mockServer.close(() => resolve()));
  }
});

test('sortElementsByReadingOrder ignores elements with invalid bounds gracefully', () => {
  const elementsWithBadBounds: any[] = [
    {
      index: 1,
      text: '正常元素',
      className: 'android.widget.Button',
      bounds: [100, 100, 200, 200],
      center: [150, 150],
    },
    {
      index: 2,
      text: '损坏元素无bounds',
      className: 'android.widget.Button',
    },
    {
      index: 3,
      text: '损坏元素空bounds',
      className: 'android.widget.Button',
      bounds: [10],
    },
  ];

  const sorted = sortElementsByReadingOrder(elementsWithBadBounds);
  assert.equal(sorted.length, 1);
  assert.equal(sorted[0].text, '正常元素');
});


