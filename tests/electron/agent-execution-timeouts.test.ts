import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const sourceRoot = join(process.cwd(), 'services', 'local-ai-core', 'src');

test('all background agent entry points use the shared execution deadline', () => {
  const entryPoints = [
    join(sourceRoot, 'automation', 'automation-action-executor.ts'),
    join(sourceRoot, 'automation', 'automation-conversation-executor.ts'),
    join(sourceRoot, 'scheduler', 'scheduled-conversation-executor.ts'),
  ];

  for (const entryPoint of entryPoints) {
    const source = readFileSync(entryPoint, 'utf8');
    assert.match(source, /timeoutMs = BACKGROUND_AGENT_EXECUTION_TIMEOUT_MS/);
  }
});

test('ACP prompt safety ceiling comes from the shared execution timeout policy', () => {
  const source = readFileSync(join(sourceRoot, 'acp', 'local-core-acp-backend.ts'), 'utf8');
  assert.match(source, /import \{ ACP_PROMPT_TIMEOUT_MS \} from '..\/agents\/shared\/execution-timeouts\.js';/);
  assert.doesNotMatch(source, /const ACP_PROMPT_TIMEOUT_MS\s*=/);
});
