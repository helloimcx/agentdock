import type { RouteHandler } from '../server-helpers.js';
import { json } from '../server-helpers.js';
import type { LocalCoreKernel } from '../../kernel/bootstrap.js';

export function registerCapabilitiesHandlers(
  map: Map<string, RouteHandler>,
  kernel: LocalCoreKernel,
) {
  map.set('capabilities.read', async (_route, _req, res) => {
    json(res, 200, await kernel.getCapabilitySnapshot());
  });
  map.set('capabilities.snapshot', async (_route, _req, res) => {
    json(res, 200, (await kernel.getCapabilitySnapshot()).snapshot);
  });
}
