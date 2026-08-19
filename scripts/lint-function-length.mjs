#!/usr/bin/env node
/**
 * Function-length quality metric.
 *
 * `pnpm lint:function-length` prints every function-like construct whose line
 * span meets `FUNC_MIN_LINES` (default 100). It is an informational report by
 * default; pass `--fail` to exit non-zero when the long-function total exceeds
 * `--max-count N` (default 0), which the CI gate uses.
 *
 * Detection walks the TypeScript AST (via the already-installed `typescript`
 * package) and measures the span of each function declaration, function
 * expression, arrow function, method, accessor, and constructor. Lower
 * `FUNC_MIN_LINES` to surface more candidates; raise it to focus on outliers.
 *
 * Detection honors the same source roots as the other lint metrics and skips
 * tests, build output, and config files.
 */
import ts from 'typescript';
import { readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { collectFiles, ENTRY_DIRS } from './lint-metrics-common.mjs';

const ROOT = process.cwd();
const MIN_LINES = Number(process.env.FUNC_MIN_LINES || 100);
const FAIL = process.argv.includes('--fail');
const maxCountArg = process.argv.find((arg, i) => i > 0 && process.argv[i - 1] === '--max-count');
const parsedMaxCount = maxCountArg !== undefined ? Number(maxCountArg) : 0;
// Non-numeric values fail closed (0): a NaN threshold would silently pass every count.
const MAX_COUNT = Number.isFinite(parsedMaxCount) && parsedMaxCount >= 0 ? parsedMaxCount : 0;
const EXTS = new Set(['.ts', '.tsx']);

const FUNCTION_KINDS = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.Constructor,
]);

function getFunctionName(node) {
  if (node.name) {
    return node.name.getText();
  }
  // Arrow / function expression assigned to a variable — show the binding name.
  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent) && parent.name) {
    return parent.name.getText();
  }
  if (ts.isConstructorDeclaration(node)) return '<constructor>';
  if (ts.isGetAccessor(node)) return '<getter>';
  if (ts.isSetAccessor(node)) return '<setter>';
  return '<arrow>';
}

function measureFile(filePath) {
  const sourceText = readFileSync(filePath, 'utf8');
  const ext = extname(filePath);
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ext === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const results = [];

  const visit = (node) => {
    if (FUNCTION_KINDS.has(node.kind)) {
      const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      const lines = endLine - startLine + 1;
      if (lines >= MIN_LINES) {
        results.push({ name: getFunctionName(node), startLine, endLine, lines });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return results;
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

  const offenders = [];
  let functionCount = 0;
  for (const file of files) {
    const measured = measureFile(file);
    functionCount += measured.length;
    if (measured.length > 0) {
      offenders.push({ file: relative(ROOT, file), functions: measured });
    }
  }

  // Largest function first, then by file path for stability.
  const flat = [];
  for (const o of offenders) {
    for (const f of o.functions) {
      flat.push({ ...f, file: o.file });
    }
  }
  flat.sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file));

  console.log(`\nFunction-length report — ${ENTRY_DIRS.join(', ')}`);
  console.log(`(min-lines=${MIN_LINES})\n`);

  console.log(`Files scanned:        ${files.length}`);
  console.log(`Long functions:       ${flat.length}`);
  console.log(`Files affected:       ${offenders.length}`);

  const top = flat.slice(0, 20);
  if (top.length > 0) {
    console.log('\nLongest functions:');
    top.forEach((f, i) => {
      console.log(
        `  #${String(i + 1).padStart(2)}  ${String(f.lines).padStart(4)} lines  ` +
          `${f.file}:${f.startLine}-${f.endLine}  ${f.name}`,
      );
    });
  } else {
    console.log('\nNo long functions detected. ✔');
  }

  console.log('');

  // Informational by default; --fail turns the report into a CI gate with an
  // allowed baseline (`--max-count`), so new long functions fail the gate.
  process.exit(FAIL && flat.length > MAX_COUNT ? 1 : 0);
}

run();
