import type { MonitorPlugin, MonitorRuntimeRegistration } from '../../../../../packages/plugin-sdk/src/index.js';
import { MockStockQuoteProvider } from '../../automation/mock-stock-provider.js';

export function createBuiltinStockMonitorPlugin(): MonitorPlugin {
  return {
    manifest: {
      id: 'builtin.monitor-stock',
      kind: 'monitor',
      version: '0.1.0',
      provides: ['monitor.source.stock.quote'],
    },
    capabilities: {
      monitors: [
        {
          id: 'monitor.source.stock.quote',
          sourceTypes: ['stock.quote'],
          modes: ['poll'],
          enabled: true,
          displayName: 'Stock Quote Monitor',
        },
      ],
    },
    createRuntime(): MonitorRuntimeRegistration {
      return {
        providers: [new MockStockQuoteProvider()],
      };
    },
  };
}

