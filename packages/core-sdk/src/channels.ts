import type {
  DesktopBridgeEvent,
  LocalCoreAuthorizedUser,
  LocalCoreChannelAuthorizedUser,
  LocalCoreChannelConnectionResult,
  LocalCoreChannelGatewayStatus,
  LocalCoreChannelPairingRequest,
  LocalCoreChannelQrCode,
  LocalCoreChannelQrCodeStatus,
  LocalCoreLarkConnectionResult,
  LocalCoreLarkGatewayStatus,
  LocalCoreLarkQrCodeStatus,
  LocalCorePairingRequest,
} from '@cc/superai-contracts';
import { subscribeEvents } from './runtime.js';
import { buildQuery, coreRequest } from './request.js';

export function listChannelGateways(platform: string) {
  return coreRequest<{ gateways: LocalCoreChannelGatewayStatus[] }>('GET', `/platforms/${encodeURIComponent(platform)}`);
}

function instanceSuffix(instanceId?: string) {
  return buildQuery({ instance_id: instanceId });
}

export function getChannelGatewayStatus(platform: string, workspaceId: string, instanceId?: string) {
  return coreRequest<LocalCoreChannelGatewayStatus>('GET', `/platforms/${encodeURIComponent(platform)}/${encodeURIComponent(workspaceId)}${instanceSuffix(instanceId)}`);
}

export function testChannelConnection(platform: string, workspaceId: string, instanceId?: string) {
  return coreRequest<LocalCoreChannelConnectionResult>('POST', `/platforms/${encodeURIComponent(platform)}/${encodeURIComponent(workspaceId)}/test${instanceSuffix(instanceId)}`);
}

export function enableChannelGateway(platform: string, workspaceId: string, instanceId?: string) {
  return coreRequest<LocalCoreChannelGatewayStatus>('POST', `/platforms/${encodeURIComponent(platform)}/${encodeURIComponent(workspaceId)}/enable${instanceSuffix(instanceId)}`);
}

export function disableChannelGateway(platform: string, workspaceId: string, instanceId?: string) {
  return coreRequest<LocalCoreChannelGatewayStatus>('POST', `/platforms/${encodeURIComponent(platform)}/${encodeURIComponent(workspaceId)}/disable${instanceSuffix(instanceId)}`);
}

export function listChannelPendingPairings(platform: string, workspaceId?: string) {
  const suffix = buildQuery({ workspace_id: workspaceId });
  return coreRequest<{ pairings: LocalCoreChannelPairingRequest[] }>('GET', `/platforms/${encodeURIComponent(platform)}/pairings${suffix}`);
}

export function approveChannelPairing(platform: string, code: string) {
  return coreRequest<LocalCoreChannelAuthorizedUser>('POST', `/platforms/${encodeURIComponent(platform)}/pairings/approve`, { code });
}

export function rejectChannelPairing(platform: string, code: string) {
  return coreRequest<{ rejected: boolean }>('POST', `/platforms/${encodeURIComponent(platform)}/pairings/reject`, { code });
}

export function listChannelAuthorizedUsers(platform: string, workspaceId?: string) {
  const suffix = buildQuery({ workspace_id: workspaceId });
  return coreRequest<{ users: LocalCoreChannelAuthorizedUser[] }>('GET', `/platforms/${encodeURIComponent(platform)}/users${suffix}`);
}

export function getChannelQrCode(platform: string, workspaceId: string, instanceId?: string) {
  return coreRequest<LocalCoreChannelQrCode>(
    'POST',
    `/platforms/${encodeURIComponent(platform)}/${encodeURIComponent(workspaceId)}/qrcode${instanceSuffix(instanceId)}`,
  );
}

export function checkChannelQrCodeStatus(platform: string, workspaceId: string, ticket: string, instanceId?: string) {
  const suffix = buildQuery({ ticket, instance_id: instanceId });
  return coreRequest<LocalCoreChannelQrCodeStatus>(
    'GET',
    `/platforms/${encodeURIComponent(platform)}/${encodeURIComponent(workspaceId)}/qrcode/status${suffix}`,
  );
}

export function listLarkGateways() {
  return listChannelGateways('lark') as Promise<{ gateways: LocalCoreLarkGatewayStatus[] }>;
}

export function getLarkGatewayStatus(workspaceId: string, instanceId?: string) {
  return getChannelGatewayStatus('lark', workspaceId, instanceId) as Promise<LocalCoreLarkGatewayStatus>;
}

export function testLarkConnection(workspaceId: string, instanceId?: string) {
  return testChannelConnection('lark', workspaceId, instanceId) as Promise<LocalCoreLarkConnectionResult>;
}

export function enableLarkGateway(workspaceId: string, instanceId?: string) {
  return enableChannelGateway('lark', workspaceId, instanceId) as Promise<LocalCoreLarkGatewayStatus>;
}

export function disableLarkGateway(workspaceId: string, instanceId?: string) {
  return disableChannelGateway('lark', workspaceId, instanceId) as Promise<LocalCoreLarkGatewayStatus>;
}

export function listLarkPendingPairings(workspaceId?: string) {
  return listChannelPendingPairings('lark', workspaceId) as Promise<{ pairings: LocalCorePairingRequest[] }>;
}

export function approveLarkPairing(code: string) {
  return approveChannelPairing('lark', code) as Promise<LocalCoreAuthorizedUser>;
}

export function rejectLarkPairing(code: string) {
  return rejectChannelPairing('lark', code);
}

export function listLarkAuthorizedUsers(workspaceId?: string) {
  return listChannelAuthorizedUsers('lark', workspaceId) as Promise<{ users: LocalCoreAuthorizedUser[] }>;
}

export function getLarkQrCode(workspaceId: string, instanceId?: string) {
  return getChannelQrCode('lark', workspaceId, instanceId);
}

export function checkLarkQrCodeStatus(workspaceId: string, ticket: string, instanceId?: string) {
  return checkChannelQrCodeStatus('lark', workspaceId, ticket, instanceId) as Promise<LocalCoreLarkQrCodeStatus>;
}

export function getWeixinQrCode(workspaceId: string, instanceId?: string) {
  return getChannelQrCode('weixin', workspaceId, instanceId);
}

export function checkWeixinQrCodeStatus(workspaceId: string, ticket: string, instanceId?: string) {
  return checkChannelQrCodeStatus('weixin', workspaceId, ticket, instanceId) as Promise<{
    status: 'wait' | 'signed' | 'confirmed' | 'expired';
    userName?: string;
    userId?: string;
  }>;
}

export function onBridgeUpdated(listener: (event: DesktopBridgeEvent) => void) {
  return subscribeEvents((event) => {
    if (event.type === 'stream.updated') {
      listener(event.stream);
    }
    if (
      event.type === 'message.created'
      || event.type === 'message.updated'
      || event.type === 'run.updated'
    ) {
      if ('stream' in event && event.stream) {
        listener(event.stream);
      }
    }
  });
}
