import type { DatabaseSync } from 'node:sqlite';
import type { ThreadDetail, ThreadExecutionSnapshot, ThreadRuntimePermission, RunSummary } from '@cc/superai-contracts';
import type { LocalThreadRuntimeStore } from './thread-runtime-store.js';

export function readThreadExecutionSnapshot(
  db: DatabaseSync,
  runtime: LocalThreadRuntimeStore,
  threadId: string,
  readThread: () => ThreadDetail,
): ThreadExecutionSnapshot {
  const frame = runtime.read(threadId, () => {
    const thread = readThread();
    const partial = db.prepare('SELECT * FROM thread_runtime_partials WHERE thread_id = ?').get(threadId);
    if (partial) thread.messages.push({ id: String(partial.message_id), role: 'assistant', content: String(partial.content),
      timestamp: String(partial.updated_at), kind: 'progress', bridgeKind: 'assistant' });
    const runs = db.prepare(`SELECT id, thread_id AS threadId, status, started_at AS startedAt,
      updated_at AS updatedAt FROM runs WHERE thread_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT 20`).all(threadId) as unknown as RunSummary[];
    const permissions = readPermissions(db, threadId, runtime.epoch);
    const active = runs.find((run) => ['running', 'awaiting_input'].includes(run.status));
    thread.runId = active?.id;
    thread.live = !!active;
    const pending = permissions.find((entry) => entry.actionable);
    if (pending) {
      const row = db.prepare('SELECT options_json, description FROM approval_requests WHERE id = ?').get(pending.approvalId)!;
      const options = JSON.parse(String(row.options_json)) as Array<{ optionId: string; label: string }>;
      thread.pendingPermissionRequest = { id: pending.approvalId, content: String(row.description),
        actions: [options.map((option) => ({ text: option.label, data: option.optionId }))],
        actionReplyCtx: pending.runId, actionMode: 'permission', actionInteractive: true };
    } else {
      thread.pendingPermissionRequest = null;
    }
    const submissions = exists(db, 'thread_submissions')
      ? db.prepare(`SELECT id AS submissionId, run_id AS runId, status, runtime_type AS runtimeType, error
          FROM thread_submissions WHERE thread_id = ? ORDER BY rowid DESC LIMIT 100`).all(threadId) as unknown as ThreadExecutionSnapshot['submissions'] : [];
    const deliveries = exists(db, 'delivery_outbox')
      ? db.prepare(`SELECT id, owner_run_id AS ownerRunId, acp_run_id AS acpRunId, status, error
          FROM delivery_outbox WHERE thread_id = ? ORDER BY rowid DESC LIMIT 100`).all(threadId) as unknown as ThreadExecutionSnapshot['deliveries'] : [];
    const usage = db.prepare(`SELECT COALESCE(SUM(tokens_in), 0) AS tokensIn, COALESCE(SUM(tokens_out), 0) AS tokensOut,
      COALESCE(SUM(cost_usd), 0) AS costUsd FROM cost_events WHERE thread_id = ?`).get(threadId) as unknown as ThreadExecutionSnapshot['usage'];
    const durable = thread.agentType === 'pi-durable';
    return { thread, runs, submissions, permissions, deliveries, usage,
      capabilities: { historyResume: true, executionResume: durable, toolReplaySafe: false } };
  });
  return { schemaVersion: 1, threadId, runtimeEpoch: frame.epoch, revision: frame.revision, ...frame.value };
}

function exists(db: DatabaseSync, table: string) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}
function readPermissions(db: DatabaseSync, threadId: string, epoch: string): ThreadRuntimePermission[] {
  const rows = db.prepare(`SELECT id, run_id, title, status, metadata_json FROM approval_requests
    WHERE thread_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT 100`).all(threadId);
  return rows.map((row) => ({ approvalId: String(row.id), runId: row.run_id ? String(row.run_id) : undefined,
    title: String(row.title), status: row.status as ThreadRuntimePermission['status'],
    actionable: row.status === 'pending' && JSON.parse(String(row.metadata_json)).acpSessionEpoch === epoch }));
}
