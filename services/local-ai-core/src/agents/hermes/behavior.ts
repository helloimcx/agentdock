import type { AgentAcpBehavior } from '../shared/acp-behavior.js';
import { hasPriorProgressMessage } from '../shared/progress-replay.js';
import { stripAssistantReplayPrefix } from '../shared/replay-prefix.js';

export const hermesAcpBehavior: AgentAcpBehavior = {
  normalizeAssistantText(input) {
    return stripAssistantReplayPrefix(input.rawText, input.priorAssistantMessages);
  },
  normalizeFinalAssistantText(input) {
    return stripAssistantReplayPrefix(input.rawText, input.priorAssistantMessages);
  },
  shouldSuppressProgress(input) {
    return hasPriorProgressMessage(input);
  },
};
