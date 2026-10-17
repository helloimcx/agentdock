import type { AcpSessionState } from '../router/workspace-router-types.js';

type RunningTurn = NonNullable<AcpSessionState['currentTurn']>;
type RunningToolCall = NonNullable<RunningTurn['pendingToolCalls']>[string];
type RunningToolObservation = NonNullable<RunningTurn['toolObservations']>[number];

export type MessagePreviewProjection = {
  bridgeType: 'preview_start' | 'update_message';
  previewHandle: string;
  content: string;
  bridgeKind: 'assistant';
};

export type ThoughtProgressProjection = {
  bridgeType: 'preview_start' | 'update_message';
  previewHandle: string;
  messageId: string;
  content: string;
  bridgeKind: 'thought';
};

export type AssistantMessageSegmentProjection = {
  messageId: string;
  content: string;
  bridgeKind: 'assistant';
};

export type PendingToolCallRegistration = {
  key: string;
  title: string;
  messageId: string;
  input?: unknown;
  sequence: number;
  emitted: boolean;
  suppressReplay?: boolean;
};

export function applyAssistantMessageChunk(currentTurn: RunningTurn, text: string): MessagePreviewProjection | null {
  if (!text) {
    return null;
  }
  currentTurn.assistantText += text;
  if (!currentTurn.previewStarted) {
    currentTurn.previewStarted = true;
    return {
      bridgeType: 'preview_start',
      previewHandle: currentTurn.previewHandle,
      content: currentTurn.assistantText,
      bridgeKind: 'assistant',
    };
  }
  return {
    bridgeType: 'update_message',
    previewHandle: currentTurn.previewHandle,
    content: currentTurn.assistantText,
    bridgeKind: 'assistant',
  };
}

export function applyThoughtChunk(currentTurn: RunningTurn, text: string): ThoughtProgressProjection | null {
  if (!text) {
    return null;
  }
  const projection = mergeThoughtSegment(currentTurn.thoughtText, text);
  currentTurn.thoughtText = projection.fullText;
  const content = currentTurn.thoughtText.trim();
  if (!content) {
    return null;
  }
  if (!currentTurn.thoughtPreviewStarted) {
    currentTurn.thoughtPreviewStarted = true;
    return {
      bridgeType: 'preview_start',
      previewHandle: currentTurn.thoughtPreviewHandle,
      messageId: currentTurn.thoughtMessageId,
      content,
      bridgeKind: 'thought',
    };
  }
  return {
    bridgeType: 'update_message',
    previewHandle: currentTurn.thoughtPreviewHandle,
    messageId: currentTurn.thoughtMessageId,
    content,
    bridgeKind: 'thought',
  };
}

export function closeThoughtSegment(currentTurn: RunningTurn) {
  const thoughtText = currentTurn.thoughtText || '';
  if (!thoughtText.trim()) {
    return;
  }
  const nextSequence = (currentTurn.thoughtSequence || 1) + 1;
  const runId = currentTurn.runId || 'thought';
  currentTurn.thoughtSequence = nextSequence;
  currentTurn.thoughtText = '';
  currentTurn.thoughtPreviewStarted = false;
  currentTurn.thoughtMessageId = `${runId}-thought-${nextSequence}`;
  currentTurn.thoughtPreviewHandle = `${runId}-thought-preview-${nextSequence}`;
}

export function closeAssistantMessageSegment(currentTurn: RunningTurn): AssistantMessageSegmentProjection | null {
  const content = currentTurn.assistantText || '';
  if (!content.trim()) {
    resetAssistantMessageSegment(currentTurn);
    return null;
  }
  const messageId = currentTurn.assistantMessageId || currentTurn.previewHandle;
  resetAssistantMessageSegment(currentTurn);
  return {
    messageId,
    content,
    bridgeKind: 'assistant',
  };
}

