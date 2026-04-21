import type { RunningPermissionRequest } from '../router/workspace-router-types.js';

type DesktopBridgeButtonNormalizer = (input: { text: string; data: string }) => { text: string; data: string } | null;

export function normalizePermissionAction(kind?: string | null) {
  const normalized = String(kind || '').trim().toLowerCase();
  if (normalized === 'allow_always') {
    return 'allow all';
  }
  if (normalized.startsWith('allow')) {
    return 'allow';
  }
  if (normalized.startsWith('reject')) {
    return 'deny';
  }
  return '';
}

export function formatToolCallContent(toolCall: Record<string, unknown> | null | undefined) {
  if (!toolCall || typeof toolCall !== 'object') {
    return 'Permission required before continuing.';
  }
  const title = typeof toolCall.title === 'string' ? toolCall.title.trim() : '';
  const content = Array.isArray(toolCall.content)
    ? toolCall.content
        .map((entry) => {
          if (!entry || typeof entry !== 'object') {
            return '';
          }
          if (typeof (entry as { text?: unknown }).text === 'string') {
            return String((entry as { text?: unknown }).text).trim();
          }
          const nested = (entry as { content?: { type?: string; text?: string } }).content;
          return nested?.type === 'text' ? String(nested.text || '').trim() : '';
        })
        .filter(Boolean)
        .join('\n')
    : '';
  return [title, content].filter(Boolean).join('\n\n') || 'Permission required before continuing.';
}

export function toPermissionButtonRows(
  options: RunningPermissionRequest['options'],
  normalizeButton: DesktopBridgeButtonNormalizer,
) {
  return [options.map((option) => {
    const data = option.normalizedAction
      ? `perm:${option.normalizedAction.replace(/\s+/g, '_')}`
      : option.optionId;
    const normalized = normalizeButton({
      text: option.normalizedAction || option.name,
      data,
    });
    return normalized || { text: option.name, data: option.optionId };
  })];
}
