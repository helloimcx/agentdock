import test from 'node:test';
import assert from 'node:assert/strict';
import { setCorsHeaders } from '../../services/local-ai-core/src/runtime/server-helpers.js';

class HeaderRecorder {
  headers = new Map<string, string | number | readonly string[]>();

  setHeader(name: string, value: string | number | readonly string[]) {
    this.headers.set(name, value);
  }
}

test('local core CORS preflight allows provider update PUT requests', () => {
  const req = { headers: { origin: 'http://127.0.0.1:5173' } };
  const res = new HeaderRecorder();

  setCorsHeaders(req as any, res as any);

  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'http://127.0.0.1:5173');
  assert.match(String(res.headers.get('Access-Control-Allow-Methods')), /(?:^|,)PUT(?:,|$)/);
  assert.match(String(res.headers.get('Access-Control-Allow-Headers')), /Content-Type/);
});
