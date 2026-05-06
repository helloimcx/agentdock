import type { AgentAcpBehavior } from '../shared/acp-behavior.js';
import { hasPriorProgressMessage } from '../shared/progress-replay.js';
import { stripAssistantReplayPrefix } from '../shared/replay-prefix.js';

function allowsPermanentPermission(params: unknown): boolean {
  if (!params || typeof params !== 'object') {
    return true;
  }
  const record = params as Record<string, unknown>;
  return record.allow_permanent !== false && record.allowPermanent !== false;
}

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
  normalizePermissionOptions(input) {
    if (allowsPermanentPermission(input.params)) {
      return input.options;
    }
    return input.options.filter((option) => option.normalizedAction !== 'allow all');
  },
};
