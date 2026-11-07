import { describe, expect, it } from 'vitest';
import { changesBlock, changesDue, changeStats, CHANGES_DEBOUNCE_MS, emptyChanges, markVerdict, recordChange, reviewing, settle, spared, takeUntold } from './managerChanges.ts';
import type { ManagerChange } from './types.ts';

const T = new Date(2026, 10, 7, 12).getTime();
let seq = 0;
const change = (o: Partial<ManagerChange> = {}): ManagerChange => ({ id: `c${++seq}`, at: T, kind: 'close-issue', repoId: 'r1', floor: 1, issue: 12, pr: null, detail: 'closed #12 "Dark mode"', affects: [], told: false, verdict: null, ...o });

describe('recordChange and changesDue', () => {
  it('debounces a burst that touched running work into one wake-up, 60 s after the last change', () => {
    const s = emptyChanges();
    recordChange(s, change({ affects: ['a1'] }), T);
    recordChange(s, change({ affects: ['a2'], at: T + 20_000 }), T + 20_000);
    recordChange(s, change({ affects: ['a1'], at: T + 40_000 }), T + 40_000);
    expect(changesDue(s, T + CHANGES_DEBOUNCE_MS)).toBe(false); // the burst is still going
    expect(changesDue(s, T + 40_000 + CHANGES_DEBOUNCE_MS)).toBe(true);
    expect(takeUntold(s, false)).toEqual([]); // another job leaves them to the changes job
    expect(takeUntold(s, true)).toHaveLength(3); // which hears all three
    expect(changesDue(s, T + 10 * CHANGES_DEBOUNCE_MS)).toBe(false);
  });

  it("never wakes the CEO for changes that touched no running work: they wait for its next job", () => {
    const s = emptyChanges();
    recordChange(s, change({ kind: 're-qa', issue: null, pr: 7, detail: 'sent PR #7 to QA again' }), T);
    expect(s.wakeAt).toBeNull();
    const told = takeUntold(s, false);
    expect(told.map((c) => c.detail)).toEqual(['sent PR #7 to QA again']);
    expect(changesBlock(told, (_c, id) => id)).toContain('- floor 1: sent PR #7 to QA again');
    expect(takeUntold(s, true)).toEqual([]); // told once
  });

  it('drops told changes after two days, and keeps the untold', () => {
    const s = emptyChanges();
    recordChange(s, change({ told: true }), T);
    recordChange(s, change(), T);
    recordChange(s, change(), T + 3 * 24 * 3600_000);
    expect(s.list.map((c) => c.told)).toEqual([false, false]);
  });
});

describe('the CEO decides', () => {
  it('names the agents still running in the block', () => {
    expect(changesBlock([change({ affects: ['a1'] })], (_c, id) => `Ada (${id}, building #12)`)).toContain('closed #12 "Dark mode" · touched: Ada (a1, building #12)');
  });

  it("marks the CEO's verdict, and lets finish what it didn't act on", () => {
    const s = emptyChanges();
    const a = change({ affects: ['a1'] });
    const b = change({ affects: ['a2'] });
    const quiet = change();
    for (const c of [a, b, quiet]) recordChange(s, c, T);
    const ada = { id: 'a1', repoId: 'r1', task: 'issue' as const, issueNumber: 12, prNumber: null };
    expect(reviewing(s, ada)).toBe(true);
    expect(reviewing(s, { ...ada, issueNumber: 13 })).toBe(false); // moved on to another issue: not theirs to review
    expect(markVerdict(s, 'a1', 'stopped')).toBe(true);
    expect(reviewing(s, ada)).toBe(false);
    settle(s, [a.id, b.id, quiet.id]);
    expect([a.verdict, b.verdict, quiet.verdict]).toEqual(['stopped', 'let-finish', null]);
    expect(changeStats(s.list, T)).toEqual({ today: 3, touched: 2, stopped: 1, redirected: 0, letFinish: 1 });
    expect(changeStats(s.list, T + 24 * 3600_000).today).toBe(0);
  });

  it("spares the agents the manager's close or merge of that issue or PR touched", () => {
    const list = [change({ affects: ['a1'] }), change({ kind: 'close-pr', issue: null, pr: 30, affects: ['a2'] }), change({ kind: 'send-back', issue: null, pr: 30, affects: ['a3'] }), change({ kind: 'merge', issue: 14, pr: 31, affects: ['a4'] })];
    expect(spared(list, 'r1', { kind: 'issue', number: 12 })).toEqual(['a1']);
    expect(spared(list, 'r1', { kind: 'pr', number: 30 })).toEqual(['a2']); // a send-back closes nothing
    expect(spared(list, 'r1', { kind: 'issue', number: 14 })).toEqual(['a4']);
    expect(spared(list, 'r2', { kind: 'issue', number: 12 })).toEqual([]);
  });
});
