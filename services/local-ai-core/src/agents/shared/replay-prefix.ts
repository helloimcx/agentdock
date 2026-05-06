export function stripAssistantReplayPrefix(rawText: string, priorAssistantMessages: string[]) {
  const replayPrefix = priorAssistantMessages.join('');
  if (!replayPrefix || !rawText) {
    return rawText;
  }
  if (replayPrefix.startsWith(rawText)) {
    return '';
  }
  if (priorAssistantMessages.some((message) => message.startsWith(rawText))) {
    return '';
  }
  if (rawText.startsWith(replayPrefix)) {
    return rawText.slice(replayPrefix.length);
  }
  const anchoredText = stripAfterLatestPriorMessageAnchor(rawText, priorAssistantMessages);
  if (anchoredText !== null) {
    return anchoredText;
  }
  const overlap = longestSuffixPrefixOverlap(replayPrefix, rawText);
  if (overlap > 0 && overlap === rawText.length) {
    return '';
  }
  return rawText;
}

function stripAfterLatestPriorMessageAnchor(rawText: string, priorAssistantMessages: string[]) {
  let latestMatch: { index: number; length: number } | null = null;
  for (const message of priorAssistantMessages) {
    for (const anchor of createPriorMessageAnchors(message)) {
      const index = rawText.lastIndexOf(anchor);
      if (index < 0) {
        continue;
      }
      const match = { index, length: anchor.length };
      if (!latestMatch || match.index + match.length > latestMatch.index + latestMatch.length) {
        latestMatch = match;
      }
    }
  }
  if (!latestMatch) {
    return null;
  }
  return rawText.slice(latestMatch.index + latestMatch.length);
}

function createPriorMessageAnchors(message: string) {
  const trimmed = message.trim();
  if (trimmed.length < 32) {
    return [];
  }
  const anchors: string[] = [];
  for (const length of [240, 160, 96, 48, 32]) {
    if (trimmed.length >= length) {
      anchors.push(trimmed.slice(-length));
    }
  }
  return anchors;
}

function longestSuffixPrefixOverlap(prefix: string, value: string) {
  const max = Math.min(prefix.length, value.length);
  for (let size = max; size > 0; size -= 1) {
    if (prefix.endsWith(value.slice(0, size))) {
      return size;
    }
  }
  return 0;
}
