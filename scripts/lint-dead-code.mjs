#!/usr/bin/env node
/**
 * Dead-code quality metric.
 *
 * `pnpm lint:dead-code` prints the repository's unused exports, unused types,
 * and duplicate exports using knip. It is an informational report by default;
 * pass `--fail` to exit non-zero when the dead-symbol total exceeds
 * `--max-count N` (default 0), which the CI gate uses.
 *
 * Detection honors the same source roots knip discovers from the workspace
 * manifests. Accuracy improves once a knip config declares the project's entry
 * points (e.g. electron/main.ts, services/local-ai-core) — without it, knip may
 * under-report symbols that entries consume. Raise `--include` to widen the
 * surface; add a `knip.json` to tune entry points and ignore patterns.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();
const KNIP = join(ROOT, 'node_modules', 'knip', 'bin', 'knip.js');

const FAIL = process.argv.includes('--fail');
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');
const maxCountArg = process.argv.find((arg, i) => i > 0 && process.argv[i - 1] === '--max-count');
const parsedMaxCount = maxCountArg !== undefined ? Number(maxCountArg) : 0;
// Non-numeric values fail closed (0): a NaN threshold would silently pass every count.
const MAX_COUNT = Number.isFinite(parsedMaxCount) && parsedMaxCount >= 0 ? parsedMaxCount : 0;

// `--exports` is the dead-code surface: exports, nsExports, types, nsTypes,
// enumMembers, namespaceMembers, duplicates.
const ARGS = ['--reporter', 'json', '--exports'];

function run() {
  const res = spawnSync(process.execPath, [KNIP, ...ARGS], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] });

  let report;
  try {
    report = JSON.parse(res.stdout.toString());
  } catch {
    console.log('\nDead-code report — could not parse knip output (exit ' + (res.status ?? '?') + ').\n');
    process.exit(1);
  }

  const totalSymbols = printReport(report);
  // Informational by default; --fail turns the report into a CI gate with an
  // allowed baseline (`--max-count`), so new dead symbols fail the gate.
  process.exit(FAIL && totalSymbols > MAX_COUNT ? 1 : 0);
}

function getGitChangedFiles() {
  const changed = new Set();
  const runGit = (args, parser = (l) => l.trim()) => {
    try {
      const res = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      if (res.status === 0 && res.stdout) {
        for (const line of res.stdout.split('\n')) {
          const parsed = parser(line);
          if (parsed) changed.add(parsed);
        }
        return true;
      }
    } catch {
      // Git unavailable or repository missing
    }
    return false;
  };

  // 1. Uncommitted working tree & staged files (handle renames and non-ASCII paths)
  runGit(['diff', '--name-only', 'HEAD']);
  runGit(['diff', '--cached', '--name-only']);
  runGit(['-c', 'core.quotepath=false', 'status', '--porcelain', '-uall'], (line) => {
    if (line.length <= 3) return '';
    let p = line.slice(3).trim();
    if (p.includes(' -> ')) p = p.split(' -> ').pop().trim();
    if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
    return p;
  });

  // 2. PR / Branch comparison against target branch: prefer remote tracking branch, fallback to local
  const baseRef = process.env.GITHUB_BASE_REF || 'main';
  const hasRemoteDiff = runGit(['diff', '--name-only', `origin/${baseRef}...HEAD`]);
  if (!hasRemoteDiff) {
    runGit(['diff', '--name-only', `${baseRef}...HEAD`]);
  }

  // 3. In CI on push event (where HEAD is the pushed commit, compare with previous commit)
  if (process.env.GITHUB_EVENT_NAME === 'push') {
    const beforeSha = process.env.GITHUB_BEFORE_SHA;
    if (beforeSha && beforeSha !== '0000000000000000000000000000000000000000') {
      runGit(['diff', '--name-only', beforeSha, 'HEAD']);
    } else {
      runGit(['diff', '--name-only', 'HEAD~1', 'HEAD']);
    }
  }

  return changed;
}

function printReport(report) {
  const issues = report.issues || [];

  // Aggregate per-type counts and per-file offenders.
  const typeCounts = {};
  const offenders = [];
  for (const issue of issues) {
    let fileTotal = 0;
    const breakdown = {};
    for (const [key, value] of Object.entries(issue)) {
      if (!Array.isArray(value) || key === 'files') continue;
      if (value.length === 0) continue;
      typeCounts[key] = (typeCounts[key] || 0) + value.length;
      breakdown[key] = value.length;
      fileTotal += value.length;
    }
    if (fileTotal > 0) {
      offenders.push({
        file: issue.file,
        total: fileTotal,
        breakdown,
        names: collectNames(issue),
        items: collectDetailedItems(issue),
      });
    }
  }

  const totalSymbols = Object.values(typeCounts).reduce((a, b) => a + b, 0);

  console.log(`\nDead-code report — knip --exports`);
  console.log(`(run from: ${ROOT})\n`);

  console.log(`Files analyzed:       ${issues.length}`);
  console.log(`Files with issues:    ${offenders.length}`);
  console.log(`Dead symbols total:   ${totalSymbols}`);

  const typeOrder = ['exports', 'nsExports', 'types', 'nsTypes', 'duplicates', 'enumMembers', 'namespaceMembers'];
  const presentTypes = typeOrder.filter((t) => typeCounts[t]);
  if (presentTypes.length > 0) {
    console.log('\nBy type:');
    for (const t of presentTypes) {
      console.log(`  ${t.padEnd(18)} ${String(typeCounts[t]).padStart(6)}`);
    }
  }

  const isFailing = FAIL && totalSymbols > MAX_COUNT;
  let changedOffenders = [];

  if (isFailing) {
    const changedFiles = getGitChangedFiles();
    changedOffenders = offenders.filter((o) => changedFiles.has(o.file));

    console.log('\n' + '='.repeat(70));
    console.log(`❌ GATE FAILURE: Dead symbols total (${totalSymbols}) exceeds threshold (${MAX_COUNT}) by ${totalSymbols - MAX_COUNT}`);
    console.log('='.repeat(70));

    if (changedOffenders.length > 0) {
      console.log('\n🚨 Dead symbols detected in changed files (immediate fix recommended):');
      for (const o of changedOffenders) {
        console.log(`\n  📁 ${o.file} (${o.total} dead symbol${o.total > 1 ? 's' : ''}):`);
        for (const item of o.items) {
          const loc = item.line ? `:${item.line}` : '';
          console.log(`     - [${item.type}] ${item.name} (${o.file}${loc})`);
        }
      }
    } else {
      console.log('\nℹ️  No dead symbols detected in current git changed files.');
    }
  }

  const showAll = VERBOSE || (isFailing && changedOffenders.length === 0);
  const displayList = showAll ? [...offenders].sort((a, b) => b.total - a.total) : [...offenders].sort((a, b) => b.total - a.total).slice(0, 15);

  if (displayList.length > 0) {
    console.log(showAll ? `\nAll offenders (${displayList.length} files):` : '\nTop offenders:');
    displayList.forEach((o, i) => {
      const parts = Object.entries(o.breakdown)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ');
      console.log(
        `  #${String(i + 1).padStart(2)}  ${String(o.total).padStart(4)}  ${o.file}`,
      );
      console.log(`        ${parts}`);
      if (VERBOSE) {
        for (const item of o.items) {
          const loc = item.line ? `:${item.line}` : '';
          console.log(`        - [${item.type}] ${item.name}${loc}`);
        }
      } else {
        const preview = o.names.slice(0, 6).join(', ');
        const more = o.names.length > 6 ? `, …${o.names.length - 6} more` : '';
        console.log(`        e.g. ${preview}${more}`);
      }
    });
  } else {
    console.log('\nNo dead symbols detected. ✔');
  }

  console.log('');
  return totalSymbols;
}

function collectDetailedItems(issue) {
  const items = [];
  const seen = new Set();
  const addItem = (type, entry) => {
    if (!entry?.name) return;
    const key = `${type}:${entry.name}:${entry.line || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ type, name: entry.name, line: entry.line, col: entry.col });
  };

  for (const [key, value] of Object.entries(issue)) {
    if (!Array.isArray(value) || key === 'files') continue;
    for (const entry of value) {
      if (Array.isArray(entry)) {
        for (const e of entry) addItem(key, e);
      } else {
        addItem(key, entry);
      }
    }
  }
  return items;
}

function collectNames(issue) {
  const names = [];
  for (const [key, value] of Object.entries(issue)) {
    if (!Array.isArray(value) || key === 'files') continue;
    for (const entry of value) {
      if (Array.isArray(entry)) {
        for (const e of entry) if (e?.name) names.push(e.name);
      } else if (entry?.name) {
        names.push(entry.name);
      }
    }
  }
  return [...new Set(names)];
}

run();
