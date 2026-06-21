import type { RouteHandler } from '../server-helpers.js';
import { json, readJsonBody, jsonError } from '../server-helpers.js';
import type { ChannelService } from '../channel-service.js';
import type { ChannelFileSendInput, ChannelOutboundMessageInput } from '@cc/superai-contracts';
import { validateBody } from '../request-validation.js';

export function registerChannelHandlers(
  map: Map<string, RouteHandler>,
  channelService: ChannelService,
) {
  const cid = (url: URL) =>
    String(url.searchParams.get('instance_id') || url.searchParams.get('instanceId') || '').trim() || undefined;

  map.set('platform.gateways.list', async (route, _req, res) => {
    json(res, 200, { gateways: await channelService.listStatuses((route as { platform: string }).platform) });
  });
  map.set('platform.pairings.list', async (route, _req, res, url) => {
    const workspaceId = String(url.searchParams.get('workspace_id') || '');
    json(res, 200, { pairings: await channelService.listPendingPairings((route as { platform: string }).platform, workspaceId || undefined) });
  });
  map.set('platform.users.list', async (route, _req, res, url) => {
    const workspaceId = String(url.searchParams.get('workspace_id') || '');
    json(res, 200, { users: await channelService.listAuthorizedUsers((route as { platform: string }).platform, workspaceId || undefined) });
  });
  map.set('platform.gateway.get', async (route, _req, res, url) => {
    const p = (route as { platform: string }).platform;
    json(res, 200, await channelService.getStatus(p, (route as { workspaceId: string }).workspaceId, cid(url)));
  });
  map.set('platform.qrcode.status', async (route, _req, res, url) => {
    const ticket = String(url.searchParams.get('ticket') || '');
    if (!ticket) {
      jsonError(res, 400, new Error('Missing ticket parameter'));
      return;
    }
    const p = (route as { platform: string }).platform;
    json(res, 200, await channelService.checkQrCodeStatus(p, (route as { workspaceId: string }).workspaceId, ticket, cid(url)));
  });
  map.set('platform.pairing.approve', async (route, req, res) => {
    const body = validateBody<{ code: string }>(await readJsonBody(req), { code: { kind: 'string', required: true } });
    json(res, 200, await channelService.approvePairing((route as { platform: string }).platform, body.code));
  });
  map.set('platform.pairing.reject', async (route, req, res) => {
    const body = validateBody<{ code: string }>(await readJsonBody(req), { code: { kind: 'string', required: true } });
    json(res, 200, await channelService.rejectPairing((route as { platform: string }).platform, body.code));
  });
  map.set('platform.gateway.test', async (route, _req, res, url) => {
    const p = (route as { platform: string }).platform;
    json(res, 200, await channelService.testConnection(p, (route as { workspaceId: string }).workspaceId, cid(url)));
  });
  map.set('platform.gateway.enable', async (route, _req, res, url) => {
    const p = (route as { platform: string }).platform;
    json(res, 200, await channelService.enable(p, (route as { workspaceId: string }).workspaceId, cid(url)));
  });
  map.set('platform.gateway.disable', async (route, _req, res, url) => {
    const p = (route as { platform: string }).platform;
    json(res, 200, await channelService.disable(p, (route as { workspaceId: string }).workspaceId, cid(url)));
  });
  map.set('platform.file.send', async (route, req, res) => {
    const body = validateBody<ChannelFileSendInput>(await readJsonBody(req), {
      path: { kind: 'string', required: true }, channelId: { kind: 'string', required: true }, participantId: 'string',
      fileName: 'string', workspacePath: 'string',
    });
    const p = (route as { platform: string }).platform;
    json(res, 200, await channelService.sendFile(p, (route as { workspaceId: string }).workspaceId, body));
  });
  map.set('platform.message.send', async (route, req, res) => {
    const body = validateBody<ChannelOutboundMessageInput>(await readJsonBody(req), {
      route: { kind: 'object', required: true }, parts: { kind: 'array', required: true }, metadata: 'object',
    });
    const p = (route as { platform: string }).platform;
    json(res, 200, await channelService.sendMessage(p, (route as { workspaceId: string }).workspaceId, body));
  });
  map.set('platform.qrcode.create', async (route, _req, res, url) => {
    const p = (route as { platform: string }).platform;
    json(res, 200, await channelService.getQrCode(p, (route as { workspaceId: string }).workspaceId, cid(url)));
  });
}
