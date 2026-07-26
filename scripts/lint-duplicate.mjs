#!/usr/bin/env node
/**
 * Duplicate-code quality metric.
 *
 * `pnpm lint:duplicate` prints the repository's copy/paste rate using jscpd,
 * broken down by language, plus the largest duplicated blocks. It is an
 * informational report: the script ALWAYS exits 0, so it never blocks CI.
 *
 * Detection honors the same source roots as `lint:complexity`/`lint:circular`
 * and skips tests, build output, and config files. Raise `--min-lines` /
 * `--min-tokens` to focus on meaningful clones; lower them to catch more.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();
const JSCPD = join(ROOT, 'node_modules', 'jscpd', 'run-jscpd.js');
const ENTRY_DIRS = ['src', 'services', 'packages', 'electron', 'shared'];

const MIN_LINES = Number(process.env.JSCPD_MIN_LINES || 5);
const MIN_TOKENS = Number(process.env.JSCPD_MIN_TOKENS || 25);

// Mirrors the ignore set in eslint.config.mjs — tests, build output, configs.
const IGNORE = [
  '**/dist/**',
  '**/dist-electron/**',
  '**/release/**',
  '**/coverage/**',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.config.{js,mjs,cjs}',
  '**/test/**',
  '**/tests/**',
  'tests/**',
  'scripts/**',
];

function run() {
  const outDir = mkdtempSync(join(tmpdir(), 'jscpd-'));
  try {
    const args = [
      ...ENTRY_DIRS,
      '--format',
      'typescript,tsx',
      '--min-lines',
      String(MIN_LINES),
      '--min-tokens',
      String(MIN_TOKENS),
      '--reporters',
      'json',
      '--output',
      outDir,
      ...IGNORE.flatMap((pattern) => ['--ignore', pattern]),
    ];
    // We capture and discard stderr/stdout on purpose: the report is the JSON
    // file. A non-zero exit just means "duplicates found", which is expected.
    spawnSync(process.execPath, [JSCPD, ...args], { stdio: 'ignore' });

    let report;
    try {
      report = JSON.parse(readFileSync(join(outDir, 'jscpd-report.json'), 'utf8'));
    } catch {
      console.log('\nDuplicate-code report — could not read jscpd output.\n');
      return;
    }

    printReport(report);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

function printReport(report) {
  const stats = report.statistics || {};
  const total = stats.total || {};
  const formats = stats.formats || {};
  const duplicates = report.duplicates || [];

  console.log(`\nDuplicate-code report — ${ENTRY_DIRS.join(', ')}`);
  console.log(`(min-lines=${MIN_LINES}, min-tokens=${MIN_TOKENS})\n`);

  const pct = (total.percentage ?? 0);
  console.log(`Files scanned:        ${total.sources ?? 0}`);
  console.log(`Lines scanned:        ${total.lines ?? 0}`);
  console.log(`Duplicated lines:     ${total.duplicatedLines ?? 0}`);
  console.log(`Duplicated tokens:    ${total.duplicatedTokens ?? 0}`);
  console.log(`Duplicate rate:       ${pct.toFixed(2)}% (line)`);
  console.log(`Duplicate rate:       ${(total.percentageTokens ?? 0).toFixed(2)}% (token)`);
  console.log(`Clone instances:      ${total.clones ?? 0}`);

  const formatNames = Object.keys(formats).sort((a, b) => (formats[b].lines ?? 0) - (formats[a].lines ?? 0));
  if (formatNames.length > 0) {
    console.log('\nBy format:');
    for (const name of formatNames) {
      const f = formats[name];
      console.log(
        `  ${name.padEnd(12)} ${String(f.lines ?? 0).padStart(7)} lines  ` +
          `${String(f.duplicatedLines ?? 0).padStart(6)} dup  ${(f.percentage ?? 0).toFixed(2)}%`,
      );
    }
  }

  const top = [...duplicates]
    .sort((a, b) => (b.lines ?? 0) - (a.lines ?? 0))
    .slice(0, 10);
  if (top.length > 0) {
    console.log('\nLargest duplicated blocks:');
    top.forEach((dup, i) => {
      const a = dup.firstFile?.name ?? '?';
      const b = dup.secondFile?.name ?? '?';
      const same = a === b ? ' (same file)' : '';
      console.log(
        `  #${String(i + 1).padStart(2)}  ${dup.lines ?? 0} lines  ` +
          `${a}:${dup.firstFile?.start ?? '?'} ↔ ${b}:${dup.secondFile?.start ?? '?'}${same}`,
      );
    });
  }

  console.log('');
}

run();

// Informational only — never block CI, regardless of what jscpd detected.
process.exit(0);

// Keep imports referenced for environments that tree-shake unused ESM.
void fileURLToPath;
