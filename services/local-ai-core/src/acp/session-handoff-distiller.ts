import type { RunSpan, SessionHandoffPayload, ThreadMessage } from '@cc/superai-contracts';

export interface DistillHandoffInput {
  threadId: string;
  fromAgent: string;
  toAgent?: string;
  lastRunId?: string;
  spans?: RunSpan[];
  messages?: ThreadMessage[];
}

const MAX_SUMMARY_CHARS = 300;
const MAX_ITEM_CHARS = 150;
const MAX_DECISIONS = 6;
const MAX_ARTIFACTS = 15;
const MAX_QUESTIONS = 5;
const MAX_STEPS = 6;

function extractPathFromInput(inputStr: string): string | null {
  try {
    const parsed = JSON.parse(inputStr);
    const target = parsed.targetFile || parsed.TargetFile || parsed.path || parsed.filePath || parsed.target;
    if (typeof target === 'string' && target.trim()) {
      return target.trim();
    }
  } catch {
    const match = inputStr.match(/(?:^|\s|["'`])([a-zA-Z0-9_\-\./]+\.[a-zA-Z0-9_\-]+)(?:["'`]|\s|$)/);
    if (match?.[1] && !match[1].startsWith('http') && match[1].includes('.')) {
      return match[1];
    }
  }
  return null;
}

export class SessionHandoffDistiller {
  /**
   * Deterministically distills a bounded session handoff payload from
   * execution traces and thread messages. Zero external LLM calls.
   */
  distill(input: DistillHandoffInput): SessionHandoffPayload {
    const { threadId, fromAgent, toAgent, lastRunId = `run:${Date.now()}` } = input;
    const spans = input.spans || [];
    const messages = input.messages || [];

    const artifacts = this.extractArtifacts(spans);
    const assistantMessages = messages.filter((m) => m.role === 'assistant');
    const lastAssistantText = assistantMessages.length > 0
      ? assistantMessages[assistantMessages.length - 1].content || ''
      : '';

    const summary = this.extractSummary(lastAssistantText, fromAgent);
    const decisions = this.extractDecisions(assistantMessages);
    const openQuestions = this.extractOpenQuestions(assistantMessages);
    const nextSteps = this.extractNextSteps(assistantMessages);
    const toolSummary = this.buildToolSummary(spans);

    return {
      threadId,
      runId: lastRunId,
      fromAgent,
      toAgent,
      summary,
      decisions,
      openQuestions,
      nextSteps,
      artifacts,
      toolSummary,
    };
  }

  private extractArtifacts(spans: RunSpan[]): string[] {
    const seen = new Set<string>();
    for (const span of spans) {
      if (span.kind !== 'tool_call') continue;
      const inputStr = typeof span.inputJson === 'string'
        ? span.inputJson
        : (span.inputJson ? JSON.stringify(span.inputJson) : '');
      if (!inputStr) continue;
      const target = extractPathFromInput(inputStr);
      if (target) seen.add(target);
    }
    return Array.from(seen).slice(0, MAX_ARTIFACTS);
  }

  private extractSummary(lastAssistantText: string, fromAgent: string): string {
    const trimmed = lastAssistantText.trim();
    if (!trimmed) {
      return `Session handoff from ${fromAgent}.`;
    }

    // Grab first non-empty paragraph
    const paragraphs = trimmed.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const firstPara = paragraphs[0] || trimmed;
    // Strip markdown formatting characters
    const clean = firstPara.replace(/[#*`_]/g, '').trim();
    return clean.slice(0, MAX_SUMMARY_CHARS);
  }

  private extractDecisions(messages: ThreadMessage[]): string[] {
    const results: string[] = [];
    const decisionRegex = /(?:决定|采用|选型|方案|已重构|已修复|已更新|选择|确认|Decided|Adopted|Selected|Fixed|Configured)[^。\n]*[。\n]?/gi;

    // Search in reverse from latest assistant messages
    for (let i = messages.length - 1; i >= 0 && results.length < MAX_DECISIONS; i--) {
      const content = messages[i].content || '';
      const matches = content.match(decisionRegex);
      if (matches) {
        for (const m of matches) {
          const item = m.trim().replace(/^[-*•\d\.\s]+/, '').replace(/[#*`]/g, '').trim();
          if (item.length > 5 && !results.includes(item)) {
            results.push(item.slice(0, MAX_ITEM_CHARS));
            if (results.length >= MAX_DECISIONS) break;
          }
        }
      }
    }

    return results;
  }

  private extractOpenQuestions(messages: ThreadMessage[]): string[] {
    const results: string[] = [];
    const questionRegex = /(?:待确认|需明确|未解决|是否|注意|风险|TODO|Pending|Open Question)[^。\n]*[。\n?？]?/gi;

    for (let i = messages.length - 1; i >= 0 && results.length < MAX_QUESTIONS; i--) {
      const content = messages[i].content || '';
      const matches = content.match(questionRegex);
      if (matches) {
        for (const m of matches) {
          const item = m.trim().replace(/^[-*•\d\.\s]+/, '').replace(/[#*`]/g, '').trim();
          if (item.length > 5 && !results.includes(item)) {
            results.push(item.slice(0, MAX_ITEM_CHARS));
            if (results.length >= MAX_QUESTIONS) break;
          }
        }
      }
    }

    return results;
  }

  private extractNextSteps(messages: ThreadMessage[]): string[] {
    const results: string[] = [];
    const stepRegex = /(?:下一步|后续|Next Steps?|建议)[：:\n]([\s\S]*?)(?:\n\n|$)/i;

    for (let i = messages.length - 1; i >= 0 && results.length < MAX_STEPS; i--) {
      const content = messages[i].content || '';
      const blockMatch = content.match(stepRegex);
      if (blockMatch && blockMatch[1]) {
        const lines = blockMatch[1].split('\n').map((l) => l.trim()).filter((l) => /^[-*•\d\.]/.test(l));
        for (const l of lines) {
          const item = l.replace(/^[-*•\d\.\s]+/, '').replace(/[#*`]/g, '').trim();
          if (item.length > 3 && !results.includes(item)) {
            results.push(item.slice(0, MAX_ITEM_CHARS));
            if (results.length >= MAX_STEPS) break;
          }
        }
      }
    }

    return results;
  }

  private buildToolSummary(spans: RunSpan[]): Record<string, unknown> {
    const toolSpans = spans.filter((s) => s.kind === 'tool_call');
    if (toolSpans.length === 0) return {};

    const toolCounts: Record<string, number> = {};
    for (const span of toolSpans) {
      toolCounts[span.name] = (toolCounts[span.name] || 0) + 1;
    }

    return {
      totalToolCalls: toolSpans.length,
      tools: toolCounts,
    };
  }
}

export function distillSessionHandoff(input: DistillHandoffInput): SessionHandoffPayload {
  return new SessionHandoffDistiller().distill(input);
}

