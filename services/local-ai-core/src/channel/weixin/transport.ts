import crypto from 'node:crypto';
import type {
  GetUpdatesResp,
  GetUploadUrlResp,
  SendMessageResp,
  UploadedWeixinFile,
  WeixinWorkspaceBinding,
} from './types.js';

export const API_TIMEOUT_MS = 15_000;
export const WEIXIN_CHANNEL_VERSION = '2.1.7';
export const WEIXIN_ILINK_APP_ID = 'bot';
export const WEIXIN_ILINK_APP_CLIENT_VERSION = '131335';
export const TEXT_ITEM_TYPE = 1;
export const IMAGE_ITEM_TYPE = 2;
export const VOICE_ITEM_TYPE = 3;
export const FILE_ITEM_TYPE = 4;
export const UPLOAD_MEDIA_TYPE_FILE = 3;

export function createWechatUin(): string {
  return Buffer.from(String(crypto.randomInt(0, 0xffffffff))).toString('base64');
}

export function createIlinkHeaders(): Record<string, string> {
  return {
    'iLink-App-Id': WEIXIN_ILINK_APP_ID,
    'iLink-App-ClientVersion': WEIXIN_ILINK_APP_CLIENT_VERSION,
  };
}

export function applyWeixinAuthHeaders(headers: Record<string, string>, binding: WeixinWorkspaceBinding) {
  if (binding.token) {
    headers.AuthorizationType = 'ilink_bot_token';
    headers.Authorization = `Bearer ${binding.token}`;
  }
}

export async function weixinApiPost<T>(
  binding: WeixinWorkspaceBinding,
  endpoint: string,
  bodyObj: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  const url = `${binding.baseUrl.replace(/\/$/, '')}/${endpoint}`;
  const body = JSON.stringify(bodyObj);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(body, 'utf-8')),
      'X-WECHAT-UIN': createWechatUin(),
      ...createIlinkHeaders(),
    };
    applyWeixinAuthHeaders(headers, binding);
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function weixinApiGet<T>(
  binding: WeixinWorkspaceBinding,
  endpoint: string,
  timeoutMs = API_TIMEOUT_MS,
): Promise<T> {
  const url = `${binding.baseUrl.replace(/\/$/, '')}/${endpoint}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = createIlinkHeaders();
    applyWeixinAuthHeaders(headers, binding);
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export function getWeixinUpdates(
  binding: WeixinWorkspaceBinding,
  buf: string,
  signal?: AbortSignal,
): Promise<GetUpdatesResp> {
  return weixinApiPost<GetUpdatesResp>(
    binding,
    'ilink/bot/getupdates',
    { get_updates_buf: buf, base_info: { channel_version: WEIXIN_CHANNEL_VERSION } },
    binding.longPollTimeoutMs,
    signal,
  );
}

export function sendWeixinTextMessageChunk(
  binding: WeixinWorkspaceBinding,
  toUserId: string,
  text: string,
  contextToken?: string,
  options: { clientId?: string; final?: boolean } = {},
): Promise<SendMessageResp> {
  return weixinApiPost<SendMessageResp>(
    binding,
    'ilink/bot/sendmessage',
    {
      msg: {
        from_user_id: '',
        to_user_id: toUserId,
        client_id: options.clientId || `openclaw-weixin-${crypto.randomUUID()}`,
        message_type: 2,
        message_state: options.final === false ? 1 : 2,
        item_list: [{ type: TEXT_ITEM_TYPE, text_item: { text } }],
        ...(contextToken ? { context_token: contextToken } : {}),
      },
      base_info: { channel_version: WEIXIN_CHANNEL_VERSION },
    },
    API_TIMEOUT_MS,
  );
}

export function sendWeixinFileMessage(
  binding: WeixinWorkspaceBinding,
  toUserId: string,
  fileName: string,
  uploaded: UploadedWeixinFile,
  contextToken?: string,
  options: { clientId?: string } = {},
): Promise<SendMessageResp> {
  return weixinApiPost<SendMessageResp>(
    binding,
    'ilink/bot/sendmessage',
    {
      msg: {
        from_user_id: '',
        to_user_id: toUserId,
        client_id: options.clientId || `openclaw-weixin-${crypto.randomUUID()}`,
        message_type: 2,
        message_state: 2,
        item_list: [{
          type: FILE_ITEM_TYPE,
          file_item: {
            media: {
              encrypt_query_param: uploaded.encryptedQueryParam,
              aes_key: Buffer.from(uploaded.aesKeyHex).toString('base64'),
              encrypt_type: 1,
            },
            file_name: fileName,
            len: String(uploaded.fileSize),
          },
        }],
        ...(contextToken ? { context_token: contextToken } : {}),
      },
      base_info: { channel_version: WEIXIN_CHANNEL_VERSION },
    },
    API_TIMEOUT_MS,
  );
}

export function getWeixinUploadUrl(
  binding: WeixinWorkspaceBinding,
  fileKey: string,
  toUserId: string,
  plaintextLength: number,
  rawMd5: string,
  cipherSize: number,
  aesKeyHex: string,
): Promise<GetUploadUrlResp> {
  return weixinApiPost<GetUploadUrlResp>(
    binding,
    'ilink/bot/getuploadurl',
    {
      filekey: fileKey,
      media_type: UPLOAD_MEDIA_TYPE_FILE,
      to_user_id: toUserId,
      rawsize: plaintextLength,
      rawfilemd5: rawMd5,
      filesize: cipherSize,
      no_need_thumb: true,
      aeskey: aesKeyHex,
      base_info: { channel_version: WEIXIN_CHANNEL_VERSION },
    },
    API_TIMEOUT_MS,
  );
}

export async function uploadEncryptedBufferToWeixinCdn(
  binding: WeixinWorkspaceBinding,
  plaintext: Buffer,
  uploadParam: string,
  fileKey: string,
  aesKey: Buffer,
) {
  const cipher = crypto.createCipheriv('aes-128-ecb', aesKey, null);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const url = `${binding.cdnBaseUrl.replace(/\/$/, '')}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(fileKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
    },
    body: new Uint8Array(ciphertext),
  });
  if (!res.ok) {
    throw new Error(`WeChat CDN upload failed: HTTP ${res.status}`);
  }
  const encryptedQueryParam = res.headers.get('x-encrypted-param') || '';
  if (!encryptedQueryParam) {
    throw new Error('WeChat CDN upload response missing x-encrypted-param');
  }
  return encryptedQueryParam;
}

export function isWeixinApiError(resp: { ret?: number; errcode?: number }): boolean {
  return (resp.ret !== undefined && resp.ret !== 0) || (resp.errcode !== undefined && resp.errcode !== 0);
}
