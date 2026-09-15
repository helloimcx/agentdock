export type SessionHandoffStatus = 'pending' | 'consumed' | 'superseded';

export interface SessionHandoffPayload {
  threadId: string;
  runId: string;
  fromAgent: string;
  toAgent?: string;
  summary: string;
  decisions: string[];
  openQuestions: string[];
  nextSteps: string[];
  artifacts: string[];
  toolSummary?: Record<string, unknown>;
}

export interface SessionHandoffRecord extends SessionHandoffPayload {
  id: string;
  status: SessionHandoffStatus;
  createdAt: string;
  consumedAt?: string | null;
  consumedByRunId?: string | null;
}

export function normalizeSessionHandoffStatus(status: unknown): SessionHandoffStatus {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'consumed') return 'consumed';
  if (normalized === 'superseded') return 'superseded';
  return 'pending';
}

export function formatSessionHandoffDelimiter(handoff: SessionHandoffPayload): string {
  const lines: string[] = [
    `[Session Handoff from ${handoff.fromAgent}${handoff.toAgent ? ` to ${handoff.toAgent}` : ''}]`,
    `Source Run: ${handoff.runId}`,
    `Summary: ${handoff.summary || '(None)'}`,
  ];

  if (handoff.decisions && handoff.decisions.length > 0) {
    lines.push('Key Decisions:');
    for (const d of handoff.decisions) {
      lines.push(`- ${d}`);
    }
  }

  if (handoff.artifacts && handoff.artifacts.length > 0) {
    lines.push('Artifacts & Modified Files:');
    for (const a of handoff.artifacts) {
      lines.push(`- ${a}`);
    }
  }

  if (handoff.openQuestions && handoff.openQuestions.length > 0) {
    lines.push('Open Questions / Pending Issues:');
    for (const q of handoff.openQuestions) {
      lines.push(`- ${q}`);
    }
  }

  if (handoff.nextSteps && handoff.nextSteps.length > 0) {
    lines.push('Suggested Next Steps:');
    for (const s of handoff.nextSteps) {
      lines.push(`- ${s}`);
    }
  }

  lines.push('[/Session Handoff]');
  return lines.join('\n');
}

export function parseSessionHandoffDelimiter(text: string): { fromAgent: string; toAgent?: string; body: string } | null {
  const match = text.match(/\[Session Handoff from ([^\s\]]+)(?: to ([^\s\]]+))?\]([\s\S]*?)\[\/Session Handoff\]/);
  if (!match) return null;
  return {
    fromAgent: match[1],
    toAgent: match[2] || undefined,
    body: match[3].trim(),
  };
}

export function extractSessionHandoffDelimiter(text: string): { handoff: { fromAgent: string; toAgent?: string; body: string }; remainingText: string } | null {
  const match = text.match(/\[Session Handoff from ([^\s\]]+)(?: to ([^\s\]]+))?\]([\s\S]*?)\[\/Session Handoff\]/);
  if (!match) return null;
  return {
    handoff: {
      fromAgent: match[1],
      toAgent: match[2] || undefined,
      body: match[3].trim(),
    },
    remainingText: text.replace(match[0], '').trim(),
  };
}

