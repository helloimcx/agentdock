import type { RouteHandler } from '../server-helpers.js';
import { json, readJsonBody } from '../server-helpers.js';
import type { WorkspaceRouter } from '../../router/workspace-router.js';
import type {
  ApprovalRequestCreateInput,
  ApprovalRequestResolveInput,
  WorkspaceSecuritySettingsUpdateInput,
} from '@cc/superai-contracts';
import { validateBody } from '../request-validation.js';

export function registerSecurityHandlers(
  map: Map<string, RouteHandler>,
  workspaceRouter: WorkspaceRouter,
) {
  map.set('workspace-security.get', async (route, _req, res) => {
    json(res, 200, await workspaceRouter.getWorkspaceSecuritySettings((route as { workspaceId: string }).workspaceId));
  });
  map.set('workspace-security.update', async (route, req, res) => {
    const body = validateBody<WorkspaceSecuritySettingsUpdateInput>(await readJsonBody(req), {
      permissions: 'object', allowPaths: { kind: 'array', elementKind: 'string' },
      denyPaths: { kind: 'array', elementKind: 'string' }, updatedBy: 'string',
    });
    json(res, 200, await workspaceRouter.updateWorkspaceSecuritySettings((route as { workspaceId: string }).workspaceId, body));
  });
  map.set('security.command-risk.classify', async (_route, req, res) => {
    const body = validateBody<{ command: string; workspaceId?: string }>(await readJsonBody(req), {
      command: { kind: 'string', required: true }, workspaceId: 'string',
    });
    json(res, 200, await workspaceRouter.classifyCommand(body.command, body.workspaceId));
  });
  map.set('approvals.list', async (_route, _req, res, url) => {
    const statusParam = url.searchParams.get('status') || '';
    const status = statusParam ? statusParam.split(',').map((item) => item.trim()).filter(Boolean) as import('@cc/superai-contracts').ApprovalRequestListQuery['status'] : undefined;
    json(res, 200, await workspaceRouter.listApprovalRequests({
      workspaceId: url.searchParams.get('workspace_id') || undefined,
      taskId: url.searchParams.get('task_id') || undefined,
      status,
      limit: Number(url.searchParams.get('limit') || '50'),
    }));
  });
  map.set('approvals.create', async (_route, req, res) => {
    const body = validateBody<ApprovalRequestCreateInput>(await readJsonBody(req), {
      workspaceId: { kind: 'string', required: true }, taskId: 'string', threadId: 'string', runId: 'string', deviceId: 'string',
      kind: { kind: 'string', required: true }, riskLevel: { kind: 'string', required: true }, title: { kind: 'string', required: true },
      description: { kind: 'string', required: true }, requestedAction: { kind: 'string', required: true }, command: 'string',
      scopes: { kind: 'array', elementKind: 'string' }, options: 'array', requestedBy: 'string', expiresAt: 'string', metadata: 'object',
    });
    json(res, 200, await workspaceRouter.createApprovalRequest(body));
  });
  map.set('approval.get', async (route, _req, res) => {
    json(res, 200, await workspaceRouter.getApprovalRequest((route as { approvalId: string }).approvalId));
  });
  map.set('approval.resolve', async (route, req, res) => {
    const body = validateBody<ApprovalRequestResolveInput>(await readJsonBody(req), {
      status: { kind: 'string', required: true }, resolvedBy: 'string', resolution: 'string',
    });
    json(res, 200, await workspaceRouter.resolveApprovalRequest((route as { approvalId: string }).approvalId, body));
  });
  map.set('audit-events.list', async (_route, _req, res, url) => {
    const typeParam = url.searchParams.get('type') || '';
    const type = typeParam ? typeParam.split(',').map((item) => item.trim()).filter(Boolean) as import('@cc/superai-contracts').AuditEventListQuery['type'] : undefined;
    json(res, 200, await workspaceRouter.listAuditEvents({
      workspaceId: url.searchParams.get('workspace_id') || undefined,
      taskId: url.searchParams.get('task_id') || undefined,
      approvalId: url.searchParams.get('approval_id') || undefined,
      type,
      limit: Number(url.searchParams.get('limit') || '50'),
    }));
  });
}
