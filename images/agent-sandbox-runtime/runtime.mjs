import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const prefix = '__AGENTDOCK_EVENT__ ';
const now = () => new Date().toISOString();
const emit = (event) => console.log(prefix + JSON.stringify(event));

const taskId = process.env.AGENTDOCK_TASK_ID || '';
const runId = process.env.AGENTDOCK_RUN_ID || '';
const threadId = process.env.AGENTDOCK_THREAD_ID || '';
const workspaceId = process.env.AGENTDOCK_WORKSPACE_ID || '';
const prompt = process.env.AGENTDOCK_PROMPT || '';
const outputDir = process.env.AGENTDOCK_OUTPUT_DIR || '/workspace/.agentdock/output';

emit({ type: 'task.started', taskId, runId, threadId, workspaceId, timestamp: now() });

try {
  await mkdir(outputDir, { recursive: true });
  const content = `Pi runtime placeholder response:\n\n${prompt}`;
  await writeFile(path.join(outputDir, `${taskId}.md`), content);
  emit({ type: 'assistant.delta', taskId, runId, threadId, content, timestamp: now() });
  emit({ type: 'assistant.message', taskId, runId, threadId, content, timestamp: now() });
  emit({ type: 'task.succeeded', taskId, runId, threadId, workspaceId, timestamp: now() });
} catch (error) {
  emit({ type: 'task.failed', taskId, runId, threadId, workspaceId, error: error instanceof Error ? error.message : String(error), timestamp: now() });
  process.exitCode = 1;
}