function resetAssistantMessageSegment(currentTurn: RunningTurn) {
  const runId = currentTurn.runId || 'assistant';
  const nextSequence = (currentTurn.assistantSequence || 1) + 1;
  currentTurn.assistantSequence = nextSequence;
  currentTurn.assistantText = '';
  currentTurn.rawAssistantText = '';
  currentTurn.previewStarted = false;
  currentTurn.assistantMessageId = `${runId}-assistant-${nextSequence}`;
  currentTurn.previewHandle = `${runId}-assistant-preview-${nextSequence}`;
}

function mergeThoughtSegment(current: string, next: string) {
  if (!current) {
    return { fullText: next, segmentText: next };
  }
  if (next.startsWith(current)) {
    return {
      fullText: next,
      segmentText: next.slice(current.length),
    };
  }
  if (current.endsWith(next)) {
    return {
      fullText: current,
      segmentText: '',
    };
  }
  const maxOverlap = Math.min(current.length, next.length);
  for (let size = maxOverlap; size > 0; size -= 1) {
    if (current.endsWith(next.slice(0, size))) {
      const suffix = next.slice(size);
      return {
        fullText: current + suffix,
        segmentText: suffix,
      };
    }
  }
  return {
    fullText: appendThoughtPiece(current, next),
    segmentText: next,
  };
}

function appendThoughtPiece(current: string, next: string) {
  if (!current.trim()) {
    return next;
  }
  if (!next.trim()) {
    return current;
  }
  if (/^[,.;:!?，。；：！？、）】》]/.test(next.trimStart())) {
    return current.trimEnd() + next.trimStart();
  }
  if (/^[-/]/.test(next.trimStart()) || /[-/][A-Za-z0-9]*$/.test(current.trimEnd())) {
    return current.trimEnd() + next.trimStart();
  }
  if (/\s$/.test(current) || /^\s/.test(next)) {
    return current + next;
  }
  return `${current.trimEnd()} ${next.trimStart()}`;
}

export function registerPendingToolCall(input: {
  currentTurn: RunningTurn;
  runId: string;
  update: Record<string, unknown>;
}): PendingToolCallRegistration {
  const title = String(input.update.title || 'Running tool').trim();
  const nextSequence = (input.currentTurn.toolCallSequence || 0) + 1;
  input.currentTurn.toolCallSequence = nextSequence;
  const key = extractToolCallKey(input.update) || `sequence:${nextSequence}`;
  const toolInput = extractToolCallInput(input.update);
  const toolCall = {
    key,
    title,
    messageId: `${input.runId}-tool-${nextSequence}`,
    ...(toolInput === undefined ? {} : { input: toolInput }),
    sequence: nextSequence,
    emitted: false,
  };
  input.currentTurn.pendingToolCalls = {
    ...(input.currentTurn.pendingToolCalls || {}),
    [key]: toolCall,
  };
  input.currentTurn.pendingToolCallOrder = [
    ...(input.currentTurn.pendingToolCallOrder || []).filter((item) => item !== key),
    key,
  ];
  input.currentTurn.activeToolCallKey = key;
  return toolCall;
}

export function resolveToolCallForUpdate(currentTurn: RunningTurn, update: Record<string, unknown>) {
  const explicitKey = extractToolCallKey(update);
  if (explicitKey && currentTurn.pendingToolCalls?.[explicitKey]) {
    currentTurn.activeToolCallKey = explicitKey;
    return currentTurn.pendingToolCalls[explicitKey];
  }
  return resolveFallbackToolCall(currentTurn);
}

export function resolveFallbackToolCall(currentTurn: RunningTurn) {
  const active = currentTurn.activeToolCallKey
    ? currentTurn.pendingToolCalls?.[currentTurn.activeToolCallKey]
    : undefined;
  if (active) {
    return active;
  }
  const ordered = getToolCallsInOrder(currentTurn);
  return ordered[ordered.length - 1];
}

