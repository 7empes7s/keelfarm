import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { effortHint, resolveEffort, sessionOutcome, wasteReason, type CostMerge, type CostRecord, type CostSession } from '../shared/costs.ts';
import { CostLedger, costsRequest, costsView, floorSpend, parseLedger, pruneLedger, SessionCosts, taskEfforts, taskKindOf } from './costLedger.ts';
import { sampleCosts } from './costSample.ts';
import { DAY_MS, HOUR_MS, startOfDay } from './metrics.ts';
import { seeded } from './journalSample.ts';

const NOW = new Date(2026, 10, 4, 15, 0).getTime();
const TODAY = startOfDay(NOW);

const session = (o: Partial<CostSession> = {}): CostSession => ({
  type: 'session',
  at: TODAY + HOUR_MS,
  ms: 600_000,
  repoId: 'acme/shop',
  agentId: 'a1',
  agent: 'Ada',
  kind: 'issue',
  issue: 7,
  pr: 42,
  round: null,
  model: 'claude-opus-5-5',
  effort: 'medium',
  usd: 2,
  tokens: null,
  outcome: 'pr',
  ...o,
});
const merge = (o: Partial<CostMerge> = {}): CostMerge => ({ type: 'merge', at: TODAY + 2 * HOUR_MS, repoId: 'acme/shop', pr: 42, issues: [7], ...o });

describe('wasteReason', () => {
  it('lists sessions without a PR or commit, watchdog and limit stops', () => {
    expect(wasteReason(session({ outcome: 'no-pr' }))).toBe('ended without a PR');
    expect(wasteReason(session({ kind: 'fix-qa', outcome: 'no-commit' }))).toBe('ended without a commit');
    expect(wasteReason(session({ outcome: 'watchdog' }))).toBe('stopped by the watchdog');
    expect(wasteReason(session({ outcome: 'limited' }))).toMatch(/usage limit/);
  });

  it('counts QA rounds beyond the 2nd, not the first two', () => {
    expect(wasteReason(session({ kind: 'qa', round: 1, outcome: 'qa-fail' }))).toBeNull();
    expect(wasteReason(session({ kind: 'qa', round: 2, outcome: 'qa-fail' }))).toBeNull();
    expect(wasteReason(session({ kind: 'qa', round: 3, outcome: 'qa-pass' }))).toBe('QA round 3');
  });

  it('counts CEO reviews that changed nothing, not other idle CEO jobs', () => {
    expect(wasteReason(session({ kind: 'ceo-review', outcome: 'ceo-idle' }))).toBe('a review that changed nothing');
    expect(wasteReason(session({ kind: 'ceo-review', outcome: 'ceo-acted' }))).toBeNull();
    expect(wasteReason(session({ kind: 'ceo-chat', outcome: 'ceo-idle' }))).toBeNull();
  });

  it('leaves useful work alone', () => {
    expect(wasteReason(session())).toBeNull();
    expect(wasteReason(session({ kind: 'fix-checks', outcome: 'commit' }))).toBeNull();
  });
});

describe('sessionOutcome', () => {
  const base = { interrupted: false, watchdog: false, stopped: false, limited: false, ok: true, hint: null };
  it('says how it ended before what the handler made of it', () => {
    expect(sessionOutcome({ ...base, interrupted: true, stopped: true, hint: 'pr' })).toBe('interrupted');
    expect(sessionOutcome({ ...base, watchdog: true, stopped: true })).toBe('watchdog');
    expect(sessionOutcome({ ...base, stopped: true, hint: 'pr' })).toBe('stopped');
    expect(sessionOutcome({ ...base, hint: 'no-pr' })).toBe('no-pr');
  });
  it('tells a usage-limit cut-off from other errors', () => {
    expect(sessionOutcome({ ...base, ok: false, limited: true })).toBe('limited');
    expect(sessionOutcome({ ...base, ok: false })).toBe('error');
    expect(sessionOutcome(base)).toBe('done');
  });
});

