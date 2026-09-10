import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  formatGroundedDataContract,
  composeDeepAnalysisPrompt,
  extractDecisionRecord,
  composeRetrospectivePrompt,
} from '../../services/local-ai-core/src/automation/decision-workflow.js';
import { DecisionLogService } from '../../services/local-ai-core/src/automation/decision-log-service.js';

test('formatGroundedDataContract formats verified snapshot and strict grounding rules', () => {
  const payload = {
    latestPrice: 175.5,
    boll_lower: 170.2,
    boll_upper: 185.0,
    change_percent: -3.2,
    symbol: 'AAPL',
  };
  const contract = formatGroundedDataContract(payload, 'Stock quote AAPL');

  assert.match(contract, /\[GROUNDED DATA CONTRACT/);
  assert.match(contract, /NEVER hallucinate, invent, or assume any price/i);
  assert.match(contract, /latestPrice\*\*:\s*175\.5/);
  assert.match(contract, /boll_lower\*\*:\s*170\.2/);
  assert.match(contract, /symbol\*\*:\s*AAPL/);
});

test('composeDeepAnalysisPrompt includes grounding contract, bull/bear debate, output rubric, and prior lessons', () => {
  const basePrompt = 'Analyze AAPL condition alert.';
  const payload = { symbol: 'AAPL', latestPrice: 175.5 };
  const priorLessons = ['Last time oversold bounce failed due to earnings risk.'];

  const prompt = composeDeepAnalysisPrompt(basePrompt, payload, priorLessons);

  assert.match(prompt, /\[GROUNDED DATA CONTRACT/);
  assert.match(prompt, /\[STRUCTURED WORKFLOW: BULL\/BEAR DEBATE & ADJUDICATION\]/);
  assert.match(prompt, /Phase 1: Bull Case/);
  assert.match(prompt, /Phase 2: Bear Case/);
  assert.match(prompt, /Phase 3: Final Adjudication/);
  assert.match(prompt, /```json/);
  assert.match(prompt, /\[PREVIOUS RETROSPECTIVE LESSONS\]/);
  assert.match(prompt, /Last time oversold bounce failed due to earnings risk/);
  assert.match(prompt, /Analyze AAPL condition alert/);
});

test('extractDecisionRecord extracts structured json from agent reply', () => {
  const replyText = `
Here is my analysis of AAPL:

Phase 1: Bull Case
The stock is at the lower Bollinger band with strong dividend yield support.

Phase 2: Bear Case
Tech sector faces macro headwind and upcoming rate decision.

Phase 3: Final Adjudication
We should hold and observe price action around $175 support.

\`\`\`json
{
  "action": "HOLD",
  "confidence": 75,
  "thesis": "Support at Bollinger lower band holds but macro risks warrant caution.",
  "bullPoints": ["Oversold bounce potential", "Dividend yield support"],
  "bearPoints": ["Macro interest rate pressure", "Lower volume"],
  "keyAssumptions": ["Support at 170 holds"],
  "invalidationTriggers": ["Price drops below 168"]
}
\`\`\`
`;

  const record = extractDecisionRecord({
    replyText,
    monitorId: 'mon_test_123',
    workspaceId: 'ws_default',
    runId: 'run_abc_456',
    threadId: 'th_xyz_789',
    dataSnapshot: { symbol: 'AAPL', latestPrice: 175.5 },
  });

  assert.equal(record.monitorId, 'mon_test_123');
  assert.equal(record.action, 'HOLD');
  assert.equal(record.confidence, 75);
  assert.match(record.thesis, /Support at Bollinger lower band/);
  assert.equal(record.bullPoints.length, 2);
  assert.equal(record.bearPoints.length, 2);
  assert.equal(record.keyAssumptions.length, 1);
  assert.equal(record.invalidationTriggers?.[0], 'Price drops below 168');
  assert.equal(record.retrospectiveStatus, 'pending');
});

test('extractDecisionRecord provides heuristic fallback when reply has no json', () => {
  const replyText = 'Based on the facts, we recommend BUY with 80% confidence. Bull thesis: strong momentum.';

  const record = extractDecisionRecord({
    replyText,
    monitorId: 'mon_test_fallback',
    workspaceId: 'ws_default',
    dataSnapshot: { latestPrice: 100 },
  });

  assert.equal(record.action, 'BUY');
  assert.equal(record.confidence, 80);
  assert.ok(record.thesis.length > 0);
});

test('composeRetrospectivePrompt generates follow-up evaluation prompt', () => {
  const previousDecision = {
    action: 'BUY' as const,
    confidence: 85,
    thesis: 'Oversold rebound expected at 175 support.',
    keyAssumptions: ['Support at 170 holds'],
  };
  const currentSnapshot = { latestPrice: 182.0, change_percent: 3.7 };

  const prompt = composeRetrospectivePrompt({
    monitorTitle: 'AAPL Oversold Alert',
    decision: previousDecision,
    currentSnapshot,
  });

  assert.match(prompt, /\[RETROSPECTIVE EVALUATION: AAPL Oversold Alert\]/);
  assert.match(prompt, /Action:\s*BUY\s*\(Confidence:\s*85%\)/);
  assert.match(prompt, /Oversold rebound expected at 175 support/);
  assert.match(prompt, /Current Realized Market Snapshot/);
  assert.match(prompt, /latestPrice\*\*:\s*182/);
  assert.match(prompt, /"accuracy":\s*"correct" \| "incorrect" \| "neutral"/);
});

test('DecisionLogService records decisions and retrospectives to markdown log', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agentdock-decision-test-'));
  try {
    const service = new DecisionLogService({ rootDir: tempDir });
    const monitorId = 'mon_test_apple';

    const decision = {
      id: 'dec_123',
      monitorId,
      workspaceId: 'ws_test',
      action: 'BUY' as const,
      confidence: 85,
      thesis: 'Strong rebound from lower weekly Bollinger band.',
      bullPoints: ['Weekly lower band touch', 'Low valuation'],
      bearPoints: ['Overall market pullback'],
      keyAssumptions: ['170 support holds'],
      invalidationTriggers: ['Drop below 168'],
      dataSnapshot: { latestPrice: 175.2, boll_lower: 174.5 },
      createdAt: new Date().toISOString(),
      retrospectiveStatus: 'pending' as const,
    };

    // 1. Append initial decision
    await service.appendDecision(decision);

    const logPath = join(tempDir, '.agentdock', 'decisions', `${monitorId}.md`);
    const initialContent = readFileSync(logPath, 'utf8');
    assert.match(initialContent, /# Decision Log: mon_test_apple/);
    assert.match(initialContent, /## Decision `dec_123`/);
    assert.match(initialContent, /- \*\*Action\*\*: BUY \(Confidence: 85%\)/);
    assert.match(initialContent, /170 support holds/);

    // 2. Query decisions
    const decisions = await service.listDecisions(monitorId);
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].id, 'dec_123');
    assert.equal(decisions[0].retrospectiveStatus, 'pending');

    // 3. Update with retrospective
    await service.recordRetrospective(monitorId, 'dec_123', {
      accuracy: 'correct',
      realizedOutcome: 'AAPL rebounded to $182 (+3.9%).',
      reflection: 'Weekly Bollinger lower band was an accurate technical bottom.',
      lessons: ['Weekly Bollinger lower band is highly predictive for AAPL.'],
    });

    const updatedContent = readFileSync(logPath, 'utf8');
    assert.match(updatedContent, /Status: completed \(Accuracy: correct\)/);
    assert.match(updatedContent, /AAPL rebounded to \$182/);
    assert.match(updatedContent, /Weekly Bollinger lower band is highly predictive for AAPL/);

    // 4. Extract prior lessons for future prompt injection
    const lessons = await service.getPriorLessons(monitorId);
    assert.equal(lessons.length, 1);
    assert.equal(lessons[0], 'Weekly Bollinger lower band is highly predictive for AAPL.');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('DecisionLogService lists disk-persisted decisions newest-first including the first logged section', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agentdock-decision-order-test-'));
  try {
    const writer = new DecisionLogService({ rootDir: tempDir });
    const monitorId = 'mon_test_order';
    await writer.appendDecision({
      id: 'dec_first_0001',
      monitorId,
      workspaceId: 'ws_test',
      action: 'BUY',
      confidence: 60,
      thesis: 'First entry at the lower band.',
      bullPoints: [],
      bearPoints: [],
      keyAssumptions: [],
      dataSnapshot: {},
      createdAt: '2026-09-11T08:00:00.000Z',
      retrospectiveStatus: 'pending',
    });
    await writer.appendDecision({
      id: 'dec_second_002',
      monitorId,
      workspaceId: 'ws_test',
      action: 'HOLD',
      confidence: 50,
      thesis: 'Waiting for the retest.',
      bullPoints: [],
      bearPoints: [],
      keyAssumptions: [],
      dataSnapshot: {},
      createdAt: '2026-09-11T09:00:00.000Z',
      retrospectiveStatus: 'pending',
    });

    const reader = new DecisionLogService({ rootDir: tempDir });
    const decisions = await reader.listDecisions(monitorId);
    assert.equal(decisions.length, 2);
    assert.equal(decisions[0].id, 'dec_second_002');
    assert.equal(decisions[1].id, 'dec_first_0001');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('DecisionLogService bounds retained decisions and always keeps pending retrospectives', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agentdock-decision-retention-test-'));
  try {
    const service = new DecisionLogService({ rootDir: tempDir });
    const monitorId = 'mon_test_retention';
    const record = (index: number, status: 'pending' | 'completed') => ({
      id: `dec_retention_${String(index).padStart(4, '0')}`,
      monitorId,
      workspaceId: 'ws_test',
      action: 'WATCH' as const,
      confidence: 50,
      thesis: `Decision ${index}.`,
      bullPoints: [],
      bearPoints: [],
      keyAssumptions: [],
      dataSnapshot: {},
      createdAt: new Date(Date.parse('2026-09-11T00:00:00.000Z') + index * 60_000).toISOString(),
      retrospectiveStatus: status,
      ...(status === 'completed' ? {
        retrospectiveOutcome: {
          accuracy: 'correct' as const,
          realizedOutcome: `Outcome ${index}.`,
          reflection: `Reflection ${index}.`,
          lessons: [],
        },
      } : {}),
    });

    // First record stays pending forever; the rest complete their retrospectives.
    await service.appendDecision(record(0, 'pending'));
    for (let index = 1; index <= 104; index++) {
      const current = record(index, 'completed');
      await service.appendDecision(current);
      await service.recordRetrospective(monitorId, current.id, {
        accuracy: 'correct',
        realizedOutcome: `Outcome ${index}.`,
        reflection: `Reflection ${index}.`,
        lessons: [],
      });
    }

    const reader = new DecisionLogService({ rootDir: tempDir });
    const decisions = await reader.listDecisions(monitorId);
    const completed = decisions.filter((d) => d.retrospectiveStatus === 'completed');
    assert.equal(completed.length, 100, 'completed decisions are capped at 100');
    assert.ok(decisions.some((d) => d.id === 'dec_retention_0000'), 'pending-retrospective decision is always retained');
    assert.ok(!decisions.some((d) => d.id === 'dec_retention_0001'), 'oldest completed decision is evicted');
    assert.ok(decisions.some((d) => d.id === 'dec_retention_0104'), 'newest decision is retained');
    assert.equal(decisions[0].id, 'dec_retention_0104', 'list is newest-first');

    // The in-memory path enforces the same retention policy as disk.
    const inMemory = await service.listDecisions(monitorId);
    assert.equal(inMemory.filter((d) => d.retrospectiveStatus === 'completed').length, 100);
    assert.ok(inMemory.some((d) => d.id === 'dec_retention_0000'));

    // Never-retrospected (pending) decisions are bounded by the total cap too.
    const floodMonitorId = 'mon_test_flood';
    const floodRecord = (index: number) => ({
      id: `dec_flood_${String(index).padStart(4, '0')}`,
      monitorId: floodMonitorId,
      workspaceId: 'ws_test',
      action: 'WATCH' as const,
      confidence: 50,
      thesis: `Flood ${index}.`,
      bullPoints: [],
      bearPoints: [],
      keyAssumptions: [],
      dataSnapshot: {},
      createdAt: new Date(Date.parse('2026-09-11T00:00:00.000Z') + index * 60_000).toISOString(),
      retrospectiveStatus: 'pending' as const,
    });
    for (let index = 0; index < 205; index++) {
      await service.appendDecision(floodRecord(index));
    }
    const floodMemory = await service.listDecisions(floodMonitorId);
    assert.equal(floodMemory.length, 200, 'pending-only logs are capped at the total limit');
    assert.equal(floodMemory[0].id, 'dec_flood_0204');
    const floodDisk = await new DecisionLogService({ rootDir: tempDir }).listDecisions(floodMonitorId);
    assert.equal(floodDisk.length, 200);
    assert.ok(!floodDisk.some((d) => d.id === 'dec_flood_0000'), 'oldest pending decision is evicted');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('DecisionLogService reads do not create the decisions directory', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agentdock-decision-readonly-test-'));
  try {
    const reader = new DecisionLogService({ rootDir: tempDir });
    const decisions = await reader.listDecisions('mon_test_missing');
    assert.equal(decisions.length, 0);
    assert.equal(existsSync(join(tempDir, '.agentdock')), false, 'no .agentdock directory is created by reads');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
