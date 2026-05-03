export function extractToolUpdateContent(content: unknown) {
  return Array.isArray(content)
    ? content
        .map((entry: any) =>
          entry?.type === 'content' && entry?.content?.type === 'text'
            ? String(entry.content.text || '')
            : '')
        .filter(Boolean)
        .join('\n')
    : '';
}

export function formatToolProgressMessage(input: {
  toolName?: string;
  title: string;
  status: string;
  content: string;
}) {
  const detail = [input.title, input.status, input.content].filter(Boolean).join(' - ');
  return input.toolName ? `🔧 ${input.toolName}: ${detail || 'Tool update'}` : `🔧 ${detail || 'Tool update'}`;
}

export function resolveToolUpdateDisplayTitle(input: {
  title: string;
  status: string;
  priorDetail?: string;
}) {
  const title = input.title.trim();
  if (input.priorDetail && (isTerminalToolStatus(input.status) || /^tool update$/i.test(title))) {
    return input.priorDetail;
  }
  if (isTerminalToolStatus(input.status) && /^tool update$/i.test(title)) {
    return '';
  }
  return input.title;
}

export function isEmptyRunningToolUpdate(input: {
  title: string;
  status: string;
  content: string;
}) {
  return !input.content.trim() &&
    /^running$/i.test(input.status) &&
    (!input.title.trim() || /^tool update$/i.test(input.title));
}

export function isTerminalToolStatus(status: string) {
  return /^(completed|failed|error|cancelled|canceled)$/i.test(status.trim());
}

export function formatPlanProgress(entries: unknown[]) {
  const summary = entries
    .map((entry: any) => String(entry?.content || '').trim())
    .filter(Boolean)
    .join(' | ');
  return summary ? `💭 ${summary}` : '';
}

export function extractToolCallKey(update: Record<string, unknown>) {
  for (const key of ['toolCallId', 'tool_call_id', 'callId', 'call_id', 'invocationId', 'invocation_id', 'id']) {
    const value = update[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const normalized = String(value).trim();
      if (normalized) {
        return normalized;
      }
    }
  }
  return '';
}