describe('resolveEffort', () => {
  it("prefers the agent's own effort, then the task kind's default, then the office's", () => {
    expect(resolveEffort('high', 'qa', { qa: 'low' }, 'medium')).toBe('high');
    expect(resolveEffort('', 'qa', { qa: 'low' }, 'medium')).toBe('low');
    expect(resolveEffort('', 'fix-checks', { qa: 'low' }, 'medium')).toBe('medium');
  });
  it('changes nothing with no defaults per kind', () => {
    expect(resolveEffort('', 'issue', {}, 'medium')).toBe('medium');
    expect(resolveEffort('', 'ceo-chat', {}, 'xhigh')).toBe('xhigh');
  });
});

describe('costsView', () => {
  it('divides a floor’s cost by its merges, split by task kind', () => {
    const records: CostRecord[] = [
      session({ usd: 3 }),
      session({ kind: 'qa', usd: 1, round: 1, outcome: 'qa-pass' }),
      session({ kind: 'fix-checks', usd: 0.5, outcome: 'commit', effort: 'low' }),
      session({ issue: 8, pr: null, usd: 1.5, outcome: 'no-pr' }),
      merge(),
      merge({ pr: 43, issues: [9] }),
    ];
    const v = costsView(records, { now: NOW, days: 1 });
    expect(v.total).toMatchObject({ usd: 6, sessions: 4, merges: 2, perMerge: 3, wasteUsd: 1.5 });
    expect(v.total.byKind).toEqual({ issue: 4.5, qa: 1, 'fix-checks': 0.5 });
    expect(v.floors).toHaveLength(1);
    expect(v.floors[0]).toMatchObject({ repoId: 'acme/shop', perMerge: 3 });
  });

  it('has no cost per merge without a merge', () => {
    expect(costsView([session()], { now: NOW, days: 1 }).total.perMerge).toBeNull();
  });

  it('keeps floors and days apart, newest day first', () => {
    const records = [session({ at: TODAY - DAY_MS + HOUR_MS, usd: 4 }), merge({ at: TODAY - DAY_MS + 2 * HOUR_MS }), session({ repoId: 'acme/api', usd: 1 })];
    const v = costsView(records, { now: NOW, days: 7 });
    expect(v.byDay.map((d) => [d.usd, d.merges])).toEqual([
      [1, 0],
      [4, 1],
    ]);
    expect(v.floors.map((f) => [f.repoId, f.usd, f.perMerge])).toEqual([
      ['acme/api', 1, null],
      ['acme/shop', 4, 4],
    ]);
    expect(costsView(records, { now: NOW, days: 1 }).total.usd).toBe(1);
    expect(costsView(records, { now: NOW, days: 7, repoId: 'acme/shop' }).total.usd).toBe(4);
  });

  it('ranks issues with their PR’s QA and fixes, and knows which merged', () => {
    const records = [
      session({ usd: 2 }),
      session({ kind: 'qa', usd: 1, outcome: 'qa-fail', round: 1 }),
      session({ kind: 'fix-qa', usd: 1.5, outcome: 'commit' }),
      session({ issue: 8, pr: 50, usd: 3 }),
      session({ issue: null, pr: 77, kind: 'qa', usd: 0.5, outcome: 'qa-pass', round: 1 }),
      session({ repoId: '', issue: null, pr: null, kind: 'ceo-chat', usd: 9, outcome: 'ceo-acted' }),
      merge(),
    ];
    const top = costsView(records, { now: NOW, days: 1 }).top;
    expect(top.map((t) => [t.issue, t.pr, t.usd, t.sessions, t.merged])).toEqual([
      [7, 42, 4.5, 3, true],
      [8, 50, 3, 1, false],
      [null, 77, 0.5, 1, false],
    ]);
  });

  it('lists waste newest first, with what each session was for', () => {
    const records = [
      session({ at: TODAY + HOUR_MS, outcome: 'no-pr', usd: 1 }),
      session({ at: TODAY + 2 * HOUR_MS, kind: 'qa', round: 3, outcome: 'qa-fail', usd: 0.7 }),
      session({ at: TODAY + 3 * HOUR_MS, usd: 5 }),
      session({ at: TODAY + 4 * HOUR_MS, repoId: '', kind: 'ceo-review', issue: null, pr: null, outcome: 'ceo-idle', usd: 0.4, agent: 'Morgan' }),
    ];
    const waste = costsView(records, { now: NOW, days: 1 }).waste;
    expect(waste.map((w) => [w.kind, w.why, w.usd])).toEqual([
      ['ceo-review', 'a review that changed nothing', 0.4],
      ['qa', 'QA round 3', 0.7],
      ['issue', 'ended without a PR', 1],
    ]);
  });

  it('averages each kind of task at each effort', () => {
    const records = [session({ kind: 'qa', usd: 1, effort: 'medium' }), session({ kind: 'qa', usd: 3, effort: 'medium' }), session({ kind: 'qa', usd: 0.5, effort: 'low' })];
    const [qa] = costsView(records, { now: NOW, days: 7 }).kinds;
    expect(qa).toMatchObject({ kind: 'qa', sessions: 3, avg: 1.5 });
    expect(qa.byEffort).toEqual([
      { effort: 'medium', sessions: 2, avg: 2 },
      { effort: 'low', sessions: 1, avg: 0.5 },
    ]);
  });
});

