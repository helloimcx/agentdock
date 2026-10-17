import type { ButlerBotMessageKind, ButlerBotProtocolMessage } from '@cc/superai-contracts';

const MARKER = 'AGENTDOCK_BUTLER_V1:';
const MAX_PROTOCOL_BYTES = 24 * 1024;
const KINDS = new Set<ButlerBotMessageKind>([
  'task.submit', 'task.accepted', 'task.progress', 'task.result', 'task.followup', 'task.cancel',
]);

export function encodeButlerBotProtocolMessage(message: ButlerBotProtocolMessage): string {
  const payload = Buffer.from(JSON.stringify(message), 'utf8').toString('base64url');
  const encoded = `${MARKER}${payload}`;
  if (Buffer.byteLength(encoded, 'utf8') > MAX_PROTOCOL_BYTES) throw new Error('Butler bot protocol message is too large.');
  return `AgentDock 管家协作消息：${message.kind}\n${encoded}`;
}

export function decodeButlerBotProtocolMessage(text: string): ButlerBotProtocolMessage | undefined {
  const match = String(text || '').match(new RegExp(`${MARKER}([A-Za-z0-9_-]+)`));
  if (!match || Buffer.byteLength(match[0], 'utf8') > MAX_PROTOCOL_BYTES) return undefined;
  try {
    const value = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')) as Partial<ButlerBotProtocolMessage>;
    if (!hasValidEnvelopeIdentity(value) || !hasValidEnvelopePayload(value) || !hasValidApprovalIds(value.approvalIds)) return undefined;
    return value as ButlerBotProtocolMessage;
  } catch {
    return undefined;
  }
}

function hasValidEnvelopeIdentity(value: Partial<ButlerBotProtocolMessage>): boolean {
  return value.protocol === 'agentdock.butler' && value.version === 1 && KINDS.has(value.kind as ButlerBotMessageKind)
    && [value.taskId, value.delegationId, value.operationId, value.managerBotId, value.targetBotId].every(nonEmptyString);
}

function hasValidEnvelopePayload(value: Partial<ButlerBotProtocolMessage>): boolean {
  switch (value.kind) {
    case 'task.submit': return nonEmptyString(value.title) && nonEmptyString(value.prompt);
    case 'task.followup': return nonEmptyString(value.content);
    case 'task.progress': return ['running', 'waiting_for_user'].includes(String(value.workerStatus));
    case 'task.result': return ['completed', 'failed', 'cancelled'].includes(String(value.outcome));
    default: return true;
  }
}

function hasValidApprovalIds(value: unknown): boolean {
  if (value === undefined) return true;
  return Array.isArray(value) && value.length <= 64 && value.every(nonEmptyString);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
}
