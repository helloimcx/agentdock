#!/usr/bin/env node
/**
 * Dead-code quality metric.
 *
 * `pnpm lint:dead-code` prints the repository's unused exports, unused types,
 * and duplicate exports using knip. It is an informational report: the script
 * ALWAYS exits 0, so it never blocks CI.
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
    return;
  }

  printReport(report);
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
      offenders.push({ file: issue.file, total: fileTotal, breakdown, names: collectNames(issue) });
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

  const top = [...offenders].sort((a, b) => b.total - a.total).slice(0, 15);
  if (top.length > 0) {
    console.log('\nTop offenders:');
    top.forEach((o, i) => {
      const parts = Object.entries(o.breakdown)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ');
      console.log(
        `  #${String(i + 1).padStart(2)}  ${String(o.total).padStart(4)}  ${o.file}`,
      );
      console.log(`        ${parts}`);
      const preview = o.names.slice(0, 6).join(', ');
      const more = o.names.length > 6 ? `, …${o.names.length - 6} more` : '';
      console.log(`        e.g. ${preview}${more}`);
    });
  } else {
    console.log('\nNo dead symbols detected. ✔');
  }

  console.log('');
}

// Collect the first few symbol names across all issue types, for a quick preview.
function collectNames(issue) {
  const names = [];
  for (const [key, value] of Object.entries(issue)) {
    if (!Array.isArray(value) || key === 'files') continue;
    for (const entry of value) {
      if (Array.isArray(entry)) {
        // duplicates are pairs [[a,b], ...]
        for (const e of entry) if (e?.name) names.push(e.name);
      } else if (entry?.name) {
        names.push(entry.name);
      }
    }
  }
  return [...new Set(names)];
}

run();

// Informational only — never block CI, regardless of what knip detected.
process.exit(0);
