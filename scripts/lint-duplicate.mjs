#!/usr/bin/env node
/**
 * Duplicate-code quality metric.
 *
 * `pnpm lint:duplicate` prints the repository's copy/paste rate using jscpd,
 * broken down by language, plus the largest duplicated blocks. It is an
 * informational report by default; pass `--fail` to exit non-zero when clones
 * are detected (used by the CI gate).
 *
 * Detection honors the same source roots as `lint:complexity`/`lint:circular`
 * and skips tests, build output, and config files. Raise `--min-lines` /
 * `--min-tokens` to focus on meaningful clones; lower them to catch more.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();
const JSCPD = join(ROOT, 'node_modules', 'jscpd', 'run-jscpd.js');
const ENTRY_DIRS = ['src', 'services', 'packages', 'electron', 'shared'];
const FAIL = process.argv.includes('--fail');

const MIN_LINES = Number(process.env.JSCPD_MIN_LINES || 5);
const MIN_TOKENS = Number(process.env.JSCPD_MIN_TOKENS || 25);

// Mirrors the ignore set in eslint.config.mjs — tests, build output, configs.
// The lark/weixin gateway files are deliberately parallel implementations of
// the same inbound protocol, so clones between them are not actionable debt.
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
  '**/channel/lark/local-core-lark-gateway.ts',
  '**/channel/weixin/local-core-weixin-gateway.ts',
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
      return 1;
    }

    const cloneCount = printReport(report);
    // Informational by default; --fail turns the report into a CI gate.
    // Return the exit code instead of calling process.exit() here: process.exit
    // inside a try block would skip the finally cleanup below.
    return FAIL && cloneCount > 0 ? 1 : 0;
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

process.exit(run());

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
  return duplicates.length;
}
