import { describe, expect, it } from 'vitest';
import { areaFiles, conflictFixRun, conflictFixSettings, conflictStats, holdReason, mergeOrder, overlapScore, pickNext, playbookAreas, type ReadyItem } from './conflicts.ts';
import type { CostRecord, CostSession } from './costs.ts';
import type { Lease } from './practices.ts';

const lease = (issue: number, pr: number | null, files: string[]): Lease => ({ issue, pr, agentId: null, files, source: pr ? 'pr' : 'predicted' });
const item = (number: number, files: string[], o: Partial<ReadyItem> = {}): ReadyItem => ({ number, files, on: true, priority: false, ...o });
const opts = { now: 1000, heldSince: new Map<number, number>() };

describe('overlap scoring', () => {
  it('counts a point per shared file per piece of work in flight, and names the most-shared one', () => {
    const leases = [lease(10, 251, ['client/src/ui/Chat.tsx', 'client/src/pocket/pocket.css']), lease(11, null, ['client/src/ui/Chat.tsx'])];
    const s = overlapScore(['client/src/ui/Chat.tsx', 'client/src/pocket/pocket.css', 'server/x.ts'], leases, 99);
    expect(s.score).toBe(3);
    expect(s.by?.pr).toBe(251);
    expect(s.files).toEqual(['client/src/ui/Chat.tsx', 'client/src/pocket/pocket.css']);
    expect(overlapScore(['server/x.ts'], leases, 99).score).toBe(0);
    expect(overlapScore(['client/src/ui/Chat.tsx'], [lease(5, 1, ['client/src/ui/Chat.tsx'])], 5).score).toBe(0); // its own lease
    expect(overlapScore(['Chat.tsx'], leases, 99).score).toBe(2); // a bare name matches the file in any folder
  });
});

describe('pickNext', () => {
  const busy = [lease(10, 251, ['client/src/ui/Chat.tsx', 'client/src/pocket/pocket.css'])];

  it('skips an issue overlapping busy files when a non-overlapping one is ready, and says why', () => {
    const r = pickNext([item(1, ['client/src/ui/Chat.tsx', 'client/src/pocket/pocket.css']), item(2, ['server/x.ts'])], busy, opts);
    expect(r.pick).toBe(2);
    expect(r.avoided).toBe(true);
    expect(r.held).toEqual([{ issue: 1, by: { issue: 10, pr: 251 }, files: ['client/src/ui/Chat.tsx', 'client/src/pocket/pocket.css'], since: 1000 }]);
    expect(holdReason(r.held[0])).toBe('waits for PR #251: same files: Chat.tsx, pocket.css');
  });

  it('shows an overlapping issue behind the pick as waiting too, without counting it avoided', () => {
    const r = pickNext([item(2, ['server/x.ts']), item(1, ['client/src/ui/Chat.tsx', 'client/src/pocket/pocket.css'])], busy, opts);
    expect(r.pick).toBe(2);
    expect(r.held.map((h) => h.issue)).toEqual([1]);
    expect(r.avoided).toBe(false);
  });

  it('a light overlap (one shared file with one PR) does not hold an issue back', () => {
    const r = pickNext([item(1, ['client/src/ui/Chat.tsx']), item(2, ['server/x.ts'])], busy, opts);
    expect(r).toEqual({ pick: 1, held: [], avoided: false });
  });

  it('never leaves an agent idle: when every ready issue overlaps, the least-overlapping one starts', () => {
    const leases = [...busy, lease(11, 252, ['client/src/ui/Chat.tsx', 'client/src/ui/Kanban.tsx'])];
    const r = pickNext([item(1, ['client/src/ui/Chat.tsx', 'client/src/pocket/pocket.css']), item(2, ['client/src/ui/Kanban.tsx', 'client/src/ui/Chat.tsx'])], leases, opts);
    // #1 scores 3 (Chat.tsx twice, pocket.css once), #2 scores 3 too: the first of the least wins
    expect(r.pick).toBe(1);
    expect(r.held.map((h) => h.issue)).toEqual([2]); // the board shows every issue that waits
    const r2 = pickNext([item(1, ['client/src/ui/Chat.tsx', 'client/src/pocket/pocket.css', 'client/src/ui/Kanban.tsx']), item(2, ['client/src/ui/Kanban.tsx', 'client/src/pocket/pocket.css'])], leases, opts);
    expect(r2.pick).toBe(2);
    expect(r2.held.map((h) => h.issue)).toEqual([1]);
    expect(r2.avoided).toBe(false); // nothing non-overlapping was there to take instead
  });

  it("a priority pick overrides: it starts even though it overlaps", () => {
    const r = pickNext([item(1, ['client/src/ui/Chat.tsx', 'client/src/pocket/pocket.css'], { priority: true }), item(2, ['server/x.ts'])], busy, opts);
    expect(r).toEqual({ pick: 1, held: [], avoided: false });
  });

  it('with the practice off for an issue, it goes in order as today', () => {
    const r = pickNext([item(1, ['client/src/ui/Chat.tsx', 'client/src/pocket/pocket.css'], { on: false }), item(2, ['server/x.ts'])], busy, opts);
    expect(r).toEqual({ pick: 1, held: [], avoided: false });
    expect(pickNext([], busy, opts).pick).toBeNull();
  });
});

