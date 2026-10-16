import { randomUUID } from 'node:crypto';
import { defineTool } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import type { DurableWriteDecision, DurableWriteRequest } from './protocol.js';

export function createWriteFileTool(
  threadId: string,
  getRun: (threadId: string) => { coreSubmissionId: string; coreRunId: string } | undefined,
  requestWrite: (request: DurableWriteRequest) => Promise<DurableWriteDecision>,
) {
  return defineTool({
    name: 'write_file',
    description: 'Create or replace a UTF-8 text file inside the configured workspace. Every write requires user approval.',
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
    replay: 'unsafe',
    executionMode: 'sequential',
    outputLimits: { maxBytes: 2048, maxLines: 20 },
    execute: async (args) => {
      const active = getRun(threadId);
      if (!active) throw new Error('No active Core run is bound to this Durable write.');
      const decision = await requestWrite({
        requestId: `durable-write:${randomUUID()}`,
        threadId,
        coreSubmissionId: active.coreSubmissionId,
        coreRunId: active.coreRunId,
        path: args.path,
        content: args.content,
      });
      if (!decision.ok) throw new Error(decision.error);
      return { content: [{ type: 'text', text: decision.message }] };
    },
  });
}
