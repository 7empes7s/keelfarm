import { describe, expect, it } from 'vitest';
import {
  changedParts,
  charterMarkdown,
  charterOf,
  charterText,
  CHARTER_PROMPT_MAX,
  cleanCharter,
  driftView,
  DRIFT_MS,
  emptyLog,
  loadRecord,
  LOG_MS,
  noteCheck,
  noteObjectives,
  objectiveRefusal,
  objectiveTag,
  renderCharter,
  withChange,
} from './charter.ts';
import type { Charter } from './charter.ts';

const charter = (o: Partial<Charter> = {}): Charter =>
  cleanCharter({
    mission: 'A cheerful todo app',
    focus: 'O2: plan the week',
    objectives: [
      { id: 'O1', outcome: 'Capture in one tap', measure: 'under 2 seconds' },
      { id: 'O2', outcome: 'Plan the week', measure: 'due dates ship' },
    ],
    standards: ['Keyboard only works everywhere', 'Nothing overflows at 375px'],
    nonGoals: ['Accounts or sync'],
    ...o,
  });

describe('the charter in prompts', () => {
  it('renders every part compactly, and nothing for an empty charter', () => {
    expect(renderCharter(charter())).toBe(
      [
        'Project charter (keep every change inside it):',
        'Mission: A cheerful todo app',
        'Current focus: O2: plan the week',
        'Standards (must always hold; breaking one fails QA):',
        '- Keyboard only works everywhere',
        '- Nothing overflows at 375px',
        'Objectives:',
        '- O1: Capture in one tap (met when: under 2 seconds)',
        '- O2: Plan the week (met when: due dates ship)',
        'Non-goals (out of scope): Accounts or sync',
      ].join('\n'),
    );
    expect(renderCharter(cleanCharter({}))).toBe('');
  });

  it('stays under the cap however big the charter, cutting at a line, and is byte-identical between calls', () => {
    const big = charter({
      mission: 'm'.repeat(4000),
      standards: Array.from({ length: 12 }, (_, i) => `${i} ${'s'.repeat(190)}`),
      objectives: Array.from({ length: 8 }, () => ({ id: '', outcome: 'o'.repeat(160), measure: 'x'.repeat(160) })),
      nonGoals: Array.from({ length: 8 }, () => 'n'.repeat(120)),
    });
    expect(charterText(big).length).toBeGreaterThan(CHARTER_PROMPT_MAX);
    const a = renderCharter(big);
    expect(a.length).toBeLessThanOrEqual(CHARTER_PROMPT_MAX);
    expect(a).toMatch(/\n… \(cut: the full charter is in the office\)$/);
    expect(a.startsWith('Project charter (keep every change inside it):\nMission: mmm')).toBe(true);
    expect(a).toContain('Standards (must always hold'); // standards come before objectives and non-goals
    expect(renderCharter(structuredClone(big))).toBe(a);
  });
});

describe('cleaning a charter', () => {
  it('caps parts, drops empty lines and bullets, and gives objectives free ids', () => {
    const c = cleanCharter({
      mission: '  Build it  ',
      standards: '- one\n\n* two\n',
      nonGoals: ['', 'three'],
      objectives: [{ id: 'O2', outcome: 'b' }, { id: 'o2', outcome: 'dupe' }, { outcome: 'c' }, { outcome: '' }],
      focus: 'x'.repeat(500),
    });
    expect(c.mission).toBe('Build it');
    expect(c.standards).toEqual(['one', 'two']);
    expect(c.nonGoals).toEqual(['three']);
    expect(c.objectives.map((o) => o.id)).toEqual(['O2', 'O1', 'O3']);
    expect(c.focus).toHaveLength(200);
  });
});

