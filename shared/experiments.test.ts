import { describe, expect, it } from 'vitest';
import {
  addSession,
  assignIssue,
  diffCi,
  emptyOutcome,
  fmtMetric,
  experimentResult,
  issueSize,
  makeExperiment,
  meanCi,
  pickVariant,
  preferCli,
  sessionPractice,
  starterExperiments,
  survivalOf,
  survived,
  tCrit,
  type Assignment,
  type Experiment,
} from './experiments.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 5);

const exp = (over: Partial<Experiment> = {}): Experiment => ({
  ...makeExperiment(
    { name: 'Test first', hypothesis: 'fewer rounds', variants: [{ name: 'Current' }, { name: 'Test first', settings: { prompt: 'Write the failing test first.', effort: { issue: 'high' } } }] },
    { id: 'x1', by: 'manager', now: NOW, seed: 7, floorOk: () => true },
  ),
  status: 'running',
  ...over,
});

const issue = (number: number, body = 'short') => ({ number, body, labels: [] as string[] });

describe('assignment', () => {
  it('is deterministic and balanced within each block of a stratum', () => {
    const e = exp({ variants: [...exp().variants, { id: 'c', name: 'C', settings: {} }] });
    const run = () => Array.from({ length: 12 }, (_, i) => pickVariant(e, 'r:S', i));
    expect(run()).toEqual(run());
    const picks = run();
    for (let b = 0; b < 4; b++) expect(picks.slice(b * 3, b * 3 + 3).sort()).toEqual(['a', 'b', 'c']);
    // another stratum (or seed) draws its own order
    const other = Array.from({ length: 12 }, (_, i) => pickVariant({ ...e, seed: 8 }, 'r:S', i));
    expect(other).not.toEqual(picks);
  });

  it('stratifies by floor and size, and stays balanced as issues come in', () => {
    const e = exp();
    const list: Assignment[] = [];
    for (let n = 1; n <= 40; n++) {
      const a = assignIssue([e], list, n % 2 ? 'o/one' : 'o/two', issue(n, n % 4 < 2 ? 'x' : 'y'.repeat(2000)), NOW)!;
      list.push(a);
    }
    for (const stratum of new Set(list.map((a) => a.stratum))) {
      const of = list.filter((a) => a.stratum === stratum);
      const b = of.filter((a) => a.variantId === 'b').length;
      expect(Math.abs(of.length - 2 * b)).toBeLessThanOrEqual(1);
    }
    expect(new Set(list.map((a) => a.stratum)).size).toBe(4);
  });

  it('leaves issues alone outside a running experiment and its floors', () => {
    expect(assignIssue([exp({ status: 'draft' })], [], 'o/one', issue(1), NOW)).toBeNull();
    expect(assignIssue([exp({ status: 'stopped' })], [], 'o/one', issue(1), NOW)).toBeNull();
    expect(assignIssue([exp({ floors: ['o/two'] })], [], 'o/one', issue(1), NOW)).toBeNull();
    expect(assignIssue([exp({ floors: ['o/two'] })], [], 'o/two', issue(1), NOW)?.experimentId).toBe('x1');
  });

  it('sizes issues from a size label, else from their body', () => {
    expect(issueSize({ body: 'tiny', labels: [] })).toBe('S');
    expect(issueSize({ body: 'x'.repeat(1500), labels: [] })).toBe('M');
    expect(issueSize({ body: `${'- a step\n'.repeat(20)}${'x'.repeat(3000)}`, labels: [] })).toBe('L');
    expect(issueSize({ body: 'tiny', labels: ['size:L'] })).toBe('L');
  });
});

describe('what a variant changes in a session', () => {
  const b = { experimentId: 'x1', variantId: 'b' };
  it('applies the variant to the kinds it covers, and tags every session of the issue', () => {
    const e = exp({ kinds: ['issue'] });
    expect(sessionPractice([e], b, 'o/one', 'issue')).toMatchObject({ tag: 'x1/b', prompt: 'Write the failing test first.', effort: 'high' });
    expect(sessionPractice([e], b, 'o/one', 'qa')).toMatchObject({ tag: 'x1/b', prompt: '', effort: null });
    expect(sessionPractice([e], { experimentId: 'x1', variantId: 'a' }, 'o/one', 'issue')).toMatchObject({ tag: 'x1/a', prompt: '', effort: null });
    expect(sessionPractice([e], b, 'o/one', 'ceo-chat').prompt).toBe('');
  });

  it('changes nothing once stopped, unless the manager promoted a variant', () => {
    const stopped = exp({ status: 'stopped', stoppedAt: NOW });
    expect(sessionPractice([stopped], b, 'o/one', 'issue')).toEqual({ tag: null, prompt: '', effort: null, model: null, toolsOff: [], qaCli: null });
    const promoted = { ...stopped, promoted: 'b', floors: ['o/one'] };
    expect(sessionPractice([promoted], null, 'o/one', 'issue')).toMatchObject({ tag: null, prompt: 'Write the failing test first.', effort: 'high' });
    expect(sessionPractice([promoted], null, 'o/two', 'issue').prompt).toBe('');
  });

  it("prefers QA agents on the variant's coding agent, never the author", () => {
    const free = [
      { id: 'ada', cli: 'claude' as const },
      { id: 'cod', cli: 'codex' as const },
      { id: 'dev', cli: 'codex' as const },
    ];
    expect(preferCli(free, 'codex', 'dev', (a) => a.cli).map((a) => a.id)).toEqual(['cod']);
    expect(preferCli(free, 'opencode', null, (a) => a.cli)).toBe(free);
    expect(preferCli(free, null, null, (a) => a.cli)).toBe(free);
  });
});

