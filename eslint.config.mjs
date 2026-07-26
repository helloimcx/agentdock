import tseslint from 'typescript-eslint';

// Cyclomatic-complexity quality metric.
// `pnpm lint:complexity` prints every function whose cyclomatic complexity exceeds
// `max`. The rule is `warn`, so the script exits 0 — it is an informational report,
// not a CI gate. Lower `max` to surface more candidates; raise it to focus on outliers.
export default tseslint.config(
  {
    ignores: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/test/**',
      'tests/**',
      'dist/**',
      'dist-electron/**',
      'release/**',
      'coverage/**',
      '**/*.config.{js,mjs,cjs}',
      'scripts/**',
    ],
  },
  {
    files: [
      'src/**/*.{ts,tsx}',
      'services/**/*.ts',
      'packages/**/*.ts',
      'electron/**/*.ts',
      'shared/**/*.ts',
    ],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    rules: {
      complexity: ['warn', { max: 15 }],
    },
  },
);
