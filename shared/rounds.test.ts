import { describe, expect, it } from 'vitest';
import type { CostMerge, CostRecord, CostSession } from './costs.ts';
import { causeCounts, checksCause, fixCause, qaCause, roundsByCause, roundStats, roundsView } from './rounds.ts';

const DAY = 24 * 60 * 60_000;
const TODAY = new Date(2026, 10, 7).getTime();
const NOW = TODAY + 15 * 60 * 60_000;

const qa = (pr: number, round: number, pass: boolean, cause?: CostSession['cause'], o: Partial<CostSession> = {}): CostSession => ({
  type: 'session',
  at: NOW - 3 * 60 * 60_000,
  ms: 60_000,
  repoId: 'o/a',
  agentId: 'a1',
  agent: 'Ada',
  kind: 'qa',
  issue: pr - 100,
  pr,
  round,
  model: 'm',
  effort: 'medium',
  usd: 1,
  tokens: null,
  outcome: pass ? 'qa-pass' : 'qa-fail',
  ...(cause ? { cause } : {}),
  ...o,
});
const fix = (pr: number, kind: CostSession['kind'], cause: CostSession['cause']): CostSession => ({ ...qa(pr, 0, true, cause), kind, round: null, outcome: 'commit' });
const merge = (pr: number, o: Partial<CostMerge> = {}): CostMerge => ({ type: 'merge', at: NOW - 60 * 60_000, repoId: 'o/a', pr, issues: [pr - 100], ...o });

describe('who sets the cause (#188)', () => {
  it("keeps QA's pick, else the PR's conflict or red checks, else a bug", () => {
    expect(qaCause('nit', { mergeable: 'CONFLICTING' })).toBe('nit');
    expect(qaCause(undefined, { mergeable: 'CONFLICTING' })).toBe('conflict');
    expect(qaCause('nonsense', { mergeState: 'DIRTY' })).toBe('conflict');
    expect(qaCause(undefined, { mergeable: 'MERGEABLE', checks: 'failing' })).toBe('checks');
    expect(qaCause(undefined, null)).toBe('bug');
  });

  it('calls red checks an outage when CI never started', () => {
    expect(checksCause('build: The job was not started because your account is locked due to a billing issue.')).toBe('outage');
    expect(checksCause('test: recent account payments have failed or your spending limit needs to be increased')).toBe('outage');
    expect(checksCause('test: 3 failed, 120 passed')).toBe('checks');
    expect(checksCause(null)).toBe('checks');
  });

  it("gives a fix its PR's reason for going back", () => {
    expect(fixCause({ fixReason: 'conflict', fixInstructions: null })).toBe('conflict');
    expect(fixCause({ fixReason: 'checks', fixInstructions: 'lint: 2 errors' })).toBe('checks');
    expect(fixCause({ fixReason: 'checks', fixInstructions: 'The job was not started' })).toBe('outage');
    expect(fixCause({ fixReason: 'qa', fixInstructions: null, qaCause: 'spec-missing' })).toBe('spec-missing');
    expect(fixCause({ fixReason: 'qa', fixInstructions: null })).toBe('bug');
    expect(fixCause(undefined)).toBeNull();
  });
});

describe('rounds per merge and first-round pass', () => {
  it('leave out rounds failed by an outage or the lab, and count them apart', () => {
    // #1 passed first time; #2 failed on a bug then passed; #3 failed on the lab, then an outage, then passed
    const records: CostRecord[] = [qa(1, 1, true), qa(2, 1, false, 'bug'), qa(2, 2, true), qa(3, 1, false, 'lab-error'), qa(3, 2, false, 'outage'), qa(3, 3, true), merge(1), merge(2), merge(3)];
    const s = roundStats(records, TODAY - 6 * DAY, NOW);
    expect(s).toEqual({ merges: 3, rounds: 4, perMerge: 1.33, firstPass: 0.5, excluded: 2 });
  });

  it('counts only PRs that merged in the window, with QA rounds from any time', () => {
    const records: CostRecord[] = [qa(1, 1, false, 'nit', { at: NOW - 10 * DAY }), qa(1, 2, true), merge(1), qa(2, 1, true), merge(2, { at: NOW - 20 * DAY })];
    expect(roundStats(records, TODAY - 6 * DAY, NOW)).toMatchObject({ merges: 1, rounds: 2, perMerge: 2 });
    expect(roundStats(records, TODAY - 29 * DAY, NOW)).toMatchObject({ merges: 2, rounds: 3, perMerge: 1.5 });
  });
});

describe('failed rounds by cause', () => {
  it('counts failed QA rounds and checks or conflict fixes once each, with their PRs, the most first', () => {
    const records: CostRecord[] = [
      qa(1, 1, false, 'bug'),
      fix(1, 'fix-qa', 'bug'), // its QA round already counts
      qa(1, 2, false, 'bug'),
      qa(2, 1, false, 'bug'),
      fix(2, 'fix-checks', 'outage'),
      fix(3, 'fix-conflict', 'conflict'),
      qa(4, 1, false), // from before causes were recorded
      qa(4, 2, true, 'nit'), // a pass has no failed cause
    ];
    const rows = roundsByCause(records, TODAY - 6 * DAY, NOW);
    expect(rows.map((r) => [r.cause, r.rounds])).toEqual([
      ['bug', 3],
      ['outage', 1],
      ['conflict', 1],
    ]);
    expect(rows[0].prs.map((p) => [p.pr, p.rounds])).toEqual([
      [1, 2],
      [2, 1],
    ]);
    expect(causeCounts(rows)).toEqual({ bug: 3, outage: 1, conflict: 1 });
  });
});

describe('roundsView', () => {
  it('has each floor over 7 and 30 days and a 30-day trend', () => {
    const records: CostRecord[] = [qa(1, 1, true), merge(1), qa(5, 1, false, 'bug', { repoId: 'o/b', at: NOW - 15 * DAY }), qa(5, 2, true, undefined, { repoId: 'o/b', at: NOW - 15 * DAY }), merge(5, { repoId: 'o/b', at: NOW - 15 * DAY })];
    const v = roundsView(records, TODAY, NOW);
    expect(v.floors.map((f) => [f.repoId, f.week.perMerge, f.month.perMerge])).toEqual([
      ['o/a', 1, 1],
      ['o/b', null, 2],
    ]);
    expect(v.month.byCause.map((c) => c.cause)).toEqual(['bug']);
    expect(v.week.byCause).toEqual([]);
    expect(v.trend.perMerge).toHaveLength(30);
    expect(v.trend.perMerge.at(-1)).toBe(1);
    expect(v.trend.perMerge[14]).toBe(2); // the week up to 15 days ago
    expect([v.trend.merges[14], v.trend.merges.at(-1)]).toEqual([1, 1]);
  });
});