describe('outcomes and survival', () => {
  it("adds sessions: cost, QA rounds, the first round's verdict and red-check fixes", () => {
    let o = addSession(emptyOutcome(), { kind: 'issue', usd: 1.5, round: null, outcome: 'pr' });
    o = addSession(o, { kind: 'qa', usd: 0.5, round: 1, outcome: 'qa-fail' });
    o = addSession(o, { kind: 'fix-checks', usd: 0.25, round: null, outcome: 'commit' });
    o = addSession(o, { kind: 'qa', usd: 0.5, round: 2, outcome: 'qa-pass' });
    expect(o).toMatchObject({ usd: 2.75, sessions: 4, qaRounds: 2, firstPass: false, checkFixes: 1 });
  });

  const merged = { pr: 40, issue: 12, mergedAt: NOW - 20 * DAY };
  const none = { commits: [], issues: [] };
  it('finds a revert commit naming the PR', () => {
    const s = survivalOf(merged, { ...none, commits: [{ at: NOW - 19 * DAY, message: 'Add the lab (#40)' }, { at: NOW - 10 * DAY, message: 'Revert "Add the lab (#40)" (#55)' }] });
    expect(s).toEqual({ revertedAt: NOW - 10 * DAY, followup: null });
  });

  it('finds a later fix that references the PR or its issue, but not the merge itself', () => {
    const own = survivalOf(merged, { ...none, commits: [{ at: NOW - 19 * DAY, message: 'Add the lab (#40)\n\nFixes #12' }] });
    expect(own.followup).toBeNull();
    const fix = survivalOf(merged, { ...none, commits: [{ at: NOW - 5 * DAY, message: 'Fixes #12 again: the chip was missing (#61)' }] });
    expect(fix.followup?.at).toBe(NOW - 5 * DAY);
    expect(survivalOf(merged, { ...none, commits: [{ at: NOW - 5 * DAY, message: 'Fixes #120 (#61)' }] }).followup).toBeNull();
  });

  it('finds a bug issue that references it, after the merge', () => {
    const bug = { number: 70, at: NOW - 3 * DAY, title: 'Chip is broken', body: 'Since #40 the chip overlaps.', labels: [] };
    expect(survivalOf(merged, { ...none, issues: [bug] }).followup).toEqual({ issue: 70, at: NOW - 3 * DAY });
    expect(survivalOf(merged, { ...none, issues: [{ ...bug, title: 'More chips', body: 'Like #40, for floors.' }] }).followup).toBeNull();
    expect(survivalOf(merged, { ...none, issues: [{ ...bug, at: NOW - 25 * DAY }] }).followup).toBeNull();
  });

  it('survives a window only once it has passed without a revert or follow-up', () => {
    const at = NOW - 20 * DAY;
    expect(survived({ mergedAt: at, revertedAt: null, followup: null }, 14, NOW)).toBe(1);
    expect(survived({ mergedAt: at, revertedAt: null, followup: null }, 30, NOW)).toBeNull();
    expect(survived({ mergedAt: at, revertedAt: at + 10 * DAY, followup: null }, 14, NOW)).toBe(0);
    expect(survived({ mergedAt: at, revertedAt: null, followup: { issue: 1, at: at + 16 * DAY } }, 14, NOW)).toBe(1);
    expect(survived({ mergedAt: at, revertedAt: null, followup: { issue: 1, at: at + 16 * DAY } }, 30, NOW)).toBe(0);
    expect(survived({ mergedAt: null, revertedAt: null, followup: null }, 14, NOW)).toBeNull();
  });
});

