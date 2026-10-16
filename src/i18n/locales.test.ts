import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const LOCALES = ['en', 'zh', 'zh-TW', 'ja', 'es'] as const;
type LocaleName = (typeof LOCALES)[number];

function loadLocale(name: LocaleName): Record<string, any> {
  return JSON.parse(readFileSync(join(process.cwd(), 'src', 'i18n', 'locales', `${name}.json`), 'utf8'));
}

test('the system section declares the same keys in every locale', () => {
  const locales = Object.fromEntries(LOCALES.map((name) => [name, Object.keys(loadLocale(name).system || {}).sort()]));
  for (const name of LOCALES.slice(1)) {
    assert.deepEqual(locales[name], locales.en, `system keys diverge between en and ${name}`);
  }
});

test('the system and log page copy is translated, not hardcoded English defaults', () => {
  const zh = loadLocale('zh').system;
  for (const key of [
    'configDescription', 'runtime', 'serviceStatus', 'restartRequired', 'noPendingRestart',
    'runtimeConfig', 'storageLocation', 'healthSummary', 'enabledPlugins', 'diagnostics',
    'diagnosticsDescription', 'runDoctor', 'runDoctorHint', 'checkedAt', 'recentErrors',
    'recentErrorsDescription', 'noAggregatedErrors', 'occurrences', 'pluginsReadonly',
    'noPlugins', 'diagnosticsCompleted', 'logsDescription', 'searchLogs', 'auto',
  ]) {
    assert.equal(typeof zh[key], 'string', `zh.system.${key} is missing`);
    assert.ok(zh[key].length > 0, `zh.system.${key} is empty`);
    assert.notEqual(zh[key], loadLocale('en').system[key], `zh.system.${key} still carries the English copy`);
  }
});

test('zh cost labels no longer mix in untranslated English parentheticals', () => {
  const zh = loadLocale('zh').costs;
  for (const key of ['todayCost', 'weekCost', 'monthCost', 'activeBudgets']) {
    assert.doesNotMatch(zh[key], /\((Today|This Week|This Month|Active Budgets)\)/, `zh.costs.${key} still carries an English parenthetical`);
  }
});

test('the internal Ponytail codename never ships in UI copy or locale files', () => {
  const standardsSection = readFileSync(join(process.cwd(), 'src', 'pages', 'Desktop', 'workspace-standards-section.tsx'), 'utf8');
  assert.ok(!standardsSection.includes('Ponytail'), 'workspace-standards-section.tsx still exposes the internal Ponytail codename');
  for (const name of LOCALES) {
    assert.ok(!JSON.stringify(loadLocale(name)).includes('Ponytail'), `${name}.json still exposes the internal Ponytail codename`);
  }
});
