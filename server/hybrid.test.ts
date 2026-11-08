import { describe, expect, it } from 'vitest';
import { burstFloor, burstLeavers, hybridPlace, localFirst, localRoom } from './hybrid.ts';

const room = { fit: { freeMb: 6000, needMb: 3200 }, slotsFull: false, sessionLimit: 0, localAgents: 2, localMax: 0 };

describe('localRoom', () => {
  it('has room with memory to spare, no full session limit and under the most agents here', () => {
    expect(localRoom(room)).toBeNull();
    expect(localRoom({ ...room, fit: null })).toBeNull(); // memory not read yet
  });

  it('says why not', () => {
    expect(localRoom({ ...room, fit: { freeMb: 2662, needMb: 3174 } })).toBe('2.6 GB free, 3.1 GB needed');
    expect(localRoom({ ...room, slotsFull: true, sessionLimit: 3 })).toBe('all 3 session slots are busy');
    expect(localRoom({ ...room, localMax: 2 })).toBe('2 agents here, your most on this computer');
  });
});

describe('hybridPlace', () => {
  it('puts a new agent here when there is room, else in a Box, else refuses with both reasons', () => {
    expect(hybridPlace(null, null)).toBe('local');
    expect(hybridPlace(null, 'Box limit reached')).toBe('local');
    expect(hybridPlace('2.6 GB free, 3.1 GB needed', null)).toBe('box');
    expect(hybridPlace('2.6 GB free, 3.1 GB needed', "Your Upstash plan's Box limit (10) is reached.")).toEqual({ refusal: "No room on this computer (2.6 GB free, 3.1 GB needed). Your Upstash plan's Box limit (10) is reached." });
  });
});

describe('burstFloor', () => {
  const now = 1_000_000_000;
  const floor = { repoId: 'r1', team: 2, max: 6, waiting: 3, cloudFree: 0 };
  const base = { now, waitingSince: now - 6 * 60_000, afterMs: 5 * 60_000, floors: [floor], bursting: 0, burstMax: 2, boxRoom: true };

  it('adds one after work has waited long enough', () => {
    expect(burstFloor(base)).toBe(floor);
    expect(burstFloor({ ...base, waitingSince: now - 4 * 60_000 })).toBeNull();
    expect(burstFloor({ ...base, waitingSince: null })).toBeNull();
  });

  it('adds at most the cap, within the Box limit, never past the floor max', () => {
    expect(burstFloor({ ...base, bursting: 2 })).toBeNull();
    expect(burstFloor({ ...base, boxRoom: false })).toBeNull();
    expect(burstFloor({ ...base, floors: [{ ...floor, team: 6 }] })).toBeNull();
  });

  it('skips floors with nothing waiting, or a free cloud agent to take it', () => {
    const other = { ...floor, repoId: 'r2' };
    expect(burstFloor({ ...base, floors: [{ ...floor, waiting: 0 }, other] })).toBe(other);
    expect(burstFloor({ ...base, floors: [{ ...floor, cloudFree: 1 }] })).toBeNull();
  });
});

describe('burstLeavers', () => {
  const now = 1_000_000_000;
  const min = 60_000;
  const agents = [
    { id: 'idle', burst: now - 30 * min, busy: false, endedAt: now - 11 * min },
    { id: 'busy', burst: now - 30 * min, busy: true, endedAt: now - 20 * min },
    { id: 'fresh', burst: now - 30 * min, busy: false, endedAt: now - 2 * min },
    { id: 'hired', busy: false, endedAt: now - 60 * min }, // not added by burst
  ];

  it('lets only idle burst agents go, after the idle time', () => {
    expect(burstLeavers({ now, idleMs: 10 * min, localRoom: false, agents })).toEqual(['idle']);
  });

  it('lets every idle one go once this computer has room, never one on a task', () => {
    expect(burstLeavers({ now, idleMs: 10 * min, localRoom: true, agents })).toEqual(['idle', 'fresh']);
  });

  it("keeps one still coming up (Box being set up, or waiting to sign in) past the idle time, until this computer has room", () => {
    const up = [{ id: 'up', burst: now - 30 * min, busy: false, starting: true, endedAt: null }];
    expect(burstLeavers({ now, idleMs: 10 * min, localRoom: false, agents: up })).toEqual([]);
    expect(burstLeavers({ now, idleMs: 10 * min, localRoom: true, agents: up })).toEqual(['up']);
  });

  it('counts a new one idle from when it joined', () => {
    expect(burstLeavers({ now, idleMs: 10 * min, localRoom: false, agents: [{ id: 'new', burst: now - 5 * min, busy: false, endedAt: null }] })).toEqual([]);
  });
});

describe('localFirst', () => {
  it("hands work to a free agent on this computer before a cloud one, keeping each group's order", () => {
    const free = [{ id: 'box1', host: 'box' }, { id: 'a' }, { id: 'box2', host: 'box' }, { id: 'b', host: 'local' }];
    expect(localFirst(free).map((a) => a.id)).toEqual(['a', 'b', 'box1', 'box2']);
  });
});