describe('migrating floors from before charters', () => {
  it("keeps the old brief as the mission, word for word, with the rest empty", () => {
    const brief = `Build a cozy island bakery game.\n\nThe player bakes, sells and decorates.  ${'More detail. '.repeat(250)}`.slice(0, 4000);
    const rec = loadRecord(undefined); // a floor saved before #48 has no charter
    expect(charterOf(brief, rec)).toEqual({ mission: brief, objectives: [], standards: [], nonGoals: [], focus: '' });
    expect(rec).toMatchObject({ proposal: null, history: [], log: { tags: {}, merged: [], checks: [] }, status: {} });
    expect(charterMarkdown(charterOf(brief, rec), 'acme/bakery')).toContain(brief.trim());
  });

  it('drops statuses and checks it cannot read', () => {
    const rec = loadRecord({ status: { O1: 'met', O2: 'meh', x: 'met' }, log: { checks: [{ at: 1, pr: 2, kind: 'odd', rule: '' }, { at: 1, pr: 3, kind: 'ok', rule: '' }] } });
    expect(rec.status).toEqual({ O1: 'met' });
    expect(rec.log.checks).toEqual([{ at: 1, pr: 3, kind: 'ok', rule: '' }]);
  });

  it('reloads a saved record as it was', () => {
    const rec = { ...charter(), proposal: { at: 5, by: 'Mimoun', reason: 'Tighter', charter: charter({ focus: 'O1' }) }, history: [{ at: 4, by: 'Sam', parts: ['focus'], note: 'edited' }], log: { tags: { '3': 'O1' }, merged: [{ pr: 9, title: 't', at: 1, objective: 'O1' }], checks: [{ at: 2, pr: 9, kind: 'standard' as const, rule: 'Nothing overflows at 375px' }] }, status: { O1: 'at-risk' as const } };
    const { mission: _, ...saved } = rec;
    expect(loadRecord(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });
});

describe('history', () => {
  it('records who changed which parts, and nothing when nothing changed', () => {
    const before = charter();
    const after = charter({ focus: 'O1', standards: ['Only this'] });
    expect(changedParts(before, after)).toEqual(['focus', 'standards']);
    expect(withChange([], before, after, 'Sam', 'edited', 7)).toEqual([{ at: 7, by: 'Sam', parts: ['focus', 'standards'], note: 'edited' }]);
    expect(withChange([], before, charter(), 'Sam', 'edited', 7)).toEqual([]);
  });
});

describe('objective tags', () => {
  it('reads "Objective: O2" on a line of its own', () => {
    expect(objectiveTag('Build it.\n\nObjective: O2\n')).toBe('O2');
    expect(objectiveTag('**Objective:** o3')).toBe('O3');
    expect(objectiveTag('Serves the objective: O2 maybe')).toBeNull();
  });

  it("refuses an issue without a known objective, only on a floor whose charter has objectives", () => {
    expect(objectiveRefusal('No tag', charter())).toMatch(/Objective: <id>.*O1, O2.*ask the manager/);
    expect(objectiveRefusal('Objective: O7', charter())).toMatch(/no objective O7/);
    expect(objectiveRefusal('Objective: O1', charter())).toBeNull();
    expect(objectiveRefusal('No tag', charter({ objectives: [] }))).toBeNull();
  });
});

describe('the drift view', () => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  const merged = (number: number, closes: number[], daysAgo: number) => ({ number, title: `PR ${number}`, state: 'MERGED' as const, mergedAt: new Date(now - daysAgo * 86_400_000).toISOString(), closesIssues: closes });

  it("groups the last 7 days' merges by the objective their issue named, then the ones without", () => {
    const log = emptyLog();
    expect(noteObjectives(log, [{ number: 1, body: 'Objective: O1' }, { number: 2, body: 'Objective: O9' }, { number: 3, body: 'no tag' }], [], now)).toBe(true);
    // The issues close when their PRs merge: the log still knows their objectives.
    noteObjectives(log, [], [merged(10, [1], 1), merged(11, [2], 2), merged(12, [3], 3), merged(13, [], 4), merged(14, [1], 9), { ...merged(15, [1], 0), state: 'OPEN' as const }], now);
    expect(noteObjectives(log, [], [merged(10, [1], 1)], now)).toBe(false); // seen already
    expect(driftView(log, charter(), now)).toEqual([
      { objective: 'O1', outcome: 'Capture in one tap', prs: [{ number: 10, title: 'PR 10' }] },
      { objective: 'O2', outcome: 'Plan the week', prs: [] },
      { objective: 'O9', outcome: 'no longer in the charter', prs: [{ number: 11, title: 'PR 11' }] },
      { objective: null, outcome: 'No objective', prs: [{ number: 12, title: 'PR 12' }, { number: 13, title: 'PR 13' }] },
    ]);
    expect(driftView(log, charter(), now + DRIFT_MS).flatMap((g) => g.prs)).toEqual([]);
  });
});

describe('the objective log', () => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  const day = 86_400_000;

  it('keeps 30 days of merges for the insights, while the drift view still shows 7', () => {
    const log = emptyLog();
    const merged = (number: number, daysAgo: number) => ({ number, title: `PR ${number}`, state: 'MERGED' as const, mergedAt: new Date(now - daysAgo * day).toISOString(), closesIssues: [] });
    noteObjectives(log, [], [merged(1, 2), merged(2, 20), merged(3, 31)], now);
    expect(log.merged.map((m) => m.pr)).toEqual([1, 2]);
    expect(driftView(log, charter(), now).flatMap((g) => g.prs.map((p) => p.number))).toEqual([1]);
  });

  it("keeps QA's charter checks newest first for 30 days", () => {
    const log = emptyLog();
    noteCheck(log, { at: now - 40 * day, pr: 1, kind: 'ok', rule: '' }, now - 40 * day);
    noteCheck(log, { at: now - day, pr: 2, kind: 'standard', rule: 'x' }, now);
    noteCheck(log, { at: now, pr: 3, kind: 'ok', rule: '' }, now);
    expect(log.checks.map((c) => c.pr)).toEqual([3, 2]);
    expect(now - LOG_MS).toBeLessThan(now - 29 * day);
  });
});
