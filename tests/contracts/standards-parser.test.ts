import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStandardPack,
  renderStandardsContent,
  renderPonytailDecisionLadder,
} from '../../services/local-ai-core/src/standards/standards-rule-parser.js';
import { CURATED_STANDARD_PACKS } from '../../services/local-ai-core/src/standards/curated-standards.js';
import type { StandardRule, StandardPackMetadata } from '@cc/superai-contracts/standards';

test('parseStandardPack parses frontmatter, rules, and <important if> conditions', () => {
  const markdown = `---
id: test-go
name: Go Modern Standards
language: golang
version: 1.0.0
description: Modern Go guidelines inspired by JetBrains
tags: [go, modern]
---

### Explicit Error Handling
Always check and return wrapped errors with %w. Never ignore errors.

### Security: Input Sanitization
<important if="touching_auth || handling_untrusted_input">
Validate and sanitize all external inputs at the trust boundary.
Never leak credentials or private keys in logs.
</important>

### High Performance Buffering
<important if="intensity >= ultra">
Use sync.Pool for buffer reuse in critical hot loops.
</important>
`;

  const parsed = parseStandardPack(markdown);
  assert.equal(parsed.id, 'test-go');
  assert.equal(parsed.name, 'Go Modern Standards');
  assert.equal(parsed.language, 'golang');
  assert.equal(parsed.version, '1.0.0');
  assert.equal(parsed.rules?.length, 3);

  const errorRule = parsed.rules?.find((r) => r.title.includes('Error Handling'));
  assert.ok(errorRule);
  assert.equal(errorRule.minIntensity, 'lite');

  const securityRule = parsed.rules?.find((r) => r.title.includes('Security'));
  assert.ok(securityRule);
  assert.equal(securityRule.isSafetyCarveOut, true);
  assert.equal(securityRule.condition, 'touching_auth || handling_untrusted_input');

  const perfRule = parsed.rules?.find((r) => r.title.includes('Performance'));
  assert.ok(perfRule);
  assert.equal(perfRule.minIntensity, 'ultra');
});

test('renderPonytailDecisionLadder renders 5-level hierarchy and safety carve-out note', () => {
  const ladder = renderPonytailDecisionLadder('full');
  assert.ok(ladder.includes('Decision Ladder'));
  assert.ok(ladder.includes('Level 1: System Integrity & Security'));
  assert.ok(ladder.includes('Level 2: Correctness & Architecture Boundaries'));
  assert.ok(ladder.includes('Level 3: Simplicity & Minimal Diff'));
  assert.ok(ladder.includes('Level 4: Measurable Performance'));
  assert.ok(ladder.includes('Level 5: Style & Formatting'));
  assert.ok(ladder.includes('Safety Carve-Out'));
});

test('renderStandardsContent respects intensity levels (off, lite, full, ultra)', () => {
  const pack: StandardPackMetadata = {
    id: 'ts-pack',
    name: 'TypeScript Pack',
    language: 'typescript',
    version: '1.0.0',
    description: 'TS standards',
    rules: [
      {
        id: 'r1',
        title: 'Strict Types',
        content: 'No any; use unknown and type guards.',
        minIntensity: 'lite',
        isSafetyCarveOut: false,
      },
      {
        id: 'r2',
        title: 'Credential Safety',
        content: 'Never hardcode secrets in source code.',
        minIntensity: 'ultra', // ultra min, but it is a safety carve-out!
        isSafetyCarveOut: true,
      },
      {
        id: 'r3',
        title: 'Deep Invariant Checklist',
        content: 'Check every boundary call with exhaustive switch.',
        minIntensity: 'ultra',
        isSafetyCarveOut: false,
      },
    ],
  };

  // 1. off intensity
  const offOutput = renderStandardsContent({
    intensity: 'off',
    packs: [pack],
  });
  assert.equal(offOutput.trim(), '');

  // 2. lite intensity -> contains r1, contains r2 (safety carve-out), excludes r3
  const liteOutput = renderStandardsContent({
    intensity: 'lite',
    packs: [pack],
  });
  assert.ok(liteOutput.includes('Strict Types'));
  assert.ok(liteOutput.includes('Credential Safety'));
  assert.equal(liteOutput.includes('Deep Invariant Checklist'), false);

  // 3. full intensity -> contains r1, r2, excludes r3
  const fullOutput = renderStandardsContent({
    intensity: 'full',
    packs: [pack],
  });
  assert.ok(fullOutput.includes('Strict Types'));
  assert.ok(fullOutput.includes('Credential Safety'));
  assert.equal(fullOutput.includes('Deep Invariant Checklist'), false);

  // 4. ultra intensity -> contains all
  const ultraOutput = renderStandardsContent({
    intensity: 'ultra',
    packs: [pack],
  });
  assert.ok(ultraOutput.includes('Strict Types'));
  assert.ok(ultraOutput.includes('Credential Safety'));
  assert.ok(ultraOutput.includes('Deep Invariant Checklist'));
});

