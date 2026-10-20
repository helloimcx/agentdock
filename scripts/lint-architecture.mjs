import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const ARCH_DIR = path.resolve('docs/architecture');
const archifyCandidates = [
  process.env.ARCHIFY_BIN,
  path.resolve('.agents/skills/archify/bin/archify.mjs'),
  path.join(os.homedir(), '.agents/skills/archify/bin/archify.mjs'),
].filter(Boolean);
const ARCHIFY_BIN = archifyCandidates.find((candidate) => fs.existsSync(candidate));

if (!fs.existsSync(ARCH_DIR)) {
  console.log('No docs/architecture directory found. Skipping architecture lint.');
  process.exit(0);
}

const entries = fs.readdirSync(ARCH_DIR, { withFileTypes: true });
const jsonFiles = entries
  .filter((e) => e.isFile() && e.name.endsWith('.json'))
  .map((e) => path.join(ARCH_DIR, e.name));

if (jsonFiles.length === 0) {
  console.log('No architecture JSON specifications found.');
  process.exit(0);
}

if (!ARCHIFY_BIN) {
  console.warn(`⚠️ Archify CLI not found; provider validation skipped for ${jsonFiles.length} architecture JSON file(s). Set ARCHIFY_BIN or install the archify skill to enable Showcase checks.`);
}

let passedCount = 0;
let failedCount = 0;
let skippedCount = 0;

if (ARCHIFY_BIN) {
  console.log(`🔍 Validating ${jsonFiles.length} architecture specifications with Archify (showcase profile)...`);
}

for (const filePath of jsonFiles) {
  const relPath = path.relative(process.cwd(), filePath);
  let diagramType = null;

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    diagramType = parsed.diagram_type;
  } catch (err) {
    console.error(`❌ [${relPath}] Failed to parse JSON: ${err.message}`);
    failedCount++;
    continue;
  }

  if (!diagramType) {
    console.warn(`⚠️  [${relPath}] Skipping (no diagram_type specified)`);
    continue;
  }

  if (!ARCHIFY_BIN) {
    skippedCount++;
    continue;
  }

  const result = spawnSync('node', [ARCHIFY_BIN, 'validate', diagramType, filePath, '--quality', 'showcase', '--json'], {
    encoding: 'utf8',
  });

  let outputJson = null;
  try {
    outputJson = JSON.parse(result.stdout);
  } catch {
    // If not JSON, use raw output
  }

  if (result.status === 0 && outputJson?.ok) {
    console.log(`✅ [${relPath}] (${diagramType}): Passed 9 showcase checks`);
    passedCount++;
  } else {
    console.error(`❌ [${relPath}] (${diagramType}): Validation failed`);
    if (outputJson?.error) {
      console.error(`   ${outputJson.error.split('\n').join('\n   ')}`);
    } else if (result.stderr) {
      console.error(`   ${result.stderr.trim()}`);
    } else if (result.stdout) {
      console.error(`   ${result.stdout.trim()}`);
    }
    failedCount++;
  }
}

console.log(`\nArchitecture Lint Summary: ${passedCount} passed, ${failedCount} failed, ${skippedCount} provider checks skipped.`);
if (failedCount > 0) {
  process.exit(1);
}
