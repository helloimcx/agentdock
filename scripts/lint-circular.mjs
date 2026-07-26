#!/usr/bin/env node
/**
 * Circular-dependency quality metric.
 *
 * `pnpm lint:circular` prints every strongly-connected component (SCC) of the
 * import graph that has more than one file — i.e. a cycle — collapsed so one
 * tangled cluster shows up once instead of as N overlapping paths. It is an
 * informational report: the script ALWAYS exits 0, so it never blocks CI.
 *
 * Resolution honors the `@cc/*` and `@/*` aliases from the root tsconfig.
 */
import madge from 'madge';
import { readFileSync } from 'node:fs';

const ROOT = process.cwd();
const TS_CONFIG = `${ROOT}/tsconfig.json`;
const ENTRY_DIRS = ['src', 'services', 'packages', 'electron', 'shared'];

const tsconf = JSON.parse(readFileSync(TS_CONFIG, 'utf8'));
const paths = tsconf.compilerOptions?.paths || {};

const res = await madge(ENTRY_DIRS, {
  tsConfig: TS_CONFIG,
  fileExtensions: ['ts', 'tsx'],
  detectiveOptions: { ts: { paths } },
});

// madge's `obj()` already gives a DIRECTED graph: file -> [its imports].
// Run Tarjan on that directed graph so an SCC of size > 1 is a genuine
// directed cycle (a file that reaches itself by following imports), not just
// "reachable if you ignore edge direction" — the latter would collapse the
// whole repo into one giant component, which is trivially true and useless.
const graph = res.obj();
const adj = new Map();
for (const [file, deps] of Object.entries(graph)) {
  if (!adj.has(file)) adj.set(file, new Set());
  for (const dep of deps) {
    adj.get(file).add(dep);
  }
}

// Tarjan's SCC (recursive — 301 nodes is far below Node's stack limit).
function tarjan(adjacency) {
  let index = 0;
  const stack = [];
  const onStack = new Set();
  const indices = new Map();
  const lowlinks = new Map();
  const sccs = [];

  const strongconnect = (v) => {
    indices.set(v, index);
    lowlinks.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of adjacency.get(v) || []) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v), lowlinks.get(w)));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v), indices.get(w)));
      }
    }
    if (lowlinks.get(v) === indices.get(v)) {
      const scc = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      sccs.push(scc);
    }
  };

  for (const v of adjacency.keys()) {
    if (!indices.has(v)) strongconnect(v);
  }
  return sccs;
}

const sccs = tarjan(adj)
  .filter((scc) => scc.length > 1)
  .sort((a, b) => b.length - a.length);

const strip = (f) => f.replace(`${ROOT}/`, '');

console.log(`\nCircularity report — ${ENTRY_DIRS.join(', ')}\n`);
console.log(`Files in graph: ${Object.keys(graph).length}`);
console.log(`Cyclic clusters (SCC size > 1): ${sccs.length}\n`);

if (sccs.length === 0) {
  console.log('No circular dependencies. ✔\n');
} else {
  sccs.forEach((scc, i) => {
    console.log(`#${i + 1}  (${scc.length} files)`);
    scc.sort().forEach((f) => console.log(`    ${strip(f)}`));
    console.log('');
  });
}

// Informational only — never block CI.
process.exit(0);
