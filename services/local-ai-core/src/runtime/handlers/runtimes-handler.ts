import type { RouteHandler } from '../server-helpers.js';
import type { RuntimeDetectionService } from '../runtime-detection-service.js';
import type { RuntimeDetectionListResponse } from '../../../../../packages/contracts/src/index.js';
import { json } from '../server-helpers.js';

async function runtimeDetectionResponse(runtimeDetection: RuntimeDetectionService): Promise<RuntimeDetectionListResponse> {
  return {
    runtimes: await runtimeDetection.list(),
    checking: runtimeDetection.isChecking(),
  };
}

export function registerRuntimesHandlers(
  map: Map<string, RouteHandler>,
  runtimeDetection: RuntimeDetectionService,
) {
  map.set('runtime.agent-runtimes', async (_route, _req, res) => {
    json(res, 200, await runtimeDetectionResponse(runtimeDetection));
  });
  map.set('runtimes.list', async (_route, _req, res) => {
    json(res, 200, await runtimeDetectionResponse(runtimeDetection));
  });
  map.set('runtimes.detail', async (route, _req, res) => {
    const rId = (route as { runtimeId: string }).runtimeId;
    const runtimes = await runtimeDetection.list();
    const runtime = runtimes.find((entry) => entry.runtimeId === rId || entry.agentType === rId);
    if (!runtime) {
      json(res, 404, null, false, 'Runtime not found');
      return;
    }
    json(res, 200, runtime);
  });
  map.set('runtimes.refresh', async (_route, _req, res) => {
    const runtimes = await runtimeDetection.refresh();
    json(res, 200, { runtimes, checking: runtimeDetection.isChecking() });
  });
  map.set('runtimes.refresh-one', async (route, _req, res) => {
    const rId = (route as { runtimeId: string }).runtimeId;
    const runtimes = await runtimeDetection.refresh(rId);
    json(res, 200, { runtimes, checking: runtimeDetection.isChecking(rId) });
  });
}