test('renderStandardsContent prunes static conditions and preserves runtime <important if> tags', () => {
  const pack: StandardPackMetadata = {
    id: 'cond-pack',
    name: 'Conditional Pack',
    language: 'typescript',
    version: '1.0.0',
    description: 'Conditional standards',
    rules: [
      {
        id: 'c1',
        title: 'Auth Check',
        condition: 'touching_auth || modifying_permissions',
        content: 'Enforce RBAC server-side.',
        minIntensity: 'lite',
        isSafetyCarveOut: true,
      },
      {
        id: 'c2',
        title: 'Python Only Optimization',
        condition: 'lang:python', // Static language mismatch for TS pack
        content: 'Use slots.',
        minIntensity: 'lite',
        isSafetyCarveOut: false,
      },
    ],
  };

  const output = renderStandardsContent({
    intensity: 'full',
    packs: [pack],
  });

  // Runtime condition preserved with XML tag
  assert.ok(output.includes('<important if="touching_auth || modifying_permissions">'));
  assert.ok(output.includes('Enforce RBAC server-side.'));
  assert.ok(output.includes('</important>'));

  // Static mismatch omitted
  assert.equal(output.includes('Python Only Optimization'), false);
  assert.equal(output.includes('Use slots'), false);
});

test('CURATED_STANDARD_PACKS contains 5 core builtin packs including general and design-system', () => {
  assert.ok(CURATED_STANDARD_PACKS.length >= 5);
  const ids = CURATED_STANDARD_PACKS.map((p) => p.id);
  assert.ok(ids.includes('general'));
  assert.ok(ids.includes('design-system'));
  assert.ok(ids.includes('typescript'));
  assert.ok(ids.includes('golang'));
  assert.ok(ids.includes('python'));

  const designPack = CURATED_STANDARD_PACKS.find((p) => p.id === 'design-system');
  assert.ok(designPack);
  assert.ok(designPack.description.toLowerCase().includes('design'));
});

test('parseStandardPack preserves context text surrounding <important if> tags', () => {
  const markdown = `---
id: context-pack
name: Context Test
language: typescript
version: 1.0.0
description: Tests context preservation
---

### Authentication Rules
Pre-instruction: Always authenticate callers.
<important if="touching_auth">
Enforce bearer token validation on every endpoint.
</important>
Post-instruction: Consult wiki for rotation policies.
`;

  const parsed = parseStandardPack(markdown);
  assert.equal(parsed.rules?.length, 1);
  const rule = parsed.rules![0];
  assert.equal(rule.condition, 'touching_auth');
  assert.ok(rule.content.includes('Pre-instruction: Always authenticate callers.'));
  assert.ok(rule.content.includes('Enforce bearer token validation on every endpoint.'));
  assert.ok(rule.content.includes('Post-instruction: Consult wiki for rotation policies.'));
});
