import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BRIDGE_LOG_MAX_CHARS,
  formatBridgeLogLine,
  createLossyStdoutLineWriter,
} from '../../apps/daemon/src/runtime/bridge-stdout-log.js';
interface FakeStream {
  stream: NodeJS.WritableStream;
  written: string[];
  writeResult: boolean;
  drain: () => void;
}

function createFakeStream(writeResult: boolean): FakeStream {
  const written: string[] = [];
  const handlers = new Map<string, () => void>();
  const stream = {
    write: (line: string) => {
      written.push(line);
      return writeResult;
    },
    on: (eventName: string, handler: () => void) => {
      handlers.set(eventName, handler);
    },
  } as unknown as NodeJS.WritableStream;
  return {
    stream,
    written,
    writeResult,
    drain: () => handlers.get('drain')?.(),
  };
}

test('bridge log line passes short events through unchanged', () => {
  const line = formatBridgeLogLine({ type: 'reply', sessionKey: 'localcore-acp:ws:thread-a', content: 'hi' });
  assert.equal(line, '[local-ai-core bridge] {"type":"reply","sessionKey":"localcore-acp:ws:thread-a","content":"hi"}\n');
});

test('bridge log line truncates oversized tool payloads with a count marker', () => {
  const event = {
    type: 'reply',
    bridgeKind: 'tool',
    content: `Terminal: ${'X'.repeat(BRIDGE_LOG_MAX_CHARS * 2)}`,
  };
  const expectedTruncated = (JSON.stringify(event) as string).length - BRIDGE_LOG_MAX_CHARS;
  const line = formatBridgeLogLine(event);
  assert.ok(line.startsWith('[local-ai-core bridge] '));
  assert.ok(line.includes('…[truncated'), `missing truncation marker: ${line.slice(-80)}`);
  assert.ok(line.length < BRIDGE_LOG_MAX_CHARS + 120, `capped line should stay near the limit, got ${line.length}`);
  const truncatedMatch = line.match(/truncated (\d+) chars/);
  assert.ok(truncatedMatch, 'marker must include the dropped char count');
  assert.equal(Number(truncatedMatch[1]), expectedTruncated);
});

test('formatBridgeLogLine honors a custom limit', () => {
  const line = formatBridgeLogLine({ content: 'A'.repeat(300) }, 100);
  assert.ok(line.length < 160, `custom limit not honored, got ${line.length}`);
});

test('lossy writer passes lines through while the stream accepts them', () => {
  const fake = createFakeStream(true);
  const write = createLossyStdoutLineWriter(fake.stream);
  write(() => 'line-1\n');
  write(() => 'line-2\n');
  assert.deepEqual(fake.written, ['line-1\n', 'line-2\n']);
});

test('lossy writer drops lines under backpressure and resumes after drain', () => {
  const fake = createFakeStream(false);
  let produced = 0;
  const write = createLossyStdoutLineWriter(fake.stream);
  write(() => {
    produced += 1;
    return 'line-1\n';
  });
  write(() => {
    produced += 1;
    return 'line-2\n';
  });
  write(() => {
    produced += 1;
    return 'line-3\n';
  });
  assert.deepEqual(fake.written, ['line-1\n'], 'only the first line may be written before backpressure');
  assert.equal(produced, 1, 'suspended producers must not be evaluated');
  fake.drain();
  assert.equal(fake.written.length, 2, 'drain should emit one drop-marker line');
  assert.match(fake.written[1], /dropped 2 diagnostic lines/);
  write(() => {
    produced += 1;
    return 'line-4\n';
  });
  assert.deepEqual(fake.written[2], 'line-4\n', 'writer must resume after drain');
});

test('drain while not suspended does not emit a drop marker', () => {
  const fake = createFakeStream(true);
  const write = createLossyStdoutLineWriter(fake.stream);
  write(() => 'line-1\n');
  fake.drain();
  assert.deepEqual(fake.written, ['line-1\n']);
});
