import type { LocalCoreTraceStore } from './store/trace-store.js';
import type { TokenUsage, RunSpan } from '@cc/superai-contracts';

export class AcpTraceProjector {
  private activeRunSpans = new Map<string, Map<string, string>>(); // runId -> (key -> spanId)

  constructor(private readonly traceStore: LocalCoreTraceStore) {}

  startRun(runId: string): string {
    if (!this.activeRunSpans.has(runId)) {
      this.activeRunSpans.set(runId, new Map());
    }
    return runId;
  }

  onThought(runId: string, text: string): RunSpan {
    this.startRun(runId);
    const keyMap = this.activeRunSpans.get(runId)!;
    let spanId = keyMap.get('thought');

    if (!spanId) {
      const span = this.traceStore.insertSpan({
        runId,
        kind: 'thought',
        name: 'Thought / Reasoning',
        status: 'running',
        inputJson: { preview: text.slice(0, 200) },
      });
      spanId = span.id;
      keyMap.set('thought', spanId);
      return span;
    } else {
      const updated = this.traceStore.updateSpan(spanId, {
        outputJson: { preview: text.slice(0, 500) },
      });
      return updated!;
    }
  }

  onPlan(runId: string, planText: string): RunSpan {
    this.startRun(runId);
    const keyMap = this.activeRunSpans.get(runId)!;
    let spanId = keyMap.get('plan');

    if (!spanId) {
      const span = this.traceStore.insertSpan({
        runId,
        kind: 'plan',
        name: 'Plan Step',
        status: 'running',
        inputJson: { plan: planText },
      });
      spanId = span.id;
      keyMap.set('plan', spanId);
      return span;
    } else {
      const updated = this.traceStore.updateSpan(spanId, {
        outputJson: { plan: planText },
      });
      return updated!;
    }
  }

  onToolCallStart(runId: string, toolName: string, input?: Record<string, unknown> | string): RunSpan {
    this.startRun(runId);
    const keyMap = this.activeRunSpans.get(runId)!;
    const parentSpanId = keyMap.get('thought') || keyMap.get('plan') || null;

    const span = this.traceStore.insertSpan({
      runId,
      parentSpanId,
      kind: 'tool_call',
      name: toolName,
      status: 'running',
      inputJson: input || null,
    });

    keyMap.set(`tool:${toolName}`, span.id);
    return span;
  }

  onToolCallEnd(
    runId: string,
    toolName: string,
    status: 'completed' | 'failed' = 'completed',
    output?: Record<string, unknown> | string
  ): RunSpan | undefined {
    const keyMap = this.activeRunSpans.get(runId);
    if (!keyMap) return undefined;

    const spanId = keyMap.get(`tool:${toolName}`);
    if (!spanId) return undefined;

    const updated = this.traceStore.updateSpan(spanId, {
      status,
      outputJson: output || null,
    });

    keyMap.delete(`tool:${toolName}`);
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

    for (const [key, spanId] of keyMap.entries()) {
      this.traceStore.updateSpan(spanId, { status });
    }

    this.activeRunSpans.delete(runId);
  }
}
