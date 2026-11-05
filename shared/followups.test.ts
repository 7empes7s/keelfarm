import { describe, expect, it } from 'vitest';
import { addFollowup, DEFAULT_FOLLOWUPS, emptyFollowups, followupEvents, followupSettings, followupStep, followupWaiting, loadFollowups, mandateFor, mandateList, MAX_FOLLOWUP_EVENTS, MAX_MANDATES, quietReply, takeFollowups, unblockedIssues, type FollowupEvent } from './followups.ts';
import type { FollowupSettings } from './followups.ts';

const MIN = 60_000;
const settings = (over: Partial<FollowupSettings> = {}): FollowupSettings => ({ ...DEFAULT_FOLLOWUPS, ...over, kinds: { ...DEFAULT_FOLLOWUPS.kinds, ...over.kinds } });
const merged = (n: number, at: number): Omit<FollowupEvent, 'id'> => ({ kind: 'merged', key: `merged:r#${n}`, label: `#${n} merged`, text: `PR #${n} merged`, repoId: 'r', at });

describe('batching follow-up events', () => {
  it('starts one job once the window has passed since the first event, with every event in it', () => {
    const s = emptyFollowups();
    addFollowup(s, merged(13, 0), settings());
    expect(followupStep(s, { now: 5 * MIN, settings: settings(), usage: 'normal' })).toEqual({ do: 'wait', until: 10 * MIN, why: 'window' });
    addFollowup(s, merged(14, 6 * MIN), settings()); // within the window: joins it, and the window doesn't move
    expect(followupStep(s, { now: 10 * MIN, settings: settings(), usage: 'normal' })).toEqual({ do: 'start' });
    const events = takeFollowups(s, 10 * MIN);
    expect(events.map((e) => e.label)).toEqual(['#13 merged', '#14 merged']);
    expect(events.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(followupStep(s, { now: 11 * MIN, settings: settings(), usage: 'normal' })).toEqual({ do: 'none' });
  });

  it('merges the same thing happening again and keeps its id', () => {
    const s = emptyFollowups();
    addFollowup(s, merged(13, 0), settings());
    addFollowup(s, { ...merged(13, MIN), text: 'again' }, settings());
    expect(s.pending).toHaveLength(1);
    expect(s.pending[0]).toMatchObject({ id: 'e1', text: 'again' });
  });

  it('keeps only the newest events', () => {
    const s = emptyFollowups();
    for (let n = 0; n < MAX_FOLLOWUP_EVENTS + 5; n++) addFollowup(s, merged(n, n), settings());
    expect(s.pending).toHaveLength(MAX_FOLLOWUP_EVENTS);
    expect(s.pending[0].label).toBe('#5 merged');
  });

  it('starts at once with a window of 0', () => {
    const s = emptyFollowups();
    addFollowup(s, merged(1, 0), settings({ windowMin: 0 }));
    expect(followupStep(s, { now: 0, settings: settings({ windowMin: 0 }), usage: 'normal' })).toEqual({ do: 'start' });
  });
});

describe('the hourly cap', () => {
  it('starts at most perHour jobs in an hour, then waits for the oldest to be an hour old', () => {
    const cfg = settings({ windowMin: 0, perHour: 2 });
    const s = emptyFollowups();
    for (const at of [0, 10 * MIN]) {
      addFollowup(s, merged(at, at), cfg);
      expect(followupStep(s, { now: at, settings: cfg, usage: 'normal' })).toEqual({ do: 'start' });
      takeFollowups(s, at);
    }
    addFollowup(s, merged(3, 20 * MIN), cfg);
    expect(followupStep(s, { now: 20 * MIN, settings: cfg, usage: 'normal' })).toEqual({ do: 'wait', until: 60 * MIN, why: 'cap' });
    addFollowup(s, merged(4, 30 * MIN), cfg); // waits with it
    expect(followupStep(s, { now: 60 * MIN, settings: cfg, usage: 'normal' })).toEqual({ do: 'start' });
    expect(takeFollowups(s, 60 * MIN)).toHaveLength(2);
  });

  it('turns follow-ups off at 0 per hour', () => {
    const s = emptyFollowups();
    expect(addFollowup(s, merged(1, 0), settings({ perHour: 0 }))).toBe(false);
    expect(s.pending).toHaveLength(0);
  });
});

describe('pacing and pauses', () => {
  it('holds follow-ups while usage is pacing or paused, merging what comes in, and starts them after', () => {
    const cfg = settings({ windowMin: 1 });
    const s = emptyFollowups();
    addFollowup(s, merged(1, 0), cfg);
    for (const usage of ['pacing', 'paused'] as const) expect(followupStep(s, { now: 30 * MIN, settings: cfg, usage })).toEqual({ do: 'wait', until: null, why: 'usage' });
    addFollowup(s, merged(2, 31 * MIN), cfg);
    expect(s.pending).toHaveLength(2);
    expect(followupStep(s, { now: 32 * MIN, settings: cfg, usage: 'normal' })).toEqual({ do: 'start' });
  });
});

describe('per-kind settings', () => {
  it('ignores a kind that is turned off', () => {
    const cfg = settings({ kinds: { ...DEFAULT_FOLLOWUPS.kinds, merged: false } });
    const s = emptyFollowups();
    expect(addFollowup(s, merged(1, 0), cfg)).toBe(false);
    expect(addFollowup(s, { kind: 'qaFailed', key: 'qa:r#2', label: '#2 failed QA 2×', text: '', at: 0 }, cfg)).toBe(true);
  });

  it('drops events already waiting when their kind is turned off', () => {
    const s = emptyFollowups();
    addFollowup(s, merged(1, 0), settings());
    const off = settings({ kinds: { ...DEFAULT_FOLLOWUPS.kinds, merged: false } });
    expect(followupStep(s, { now: 20 * MIN, settings: off, usage: 'normal' })).toEqual({ do: 'none' });
    expect(s.pending).toHaveLength(0);
  });

  it('sanitises the settings patch', () => {
    const cfg = followupSettings(DEFAULT_FOLLOWUPS, { kinds: { merged: false, bogus: true, usage: 'no' }, windowMin: 999, perHour: -3 });
    expect(cfg.kinds.merged).toBe(false);
    expect(cfg.kinds.usage).toBe(true);
    expect('bogus' in cfg.kinds).toBe(false);
    expect(cfg.windowMin).toBe(120);
    expect(cfg.perHour).toBe(0);
    expect(followupSettings(undefined, null)).toEqual(DEFAULT_FOLLOWUPS);
  });

  it('loads a saved state, or starts fresh', () => {
    expect(loadFollowups(undefined)).toEqual(emptyFollowups());
    const s = emptyFollowups();
    addFollowup(s, merged(1, 5), settings());
    expect(loadFollowups(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});

describe('mandates', () => {
  const m = (over: object) => ({ id: 'm', text: 'Keep improving it', floors: [], expiresAt: null, at: 0, ...over });

  it('covers the floors it names, or every floor, until it expires', () => {
    const list = mandateList([m({ id: 'a', floors: [3] }), m({ id: 'b', floors: [5], expiresAt: 100 })]);
    expect(mandateFor(list, 3, 0)?.id).toBe('a');
    expect(mandateFor(list, 5, 50)?.id).toBe('b');
    expect(mandateFor(list, 5, 100)).toBeNull();
    expect(mandateFor(list, 2, 0)).toBeNull();
    expect(mandateFor(mandateList([m({ id: 'all' })]), 2, 0)?.id).toBe('all');
  });

  it('keeps well-formed mandates only, the newest MAX_MANDATES', () => {
    expect(mandateList([{ text: '  ' }, null, 'x', m({ floors: [2, 2, -1, 'z'] })])).toEqual([m({ floors: [2] })]);
    const many = mandateList(Array.from({ length: MAX_MANDATES + 3 }, (_, i) => m({ id: `m${i}` })));
    expect(many).toHaveLength(MAX_MANDATES);
    expect(many[0].id).toBe('m3');
  });
});

describe('what a follow-up reports', () => {
  it('keeps "nothing to do" off the phone', () => {
    expect(quietReply('Nothing to do.')).toBe(true);
    expect(quietReply('  nothing to do')).toBe(true);
    expect(quietReply('Nothing to do: #13 meets its criteria.')).toBe(true);
    expect(quietReply('Filed #20: the jukebox misses its volume control.')).toBe(false);
    expect(quietReply('Nothing to do on floor 2.\nBut PR #13 needs you: it broke the lift.')).toBe(false);
  });

  it('spots issues whose dependency just closed', () => {
    const before = [
      { number: 1, body: '' },
      { number: 2, body: 'Depends on #1' },
      { number: 3, body: 'Depends on #1, #4' },
      { number: 4, body: '' },
    ];
    const after = before.filter((i) => i.number !== 1);
    expect(unblockedIssues(before, after).map((i) => i.number)).toEqual([2]);
    expect(unblockedIssues(after, after)).toEqual([]);
  });
});

describe("the events' wording and the CEO tab's view", () => {
  it('builds each event with a key that merges repeats', () => {
    const m = followupEvents.merged('r1', 'floor 1 (o/r)', 13, 'Add login', [4, 5]);
    expect(m).toMatchObject({ kind: 'merged', key: 'merged:r1#13', label: '#13 merged', repoId: 'r1' });
    expect(m.text).toContain('closing #4, #5');
    expect(followupEvents.stalled({ id: 'a1', name: 'Ada' }, 'QA', 30).text).not.toContain(' on undefined');
    expect(followupEvents.agentError({ id: 'a1', name: 'Ada' }, 'k', 12, 'boom', 'r1', 'floor 1 (o/r)').key).toBe('error:k');
    expect(followupEvents.qaFailed('r1', 'floor 1 (o/r)', 7, 2, 3, 'broken.').label).toBe('#7 failed QA 2×');
  });

  it('says when the waiting job starts, without changing the state', () => {
    const s = emptyFollowups();
    expect(followupWaiting(s, { now: 0, settings: DEFAULT_FOLLOWUPS, usage: 'normal' })).toEqual({ pending: [], startsAt: null, held: null });
    addFollowup(s, { ...followupEvents.merged('r1', 'f', 1, 't', []), at: 1000 }, DEFAULT_FOLLOWUPS);
    const before = JSON.stringify(s);
    const held = followupWaiting(s, { now: 2000, settings: DEFAULT_FOLLOWUPS, usage: 'paused' });
    expect(held).toMatchObject({ pending: ['#1 merged'], held: 'usage' });
    expect(JSON.stringify(s)).toBe(before);
  });
});