export function getToolCallsInOrder(currentTurn: RunningTurn) {
  const toolCalls = currentTurn.pendingToolCalls || {};
  const orderedKeys = currentTurn.pendingToolCallOrder || [];
  return orderedKeys
    .map((key) => toolCalls[key])
    .filter((toolCall): toolCall is RunningToolCall => Boolean(toolCall));
}

export function deletePendingToolCall(currentTurn: RunningTurn, key: string) {
  if (currentTurn.pendingToolCalls) {
    delete currentTurn.pendingToolCalls[key];
  }
  currentTurn.pendingToolCallOrder = (currentTurn.pendingToolCallOrder || []).filter((item) => item !== key);
  if (currentTurn.activeToolCallKey === key) {
    currentTurn.activeToolCallKey = undefined;
  }
}

export function syncLegacyPendingToolCall(currentTurn: RunningTurn, toolCall?: RunningToolCall) {
  currentTurn.pendingToolCallTitle = toolCall?.title;
  currentTurn.pendingToolCallId = toolCall?.messageId;
  currentTurn.pendingToolCallDetail = toolCall?.detail;
  currentTurn.activeToolCallKey = toolCall?.key;
}

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
  return summary;
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

export function extractToolCallInput(update: Record<string, unknown>) {
  for (const key of ['input', 'parameters', 'arguments', 'args', 'rawInput']) {
    if (Object.prototype.hasOwnProperty.call(update, key)) {
      return update[key];
    }
  }
  return undefined;
}

export function recordToolObservation(currentTurn: RunningTurn, observation: RunningToolObservation) {
  const normalized = {
    ...observation,
    name: observation.name?.trim() || undefined,
    title: observation.title?.trim() || undefined,
    status: observation.status?.trim() || undefined,
    outputText: observation.outputText?.trim() || undefined,
  };
  if (!normalized.name && !normalized.title && normalized.input === undefined && !normalized.outputText) {
    return;
  }
  currentTurn.toolObservations = [
    ...(currentTurn.toolObservations || []),
    normalized,
  ];
}

export function stripObservedToolTranscriptsFromAssistantText(text: string, observations: RunningToolObservation[] | undefined) {
  let remaining = String(text || '');
  const knownObservations = observations || [];
  for (let guard = 0; guard < knownObservations.length; guard += 1) {
    const stripped = stripOneObservedToolTranscriptPrefix(remaining, knownObservations);
    if (stripped === remaining) {
      break;
    }
    remaining = stripped;
  }
  return remaining.trim();
}

function stripOneObservedToolTranscriptPrefix(text: string, observations: RunningToolObservation[]) {
  const trimmedStart = text.replace(/^\s+/, '');
  if (!trimmedStart) {
    return text;
  }
  const matchingEvidence = observations
    .map((observation) => createToolObservationEvidence(observation))
    .find((evidence) => matchesObservedToolTranscriptPrefix(trimmedStart, evidence));
  if (!matchingEvidence) {
    return text;
  }
  const boundary = findToolTranscriptPrefixBoundary(trimmedStart, matchingEvidence);
  if (boundary <= 0) {
    return text;
  }
  return trimmedStart.slice(boundary);
}

type ToolObservationEvidence = {
  toolNames: string[];
  urls: string[];
  phrases: string[];
};

function createToolObservationEvidence(observation: RunningToolObservation): ToolObservationEvidence {
  const serializedInput = serializeObservationValue(observation.input);
  const serializedOutput = observation.outputText || '';
  const structuredValues = collectStructuredStringValues(serializedOutput);
  return {
    toolNames: uniqueNonEmpty([
      observation.name,
      observation.title,
    ].map((value) => normalizeEvidencePhrase(value || ''))),
    urls: uniqueNonEmpty([
      ...extractUrls(serializedInput),
      ...extractUrls(serializedOutput),
    ]),
    phrases: uniqueNonEmpty([
      ...structuredValues,
      observation.title,
      serializedInput.length <= 300 ? serializedInput : '',
    ].map((value) => normalizeEvidencePhrase(value || '')).filter((value) => value.length >= 12)),
  };
}