describe('predicting files from the floor playbook', () => {
  it('reads "area" lines and expands a trailing * over known paths', () => {
    const areas = playbookAreas('## Areas\n- area chat: client/src/ui/Chat*, client/src/ui/chat.css\n- area kanban: `client/src/ui/KanbanView.tsx`\nnot an area: x');
    expect(areas).toEqual([
      { word: 'chat', paths: ['client/src/ui/Chat*', 'client/src/ui/chat.css'] },
      { word: 'kanban', paths: ['client/src/ui/KanbanView.tsx'] },
    ]);
    const known = ['client/src/ui/Chat.tsx', 'client/src/ui/ChatBubble.tsx', 'server/x.ts'];
    expect(areaFiles('The chat scrolls badly', areas, known)).toEqual(['client/src/ui/Chat.tsx', 'client/src/ui/ChatBubble.tsx', 'client/src/ui/chat.css']);
    expect(areaFiles('Chat', areas, [])).toEqual(['client/src/ui/', 'client/src/ui/chat.css']);
    expect(areaFiles('chatter about nothing', areas, known)).toEqual([]); // whole words only
  });
});

describe('merge order', () => {
  it('puts the PR touching the most hot files first, ties in the given order', () => {
    const prs = [
      { number: 1, files: ['README.md'] },
      { number: 2, files: ['src/App.tsx', 'CHANGELOG.md'] },
      { number: 3, files: ['src/styles.css'] },
    ];
    expect(mergeOrder(prs, ['src/App.tsx', 'CHANGELOG.md', 'src/styles.css'], prs)).toEqual([2, 3, 1]);
    // files other open PRs change count as hot too
    expect(mergeOrder(prs.slice(0, 2), [], [...prs, { number: 9, files: ['README.md'] }])).toEqual([1, 2]);
    expect(mergeOrder(prs, [], prs)).toEqual([1, 2, 3]);
  });
});

