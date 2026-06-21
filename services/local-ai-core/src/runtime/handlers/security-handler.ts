import type { RouteHandler } from '../server-helpers.js';
import { json, readJsonBody } from '../server-helpers.js';
import type { WorkspaceRouter } from '../../router/workspace-router.js';

export function registerSecurityHandlers(
  map: Map<string, RouteHandler>,
  workspaceRouter: WorkspaceRouter,
) {
  map.set('workspace-security.get', async (route, _req, res) => {
    json(res, 200, await workspaceRouter.getWorkspaceSecuritySettings((route as { workspaceId: string }).workspaceId));
  });
  map.set('workspace-security.update', async (route, req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await workspaceRouter.updateWorkspaceSecuritySettings((route as { workspaceId: string }).workspaceId, body as unknown as import('@cc/superai-contracts').WorkspaceSecuritySettingsUpdateInput));
  });
  map.set('security.command-risk.classify', async (_route, req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await workspaceRouter.classifyCommand(String(body.command || ''), String(body.workspaceId || '') || undefined));
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
    const body = await readJsonBody(req);
    json(res, 200, await workspaceRouter.createApprovalRequest(body as unknown as import('@cc/superai-contracts').ApprovalRequestCreateInput));
  });
  map.set('approval.get', async (route, _req, res) => {
    json(res, 200, await workspaceRouter.getApprovalRequest((route as { approvalId: string }).approvalId));
  });
  map.set('approval.resolve', async (route, req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await workspaceRouter.resolveApprovalRequest((route as { approvalId: string }).approvalId, body as unknown as import('@cc/superai-contracts').ApprovalRequestResolveInput));
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
