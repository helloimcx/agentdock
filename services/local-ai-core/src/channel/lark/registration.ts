import type { LarkWorkspaceBinding } from './types.js';

export const DEFAULT_LARK_QR_EXPIRES_IN = 180;
export const LARK_APP_REGISTRATION_SETUP_PATH = '/page/openclaw';

const LARK_APP_REGISTRATION_PATH = '/oauth/v1/app/registration';

export function getLarkAccountsBase(binding: LarkWorkspaceBinding) {
  return binding.brand === 'lark' ? 'https://accounts.larksuite.com' : 'https://accounts.feishu.cn';
}

export function getLarkOpenBase(binding: LarkWorkspaceBinding) {
  return binding.brand === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn';
}

export async function requestAppRegistration(binding: LarkWorkspaceBinding): Promise<Record<string, unknown>> {
  return callAppRegistration(binding, {
    action: 'begin',
    archetype: 'PersonalAgent',
    auth_method: 'client_secret',
    request_user_info: 'open_id tenant_brand',
  });
}

export async function pollAppRegistration(binding: LarkWorkspaceBinding, deviceCode: string): Promise<Record<string, unknown>> {
  return callAppRegistration(binding, {
    action: 'poll',
    device_code: deviceCode,
  });
}

async function callAppRegistration(binding: LarkWorkspaceBinding, formValues: Record<string, string>): Promise<Record<string, unknown>> {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(formValues)) {
    form.set(key, value);
  }
  const response = await fetch(`${getLarkAccountsBase(binding)}${LARK_APP_REGISTRATION_PATH}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) as Record<string, unknown> : {};
  if (!response.ok) {
    throw new Error(`Lark app registration failed (${response.status}): ${String(parsed.error_description || parsed.error || text || response.statusText)}`);
  }
  return parsed;
}