describe('floorSpend (company_status)', () => {
  it('has today’s cost and waste, and the 7-day cost per merge', () => {
    const records = [session({ at: TODAY - 3 * DAY_MS, usd: 6 }), merge({ at: TODAY - 3 * DAY_MS }), session({ usd: 2, outcome: 'no-pr' }), session({ at: TODAY - 9 * DAY_MS, usd: 50 })];
    expect(floorSpend(records, 'acme/shop', NOW)).toEqual({ costToday: 2, costPerMerge: 8, wasteToday: 2 });
    expect(floorSpend(records, 'acme/api', NOW)).toEqual({ costToday: 0, costPerMerge: null, wasteToday: 0 });
  });
});

describe('the ledger file', () => {
  it('skips lines that do not parse', () => {
    const text = `${JSON.stringify(session())}\n{"type":"session","at":1,"repoId":"x","kind":"nope"}\n${JSON.stringify(merge())}\n{"type":"sess`;
    expect(parseLedger(text).map((r) => r.type)).toEqual(['session', 'merge']);
  });

  it('prunes what is older than 30 days', () => {
    const old = session({ at: NOW - 31 * DAY_MS });
    const kept = session({ at: NOW - 29 * DAY_MS });
    expect(pruneLedger([old, kept], NOW)).toEqual([kept]);
  });

  it('appends, keeps each merge once, and prunes the file on load', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'costs-'));
    const file = path.join(dir, 'costs.jsonl');
    await fs.writeFile(file, `${JSON.stringify(session({ at: NOW - 40 * DAY_MS }))}\n${JSON.stringify(session({ at: NOW - DAY_MS }))}\n`);
    const ledger = new CostLedger(file, () => NOW);
    await ledger.load();
    expect(parseLedger(await fs.readFile(file, 'utf8'))).toHaveLength(1);
    await ledger.session({ ...session(), usd: 1.23456 });
    await ledger.merges([{ at: NOW - HOUR_MS, repoId: 'acme/shop', pr: 42, issues: [7] }]);
    await ledger.merges([{ at: NOW - HOUR_MS, repoId: 'acme/shop', pr: 42, issues: [7] }]);
    const again = new CostLedger(file, () => NOW);
    await again.load();
    expect(again.all().map((r) => r.type)).toEqual(['session', 'session', 'merge']);
    expect((again.all()[1] as CostSession).usd).toBe(1.2346);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe('the demo’s made-up week', () => {
  it('has sessions of several kinds, merges and waste on every floor', () => {
    const floors = [
      { repoId: 'demo/a', agents: [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Bob' }] },
      { repoId: 'demo/b', agents: [{ id: 'c', name: 'Cy' }] },
    ];
    const records = sampleCosts(floors, { id: 'ceo', name: 'Morgan' }, NOW, seeded(18));
    expect(records.every((r) => r.at <= NOW)).toBe(true);
    const v = costsView(records, { now: NOW, days: 7 });
    expect(v.floors.map((f) => f.repoId)).toEqual(['', 'demo/a', 'demo/b']);
    expect(v.total.merges).toBeGreaterThan(5);
    expect(v.waste.length).toBeGreaterThan(0);
    expect(v.kinds.map((k) => k.kind)).toEqual(expect.arrayContaining(['issue', 'qa', 'fix-qa', 'ceo-review']));
  });
});

describe('effortHint', () => {
  it('says what the kind averaged at each effort, the most used first', () => {
    const row = { kind: 'qa' as const, sessions: 4, avg: 1, byEffort: [{ effort: 'low' as const, sessions: 1, avg: 0.4 }, { effort: '' as const, sessions: 3, avg: 0.84 }] };
    expect(effortHint('qa', row, 'medium')).toBe('QA averaged $0.84 at medium (3), $0.40 at low (1) over the last 30 days.');
    expect(effortHint('qa', undefined, 'medium')).toBeNull();
  });
});

describe('SessionCosts', () => {
  const agent = { id: 'a1', name: 'Ada', model: '', effort: '' as const, issueNumber: 7, prNumber: 42, startedAt: 0 };
  const ok = { costUsd: 1, ok: true };
  const recorder = () => {
    const lines: Omit<CostSession, 'type'>[] = [];
    const spend = new SessionCosts({ session: (s: Omit<CostSession, 'type'>) => void lines.push(s) } as unknown as CostLedger, () => false);
    return { spend, lines };
  };

  it('records the handler’s outcome for the run taken before it ran, never a stale one', () => {
    const { spend, lines } = recorder();
    spend.start('a1', { kind: 'fix-checks', effort: 'high', model: 'm', startedAt: Date.now(), round: null });
    spend.outcome('a1', 'no-commit'); // left over from an earlier session
    const run = spend.take('a1');
    spend.outcome('a1', 'commit');
    void spend.record(agent, 'acme/shop', run, 'issue', ok, { stopped: false });
    void spend.record(agent, 'acme/shop', spend.take('a1'), 'issue', ok, { stopped: false });
    expect(lines.map((l) => [l.kind, l.effort, l.outcome])).toEqual([
      ['fix-checks', 'high', 'commit'],
      ['issue', '', 'done'],
    ]);
  });

  it('marks the session the watchdog stopped, and counts the CEO’s acts once a promise settles', async () => {
    const { spend, lines } = recorder();
    spend.watchdogStopped('a1');
    void spend.record(agent, 'acme/shop', null, 'issue', { costUsd: 1, ok: false }, { stopped: false });
    expect(lines[0].outcome).toBe('watchdog');
    const sync = spend.acts((n: number) => n + 1);
    const later = spend.acts(async () => 'ok');
    expect(sync(1)).toBe(2);
    await later(undefined);
    expect(spend.ceoActs).toBe(2);
  });
});

describe('the office’s cost helpers', () => {
  it('names a task’s kind, a fix by why its PR went back', () => {
    expect([taskKindOf('qa', 'checks'), taskKindOf('fix', 'conflict'), taskKindOf('fix', null), taskKindOf('issue', null)]).toEqual(['qa', 'fix-conflict', 'fix-qa', 'issue']);
  });

  it('patches effort per kind, and refuses unknown kinds and efforts', () => {
    const efforts = ['low', 'high'] as const;
    expect(taskEfforts({ qa: 'low' }, { qa: '', issue: 'high' }, [...efforts])).toEqual({ issue: 'high' });
    expect(() => taskEfforts({}, { nope: 'low' }, [...efforts])).toThrow('Unknown task kind');
    expect(() => taskEfforts({}, { qa: 'max' }, [...efforts])).toThrow('is not an effort');
  });

  it('reads /api/costs’ query: days clamped, unknown floors refused', () => {
    expect(costsRequest([], '90', undefined, () => true).days).toBe(30);
    expect(costsRequest([], 'x', '', () => true).days).toBe(7);
    expect(() => costsRequest([], 7, 'acme/nope', () => false)).toThrow('No such floor');
  });
});