describe('cheap conflict rounds', () => {
  const DEFAULT_CONFLICT_FIX = conflictFixSettings(undefined, {});
  const conflict = { fixReason: 'conflict' as const, preQa: { sha: 'a', fixReason: null }, passedSha: null };
  const o = { files: ['client/src/ui/Chat.tsx'], checks: 'passing', claude: true };

  it('a conflict-only round picks the cheap model and effort', () => {
    expect(conflictFixRun(conflict, o, DEFAULT_CONFLICT_FIX)).toEqual({ model: 'claude-sonnet-5', effort: 'low' });
    expect(conflictFixRun({ ...conflict, preQa: null, passedSha: 'abc' }, o, DEFAULT_CONFLICT_FIX)).not.toBeNull(); // QA passed, then it conflicted
  });

  it('a failed cheap round escalates: the next round runs on the normal model', () => {
    expect(conflictFixRun({ ...conflict, cheapFix: { model: 'claude-sonnet-5', effort: 'low' } }, o, DEFAULT_CONFLICT_FIX)).toBeNull();
  });

  it('keeps the normal model when the round is not conflict-only or touches office logic', () => {
    expect(conflictFixRun({ ...conflict, fixReason: 'qa' }, o, DEFAULT_CONFLICT_FIX)).toBeNull();
    expect(conflictFixRun({ ...conflict, fixReason: 'checks' }, o, DEFAULT_CONFLICT_FIX)).toBeNull();
    expect(conflictFixRun({ ...conflict, preQa: null }, o, DEFAULT_CONFLICT_FIX)).toBeNull(); // QA failed the last round: its findings ride along
    expect(conflictFixRun(conflict, { ...o, checks: 'failing' }, DEFAULT_CONFLICT_FIX)).toBeNull();
    expect(conflictFixRun(conflict, { ...o, files: ['server/swarm/merge.ts'] }, DEFAULT_CONFLICT_FIX)).toBeNull();
    expect(conflictFixRun(conflict, { ...o, files: ['scripts/office.mjs'] }, DEFAULT_CONFLICT_FIX)).toBeNull();
    expect(conflictFixRun(conflict, { ...o, files: null }, DEFAULT_CONFLICT_FIX)).toBeNull();
    expect(conflictFixRun(conflict, { ...o, claude: false }, DEFAULT_CONFLICT_FIX)).toBeNull();
    expect(conflictFixRun(conflict, o, { ...DEFAULT_CONFLICT_FIX, model: '' })).toBeNull(); // switched off in Settings
  });

  it('checks the settings patch', () => {
    expect(DEFAULT_CONFLICT_FIX).toMatchObject({ model: 'claude-sonnet-5', effort: 'low' });
    expect(conflictFixSettings(undefined, { model: ' claude-haiku-4-5-20251001 ', effort: 'medium' })).toEqual({ ...DEFAULT_CONFLICT_FIX, model: 'claude-haiku-4-5-20251001', effort: 'medium' });
    expect(conflictFixSettings(DEFAULT_CONFLICT_FIX, { strongFiles: ['./server/ceo.ts', 3] }).strongFiles).toEqual(['server/ceo.ts']);
    expect(() => conflictFixSettings(DEFAULT_CONFLICT_FIX, { effort: 'huge' })).toThrow(/effort/);
  });
});

describe('conflict stats', () => {
  const DAY = 24 * 60 * 60_000;
  const TODAY = Date.UTC(2026, 10, 7);
  const NOW = TODAY + 12 * 3_600_000;
  const s = (o: Partial<CostSession>): CostSession => ({ type: 'session', at: NOW - 3_600_000, ms: 1, repoId: 'r', agentId: 'a', agent: 'A', kind: 'fix-conflict', issue: 1, pr: 1, round: null, cause: 'conflict', model: 'm', effort: 'low', usd: 1, tokens: null, outcome: 'commit', ...o });

  it('counts conflict rounds per merge and what cheap rounds saved against normal ones', () => {
    const records: CostRecord[] = [
      s({ pr: 1, usd: 2 }),
      s({ pr: 1, usd: 0.5, cheap: true }),
      s({ pr: 2, kind: 'qa', outcome: 'qa-fail', usd: 1 }),
      s({ pr: 2, kind: 'qa', outcome: 'qa-fail', cause: 'bug' }),
      s({ pr: 3, usd: 2, at: TODAY - 20 * DAY }),
      { type: 'merge', at: NOW, repoId: 'r', pr: 1, issues: [1] },
      { type: 'merge', at: NOW, repoId: 'r', pr: 2, issues: [2] },
    ];
    const c = conflictStats(records, TODAY, NOW);
    expect(c.perMerge).toBe(1.5); // PR 1's two conflict fixes and PR 2's conflict QA fail, over two merges
    expect(c.cheapRounds).toBe(1);
    expect(c.savedUsd).toBe(1.5); // the normal ones averaged $2
    expect(c.trend).toHaveLength(30);
    expect(c.trend[29]).toBe(1.5);
    expect(conflictStats([s({ cheap: true })], TODAY, NOW).savedUsd).toBeNull(); // nothing to compare against yet
  });
});
