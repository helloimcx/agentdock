// Cucumber configuration for the BDD layer.
// Runs against TypeScript source via tsx (ESM), independent of the dist-electron build.
// tsx is registered up-front via `node --import tsx` in the test:bdd script, so the ESM
// loader is in place before this support code is imported. `tests/bdd` is excluded from
// tsconfig.electron.json because BDD is source-run, never consumed from dist-electron.
export default {
  paths: ['tests/bdd/features/**/*.feature'],
  import: ['tests/bdd/support/**/*.ts', 'tests/bdd/step-definitions/**/*.ts'],
  format: ['progress'],
};
