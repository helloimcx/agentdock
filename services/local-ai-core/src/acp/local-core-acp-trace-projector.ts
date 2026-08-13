import type { LocalCoreTraceStore } from './store/trace-store.js';
import type { TokenUsage, RunSpan } from '@cc/superai-contracts';
import { redactSecrets } from './store/utils.js';

const MAX_ACTIVE_RUNS = 200;
const MAX_PAYLOAD_CHARS = 20000;

export class AcpTraceProjector {
  private activeRunSpans = new Map<string, Map<string, string>>(); // runId -> (key -> spanId)

  constructor(private readonly traceStore: LocalCoreTraceStore) {}

  startRun(runId: string): string {
    if (!this.activeRunSpans.has(runId)) {
      if (this.activeRunSpans.size >= MAX_ACTIVE_RUNS) {
        // LRU cleanup: delete oldest run entry
        const oldestKey = this.activeRunSpans.keys().next().value;
        if (oldestKey) this.activeRunSpans.delete(oldestKey);
      }
      this.activeRunSpans.set(runId, new Map());
    }
    return runId;
  }

  onThought(runId: string, text: string): RunSpan {
    this.startRun(runId);
    const keyMap = this.activeRunSpans.get(runId)!;
    let spanId = keyMap.get('thought');
    const sanitizedText = sanitizeString(text);

    if (!spanId) {
      const span = this.traceStore.insertSpan({
        runId,
        kind: 'thought',
        name: 'Thought / Reasoning',
        status: 'running',
        inputJson: { preview: sanitizedText.slice(0, 200) },
      });
      spanId = span.id;
      keyMap.set('thought', spanId);
      return span;
    } else {
      const updated = this.traceStore.updateSpan(spanId, {
        outputJson: { preview: sanitizedText.slice(0, 500) },
      });
      return updated!;
    }
  }

  onPlan(runId: string, planText: string): RunSpan {
    this.startRun(runId);
    const keyMap = this.activeRunSpans.get(runId)!;
    let spanId = keyMap.get('plan');
    const sanitizedPlan = sanitizeString(planText);

    if (!spanId) {
      const span = this.traceStore.insertSpan({
        runId,
        kind: 'plan',
        name: 'Plan Step',
        status: 'running',
        inputJson: { plan: sanitizedPlan },
      });
      spanId = span.id;
      keyMap.set('plan', spanId);
      return span;
    } else {
      const updated = this.traceStore.updateSpan(spanId, {
        outputJson: { plan: sanitizedPlan },
      });
      return updated!;
    }
  }

  onToolCallStart(
    runId: string,
    toolName: string,
    input?: unknown,
    callId?: string
  ): RunSpan {
    this.startRun(runId);
    const keyMap = this.activeRunSpans.get(runId)!;
    const parentSpanId = keyMap.get('thought') || keyMap.get('plan') || null;
    this.completeRunningThoughtOrPlan(keyMap);
    const sanitizedInput = sanitizePayload(input);

    const span = this.traceStore.insertSpan({
      runId,
      parentSpanId,
      kind: 'tool_call',
      name: toolName,
      status: 'running',
      inputJson: sanitizedInput || null,
    });

    const key = callId ? `tool:${callId}` : `tool:${toolName}:${span.id}`;
    keyMap.set(key, span.id);
    return span;
  }

  private completeRunningThoughtOrPlan(keyMap: Map<string, string>): void {
    const thoughtSpanId = keyMap.get('thought');
    if (thoughtSpanId) {
      this.traceStore.updateSpan(thoughtSpanId, { status: 'completed' });
    }
    const planSpanId = keyMap.get('plan');
    if (planSpanId) {
      this.traceStore.updateSpan(planSpanId, { status: 'completed' });
    }
  }

  onToolCallEnd(
    runId: string,
    toolName: string,
    status: 'completed' | 'failed' = 'completed',
    output?: unknown,
    callId?: string
  ): RunSpan | undefined {
    const keyMap = this.activeRunSpans.get(runId);
    if (!keyMap) return undefined;

    let spanId: string | undefined;
    if (callId && keyMap.has(`tool:${callId}`)) {
      spanId = keyMap.get(`tool:${callId}`);
      keyMap.delete(`tool:${callId}`);
    } else {
      // Find matching tool call by prefix
      const prefix = `tool:${toolName}:`;
      for (const [k, id] of keyMap.entries()) {
        if (k.startsWith(prefix)) {
          spanId = id;
          keyMap.delete(k);
          break;
        }
      }
      if (!spanId && keyMap.has(`tool:${toolName}`)) {
        spanId = keyMap.get(`tool:${toolName}`);
        keyMap.delete(`tool:${toolName}`);
      }
    }

    if (!spanId) return undefined;

    const sanitizedOutput = sanitizePayload(output);
    const updated = this.traceStore.updateSpan(spanId, {
      status,
      outputJson: sanitizedOutput || null,
    });

    return updated;
  }

  onModelCall(runId: string, modelName: string, usage?: TokenUsage): RunSpan {
    this.startRun(runId);
    const keyMap = this.activeRunSpans.get(runId)!;
    const parentSpanId = keyMap.get('thought') || keyMap.get('plan') || null;

    const span = this.traceStore.insertSpan({
      runId,
      parentSpanId,
      kind: 'model_call',
      name: `Model Call: ${modelName}`,
      status: 'completed',
      inputJson: { model: modelName },
    });

    if (usage) {
      this.traceStore.updateSpan(span.id, { usageJson: usage });
    }

    return span;
  }

  endRun(runId: string, status: 'completed' | 'failed' = 'completed'): void {
    const keyMap = this.activeRunSpans.get(runId);
    if (!keyMap) return;

    for (const [, spanId] of keyMap.entries()) {
      this.traceStore.updateSpan(spanId, { status });
    }

    this.activeRunSpans.delete(runId);
  }
}

function sanitizeString(str: string): string {
  const redacted = redactSecrets(str || '');
  return redacted.length > MAX_PAYLOAD_CHARS ? `${redacted.slice(0, MAX_PAYLOAD_CHARS)}... [TRUNCATED]` : redacted;
}

function sanitizePayload(data: unknown): Record<string, unknown> | string | undefined {
  if (data === undefined || data === null) return undefined;
  if (typeof data === 'string') {
    return sanitizeString(data);
  }
  let str: string;
  try {
    str = JSON.stringify(data);
  } catch {
    str = String(data);
  }

  const redacted = sanitizeString(str);
  try {
    return JSON.parse(redacted) as Record<string, unknown>;
  } catch {
    return redacted;
  }
}
