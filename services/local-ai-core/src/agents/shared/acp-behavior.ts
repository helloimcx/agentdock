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

export type AgentAcpPermissionOption = {
  optionId: string;
  name: string;
  kind: string;
  normalizedAction: string;
};

export type AgentAcpPermissionInput = {
  options: AgentAcpPermissionOption[];
  params?: unknown;
};

export type AgentAcpBehavior = {
  normalizeAssistantText(input: AgentAcpBehaviorInput): string;
  normalizeFinalAssistantText(input: AgentAcpBehaviorInput): string;
  shouldSuppressProgress?(input: AgentAcpProgressInput): boolean;
  normalizePermissionOptions?(input: AgentAcpPermissionInput): AgentAcpPermissionOption[];
};

export const standardAcpBehavior: AgentAcpBehavior = {
  normalizeAssistantText(input) {
    return input.rawText;
  },
  normalizeFinalAssistantText(input) {
    return input.rawText;
  },
};
