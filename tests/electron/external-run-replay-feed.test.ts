import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LocalCoreAcpStore } from '../../apps/daemon/src/acp/local-core-acp-store.js';

function backdateMessageTimestamp(dbPath: string, messageId: string, timestamp: string) {
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare('UPDATE messages SET timestamp=? WHERE id=?').run(timestamp, messageId);
  } finally {
    db.close();
  }
}

test('listAssistantRunMessagesSince returns only assistant rows at or after the cutoff in seq order', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'acp-run-replay-'));
  const dbPath = join(userDataPath, 'runtime', 'local-core.db');
  let store: LocalCoreAcpStore | null = null;
  try {
    store = new LocalCoreAcpStore(userDataPath);
    const thread = store.createThread('workspace-agentdock', 'Nightly digest thread');

    const cutoff = '2026-11-02T01:00:00.000Z';
    const before = '2026-11-02T00:59:00.000Z';
    const during1 = '2026-11-02T01:00:05.000Z';
    const during2 = '2026-11-02T01:01:30.000Z';

    const userRow = store.appendMessage(thread.id, 'user', 'Run the nightly digest', 'final');
    const oldFinal = store.appendMessage(thread.id, 'assistant', 'Earlier answer', 'final');
    const oldTool = store.appendMessage(
      thread.id,
      'assistant',
      '🔧 Terminal: pnpm test',
      'progress',
      { id: 'call_9', name: 'Terminal', status: 'completed', input: {}, output: 'x'.repeat(4096) },
      'tool',
    );
    const runFinal = store.appendMessage(thread.id, 'assistant', 'Nightly digest body', 'final');
    const runTool = store.appendMessage(
      thread.id,
      'assistant',
      '🔧 Terminal: pnpm lint',
      'progress',
      { id: 'call_10', name: 'Terminal', status: 'completed', input: {}, output: 'y'.repeat(2048) },
      'tool',
      'awaiting_input',
    );

    backdateMessageTimestamp(dbPath, userRow.id, before);
    backdateMessageTimestamp(dbPath, oldFinal.id, before);
    backdateMessageTimestamp(dbPath, oldTool.id, before);
    backdateMessageTimestamp(dbPath, runFinal.id, during1);
    backdateMessageTimestamp(dbPath, runTool.id, during2);

    const rows = store.listAssistantRunMessagesSince(thread.id, cutoff);

    assert.deepEqual(
      rows.map((row) => ({
        kind: row.kind,
        content: row.content,
        bridgeKind: row.bridgeKind,
        bridgeStatus: row.bridgeStatus,
        timestamp: row.timestamp,
      })),
      [
        { kind: 'final', content: 'Nightly digest body', bridgeKind: undefined, bridgeStatus: undefined, timestamp: during1 },
        { kind: 'progress', content: '🔧 Terminal: pnpm lint', bridgeKind: 'tool', bridgeStatus: 'awaiting_input', timestamp: during2 },
      ],
    );
    assert.ok(rows.every((row) => !('toolCall' in row)), 'replay rows must not carry tool payloads');
  } finally {
    store?.close();
    rmSync(userDataPath, { recursive: true, force: true });
  }
});
