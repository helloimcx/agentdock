#!/usr/bin/env node
/**
 * File-size quality metric.
 *
 * `pnpm lint:file-size` prints every source file whose line count meets
 * `FILE_MIN_LINES` (default 1000). It is an informational report: the script
 * ALWAYS exits 0, so it never blocks CI.
 *
 * Detection honors the same source roots as the other lint metrics and skips
 * tests, build output, and config files. Lower `FILE_MIN_LINES` to surface
 * more candidates; raise it to focus on outliers. The project's soft cap is
 * 1000 lines (see CLAUDE.md: "when a file exceeds 1000 lines, consider splitting it").
 */
import { readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { collectFiles, ENTRY_DIRS } from './lint-metrics-common.mjs';

const ROOT = process.cwd();
const MIN_LINES = Number(process.env.FILE_MIN_LINES || 1000);
const EXTS = new Set(['.ts', '.tsx']);

function countLines(filePath) {
  // Counting newlines and adding 1 for the final line (which may not end in a
  // newline) matches what `wc -l` reports for trailing-newline files and what
  // editors show. A trailing newline does NOT start a new line, so we only add
  // the +1 when the file's last byte is not itself a newline.
  const buf = readFileSync(filePath);
  if (buf.length === 0) return 0;
  let newlines = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) newlines++;
  }
  return newlines + (buf[buf.length - 1] === 0x0a ? 0 : 1);
}

function run() {
  const files = [];
  for (const dir of ENTRY_DIRS) {
    const full = join(ROOT, dir);
    try {
      if (statSync(full).isDirectory()) files.push(...collectFiles(full, EXTS));
    } catch {
      // directory absent in this checkout — skip
    }
  }

  let totalLines = 0;
  const large = [];
  for (const file of files) {
    const lines = countLines(file);
    totalLines += lines;
    if (lines >= MIN_LINES) {
      large.push({ file: relative(ROOT, file), lines });
    }
  }
  large.sort((a, b) => b.lines - a.lines);

  const avg = files.length ? Math.round(totalLines / files.length) : 0;

  console.log(`\nFile-size report — ${ENTRY_DIRS.join(', ')}`);
  console.log(`(min-lines=${MIN_LINES})\n`);

  console.log(`Files scanned:        ${files.length}`);
  console.log(`Total lines:          ${totalLines}`);
  console.log(`Average file size:    ${avg} lines`);
  console.log(`Over-sized files:     ${large.length}`);

  if (large.length > 0) {
    console.log('\nLargest files:');
    large.forEach((f, i) => {
      console.log(`  #${String(i + 1).padStart(2)}  ${String(f.lines).padStart(5)} lines  ${f.file}`);
    });
  } else {
    console.log('\nNo over-sized files detected. ✔');
  }

  console.log('');
}

run();

// Informational only — never block CI.
process.exit(0);
