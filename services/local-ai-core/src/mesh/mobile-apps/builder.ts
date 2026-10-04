import { MOBILE_APPS_REGISTRY } from './definitions.js';
import type { MobileAppAction, MobileAppDefinition } from './types.js';

export function listMobileApps(): MobileAppDefinition[] {
  return Object.values(MOBILE_APPS_REGISTRY);
}

export function getMobileApp(appId: string): MobileAppDefinition | undefined {
  const normalized = String(appId || '').trim().toLowerCase();
  return MOBILE_APPS_REGISTRY[normalized];
}

function escapeShellSingleQuote(value: string): string {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function resolveInterpolatedUri(template: string, params: Record<string, string>, action: MobileAppAction): string {
  let uri = template;
  for (const paramDef of action.parameters || []) {
    const rawValue = params[paramDef.name] ?? paramDef.defaultValue;
    if (paramDef.required && (rawValue === undefined || rawValue === '')) {
      throw new Error(`Missing required parameter: ${paramDef.name}`);
    }
    const val = rawValue ?? '';
    const shouldEncode = !['url'].includes(paramDef.name);
    const replacement = shouldEncode ? encodeURIComponent(String(val)) : String(val);
    uri = uri.replaceAll(`\${${paramDef.name}}`, replacement);
  }
  return uri;
}

export function buildAmStartCommand(
  appId: string,
  actionId?: string,
  params: Record<string, string> = {},
): string {
  const app = getMobileApp(appId);
  if (!app) {
    throw new Error(`Unknown mobile app: ${appId}`);
  }

  const effectiveActionId = actionId || app.defaultActionId || 'open';
  const action = app.actions[effectiveActionId];
  if (!action) {
    throw new Error(`Unknown action "${effectiveActionId}" for app "${app.displayName}" (${app.id})`);
  }

  const parts = ['am start'];
  const intent = action.intent;

  if (intent.action) {
    parts.push(`-a ${intent.action}`);
  }

  if (intent.uriTemplate) {
    const interpolated = resolveInterpolatedUri(intent.uriTemplate, params, action);
    parts.push(`-d ${escapeShellSingleQuote(interpolated)}`);
  }

  if (intent.component) {
    parts.push(`-n ${intent.component}`);
  }

  if (intent.category) {
    parts.push(`-c ${intent.category}`);
  }

  return parts.join(' ');
}

export function buildDirectIntentCommand(uri: string): string {
  const sanitized = String(uri || '').trim();
  if (!sanitized) {
    throw new Error('URI cannot be empty');
  }
  if (/[\s'"`;|<>]/.test(sanitized)) {
    throw new Error(`Invalid characters in intent URI: ${sanitized}`);
  }
  return `am start -a android.intent.action.VIEW -d ${escapeShellSingleQuote(sanitized)}`;
}
