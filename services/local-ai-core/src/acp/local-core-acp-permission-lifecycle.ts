import { normalizePermissionOptionAction } from './workspace-acp-permissions.js';
import type { RunningPermissionRequest } from '../router/workspace-router-types.js';

export function parsePermissionOptions(options: unknown): RunningPermissionRequest['options'] {
  return Array.isArray(options)
    ? options
        .map((option: any) => ({
          optionId: String(option?.optionId || '').trim(),
          name: String(option?.name || option?.optionId || '').trim(),
          kind: String(option?.kind || '').trim(),
          normalizedAction: normalizePermissionOptionAction({
            optionId: option?.optionId,
            name: option?.name,
            kind: option?.kind,
          }),
        }))
        .filter((option: { optionId: string }) => option.optionId)
    : [];
}

export function createPermissionPrompt(toolTitle: string) {
  return [
    '等待工具确认',
    '',
    toolTitle,
    '',
    '请选择一个选项继续执行。',
    '',
    '若按钮没有显示，请直接回复：allow all / allow / deny',
  ].join('\n');
}
