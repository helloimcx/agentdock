export type AgentAcpBehaviorInput = {
  rawText: string;
  priorAssistantMessages: string[];
};

export type AgentAcpProgressKind = 'tool' | 'thought' | 'plan' | 'permission' | 'status' | 'assistant';

export type AgentAcpProgressRecord = {
  kind?: AgentAcpProgressKind;
  content: string;
};

export type AgentAcpProgressInput = {
  kind?: AgentAcpProgressKind;
  content: string;
  priorProgressMessages: AgentAcpProgressRecord[];
};

export type AgentAcpBehavior = {
  normalizeAssistantText(input: AgentAcpBehaviorInput): string;
  normalizeFinalAssistantText(input: AgentAcpBehaviorInput): string;
  shouldSuppressProgress?(input: AgentAcpProgressInput): boolean;
};

export const standardAcpBehavior: AgentAcpBehavior = {
  normalizeAssistantText(input) {
    return input.rawText;
  },
  normalizeFinalAssistantText(input) {
    return input.rawText;
  },
};