describe('statistics', () => {
  it("uses Student's t for the mean's interval", () => {
    expect(tCrit(1)).toBe(12.706);
    expect(tCrit(9.7)).toBe(2.262);
    expect(tCrit(1000)).toBeCloseTo(1.962, 2);
    const m = meanCi([1, 2, 3, 4, 5]);
    expect(m.mean).toBe(3);
    expect(m.hi! - m.mean!).toBeCloseTo(2.776 * Math.sqrt(2.5 / 5), 6);
    expect(meanCi([4])).toEqual({ n: 1, mean: 4, lo: null, hi: null });
    expect(meanCi([])).toEqual({ n: 0, mean: null, lo: null, hi: null });
  });

  it("gives the difference with Welch's interval", () => {
    const d = diffCi([2, 2, 3, 3], [1, 1, 2, 2])!;
    expect(d.diff).toBe(-1);
    expect(d.hi).toBeLessThan(0);
    expect(diffCi([1], [1, 2])).toBeNull();
  });

  const results = (n: number, rounds: (v: string, i: number) => number) => {
    const e = exp({ minSample: 10 });
    const list: Assignment[] = [];
    for (let i = 0; i < 2 * n; i++) {
      const v = i % 2 ? 'b' : 'a';
      list.push({ experimentId: 'x1', variantId: v, repoId: 'o/one', issue: i, pr: 100 + i, at: NOW - 40 * DAY, stratum: 's', outcome: { ...emptyOutcome(), mergedAt: NOW - 35 * DAY, qaRounds: rounds(v, i), firstPass: rounds(v, i) === 1, usd: 2, diff: 100 } });
    }
    return experimentResult(e, list, NOW);
  };

  it('never declares a winner before the minimum sample', () => {
    const r = results(9, (v) => (v === 'b' ? 1 : 3));
    expect(r.winner).toBeNull();
    expect(r.verdicts.every((v) => v.better === null && !v.enough)).toBe(true);
    expect(r.summary).toBe('not enough data on anything yet');
    expect(r.variants[1].metrics.qaRounds).toMatchObject({ n: 9, mean: 1 });
  });

  it('says which variant is better, by how much and how sure, once there is enough', () => {
    const r = results(12, (v, i) => (v === 'b' ? 1 + (i % 3 === 0 ? 1 : 0) : 2 + (i % 4 === 0 ? 1 : 0)));
    const rounds = r.verdicts.find((v) => v.metric === 'qaRounds')!;
    expect(rounds.better).toBe(true);
    expect(rounds.text).toMatch(/^B is better on QA rounds \(−\d\.\d, 95% CI −\d\.\d…−\d\.\d\)$/);
    expect(r.summary).toContain('B is better on QA rounds');
    expect(r.winner).toBe('b');
  });
});

describe('formatting', () => {
  it('shows shares as percent, differences as points, and no minus zero', () => {
    expect(fmtMetric(0.456, 'pct')).toBe('46%');
    expect(fmtMetric(-0.2, 'pct', true)).toBe('−20 pts');
    expect(fmtMetric(-0.01, 'n', true)).toBe('0');
    expect(fmtMetric(1.234, 'usd', true)).toBe('+$1.23');
  });
});

describe('definitions', () => {
  it('checks what the form or the CEO gives', () => {
    const make = (raw: unknown) => makeExperiment(raw, { id: 'x', by: 'ceo', now: NOW, seed: 1, floorOk: (id) => id === 'o/one' });
    expect(() => make({ name: 'n', hypothesis: 'h', variants: [{ name: 'A' }] })).toThrow(/2 to 4 variants/);
    expect(() => make({ name: 'n', hypothesis: 'h', floors: ['o/two'], variants: [{}, {}] })).toThrow(/not a floor/);
    expect(() => make({ name: 'n', hypothesis: 'h', kinds: ['ceo-chat'], variants: [{}, {}] })).toThrow(/Unknown task kind/);
    expect(() => make({ name: 'n', hypothesis: 'h', variants: [{}, { settings: { effort: { issue: 'huge' } } }] })).toThrow(/not a valid effort/);
    const e = make({ name: ' n ', hypothesis: 'h', variants: [{}, { name: 'B', settings: { prompt: ' p ', qaCli: 'codex', junk: 1 } }] });
    expect(e).toMatchObject({ name: 'n', status: 'draft', minSample: 10, by: 'ceo' });
    expect(e.variants).toEqual([
      { id: 'a', name: 'Variant A', settings: {} },
      { id: 'b', name: 'B', settings: { prompt: 'p', qaCli: 'codex' } },
    ]);
  });

  it('has the five starter experiments as drafts', () => {
    const s = starterExperiments(NOW);
    expect(s.map((e) => e.id)).toEqual(['test-first', 'plan-in-pr', 'self-review', 'cross-model-qa', 'fix-effort']);
    expect(s.every((e) => e.status === 'draft' && e.variants.length === 2)).toBe(true);
    expect(s.find((e) => e.id === 'cross-model-qa')!.variants[1].settings.qaCli).toBe('codex');
  });
});
