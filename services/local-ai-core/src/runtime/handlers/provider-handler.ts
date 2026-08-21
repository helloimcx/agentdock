import type { RouteHandler } from '../server-helpers.js';
import { json, readJsonBody } from '../server-helpers.js';
import type { LocalCoreAcpStore } from '../../acp/local-core-acp-store.js';
import type { DesktopModelProviderInput } from '@cc/superai-contracts';
import { validateBody } from '../request-validation.js';

const providerSchema = {
  id: 'string', name: { kind: 'string', required: true }, api_key: 'string', base_url: 'string', model: 'string',
  models: 'array', thinking: 'string', env: 'object',
  unit_price_in: 'number', unit_price_out: 'number', unit_price_cache: 'number',
} as const;

export function registerProviderHandlers(
  map: Map<string, RouteHandler>,
  store: LocalCoreAcpStore,
) {
  map.set('providers.list', async (_route, _req, res) => {
    json(res, 200, { providers: store.listModelProviders() });
  });
  map.set('providers.create', async (_route, req, res) => {
    const body = validateBody<DesktopModelProviderInput>(await readJsonBody(req), providerSchema);
    json(res, 200, await store.upsertModelProvider(body));
  });
  map.set('provider.update', async (route, req, res) => {
    const body = validateBody<DesktopModelProviderInput>(await readJsonBody(req), providerSchema);
    const existing = store.getModelProvider((route as { providerId: string }).providerId);
    if (!existing) {
      throw new Error(`Provider not found: ${(route as { providerId: string }).providerId}`);
    }
    json(res, 200, store.upsertModelProvider({ ...body, id: (route as { providerId: string }).providerId }));
  });
  map.set('provider.delete', async (route, _req, res) => {
    json(res, 200, store.deleteModelProvider((route as { providerId: string }).providerId));
  });
}
