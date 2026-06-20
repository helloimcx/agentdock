import type { RouteHandler } from '../server-helpers.js';
import { json, readJsonBody } from '../server-helpers.js';
import type { LocalCoreAcpStore } from '../../acp/local-core-acp-store.js';

export function registerProviderHandlers(
  map: Map<string, RouteHandler>,
  store: LocalCoreAcpStore,
) {
  map.set('providers.list', async (_route, _req, res) => {
    json(res, 200, { providers: store.listModelProviders() });
  });
  map.set('providers.create', async (_route, req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await store.upsertModelProvider(body as unknown as import('@cc/superai-contracts').DesktopModelProviderInput));
  });
  map.set('provider.update', async (route, req, res) => {
    const body = await readJsonBody(req);
    const existing = store.getModelProvider((route as { providerId: string }).providerId);
    if (!existing) {
      throw new Error(`Provider not found: ${(route as { providerId: string }).providerId}`);
    }
    json(res, 200, store.upsertModelProvider({ ...(body as unknown as import('@cc/superai-contracts').DesktopModelProviderInput), id: (route as { providerId: string }).providerId }));
  });
  map.set('provider.delete', async (route, _req, res) => {
    json(res, 200, store.deleteModelProvider((route as { providerId: string }).providerId));
  });
}
