import type { AgentAcpProgressInput } from './acp-behavior.js';

export function hasPriorProgressMessage(input: AgentAcpProgressInput) {
  const content = normalizeProgressContent(input.content);
  if (!content) {
    return false;
  }
  const kind = input.kind;
  return input.priorProgressMessages.some((message) => {
    if (kind && message.kind && message.kind !== kind) {
      return false;
    }
    return normalizeProgressContent(message.content) === content;
  });
}

function normalizeProgressContent(content: string) {
  return String(content || '').replace(/\r\n/g, '\n').trim();
}
