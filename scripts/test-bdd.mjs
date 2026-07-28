import process from 'node:process';

// Override Node engine check for Node 25 non-LTS releases where Cucumber version check throws
if (process.version.startsWith('v25.')) {
  Object.defineProperty(process, 'version', { value: 'v24.0.0', writable: true, configurable: true });
}

const runModule = await import('../node_modules/@cucumber/cucumber/lib/cli/run.js');
const run = runModule.default?.default || runModule.default;
await run();