function matchesObservedToolTranscriptPrefix(text: string, evidence: ToolObservationEvidence) {
  const prefix = text.slice(0, 3000);
  const normalizedPrefix = normalizeEvidencePhrase(prefix);
  const hasToolName = evidence.toolNames.some((name) => name && normalizedPrefix.includes(name));
  const urlMatches = evidence.urls.filter((url) => prefix.includes(url)).length;
  const phraseMatches = evidence.phrases.filter((phrase) => normalizedPrefix.includes(phrase)).length;
  if (hasToolName && (urlMatches > 0 || phraseMatches > 0)) {
    return true;
  }
  return urlMatches > 0 && phraseMatches > 0;
}

function findToolTranscriptPrefixBoundary(text: string, evidence: ToolObservationEvidence) {
  const lines = text.split(/\n/);
  const firstContentLine = lines.find((line) => line.trim());
  if (!firstContentLine || !isTranscriptStartLine(firstContentLine, evidence)) {
    return 0;
  }
  let offset = 0;
  let seenEvidence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || '';
    const lineWithNewlineLength = line.length + (index < lines.length - 1 ? 1 : 0);
    if (lineContainsObservationEvidence(line, evidence)) {
      seenEvidence = true;
    }
    if (seenEvidence && index > 0 && line.trim() && !isStructuredTranscriptLine(line, evidence)) {
      return offset;
    }
    offset += lineWithNewlineLength;
  }
  return 0;
}

function isTranscriptStartLine(line: string, evidence: ToolObservationEvidence) {
  const trimmed = line.trim();
  return lineContainsObservationEvidence(line, evidence) &&
    (/^(```|\{|\[|\*\*[^*]+\*\*|#+\s)/.test(trimmed) || /^[A-Za-z0-9_.-]+:/.test(trimmed));
}

function isStructuredTranscriptLine(line: string, evidence: ToolObservationEvidence) {
  const trimmed = line.trim();
  if (!trimmed) {
    return true;
  }
  if (lineContainsObservationEvidence(line, evidence)) {
    return true;
  }
  return /^(```|\{|\}|\[|\]|".+":|\*\*[^*]+:\*\*|\*[^*]+\*|#+\s)/.test(trimmed) ||
    /[:：]\s*$/.test(trimmed) ||
    /[{}\[\]"]/g.test(trimmed) ||
    /^[A-Za-z0-9_.-]+:/.test(trimmed);
}

function lineContainsObservationEvidence(line: string, evidence: ToolObservationEvidence) {
  const normalizedLine = normalizeEvidencePhrase(line);
  return evidence.toolNames.some((name) => name && normalizedLine.includes(name)) ||
    evidence.urls.some((url) => line.includes(url)) ||
    evidence.phrases.some((phrase) => phrase && normalizedLine.includes(phrase));
}

function serializeObservationValue(value: unknown) {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function collectStructuredStringValues(text: string) {
  const values: string[] = [];
  try {
    collectStringValues(JSON.parse(text), values);
  } catch {
    const matches = text.matchAll(/"(title|description|url|name|summary)"\s*:\s*"([^"]{12,})"/gi);
    for (const match of matches) {
      values.push(match[2] || '');
    }
  }
  return values;
}

function collectStringValues(value: unknown, values: string[]) {
  if (typeof value === 'string') {
    values.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringValues(item, values);
    }
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const entry of Object.values(value)) {
    collectStringValues(entry, values);
  }
}

function extractUrls(text: string) {
  return [...text.matchAll(/https?:\/\/[^\s"'`<>),\]}]+/g)]
    .map((match) => match[0])
    .filter(Boolean);
}

function normalizeEvidencePhrase(value: string) {
  return String(value || '')
    .replace(/\\[nrt]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function uniqueNonEmpty(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
