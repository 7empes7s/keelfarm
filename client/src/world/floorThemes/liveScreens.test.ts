import { describe, expect, it } from 'vitest';
import type { AgentStatus } from '../../../../shared/types';
import { alertBeacon, contentCalendar, galleryShots, ledBlinkHz, lossCurve, nocFloor, nocSystem, onAir, overallLevel, PER_DAY } from './liveScreens';

const person = (status: AgentStatus, role = 'agent') => ({ role, status });

describe('the media studio (#371)', () => {
  it('lights ON AIR while anyone on the floor works, not for the CEO or idle desks', () => {
    expect(onAir([])).toBe(false);
    expect(onAir([person('idle'), person('error'), person('working', 'ceo')])).toBe(false);
    expect(onAir([person('idle'), person('working')])).toBe(true);
    expect(onAir([person('preparing')])).toBe(true);
  });

  it('puts what agents are building on today, live, and the backlog oldest first on the next working days', () => {
    const now = new Date(2026, 10, 13, 15); // a Friday
    const issue = (number: number, day: number, untrusted = false) => ({ number, title: `Issue ${number}`, createdAt: new Date(2026, 10, day).toISOString(), untrusted });
    const issues = [issue(5, 9), issue(3, 2), issue(8, 1, true), issue(4, 3), issue(6, 10), issue(7, 11), issue(9, 12)];
    const { days, later } = contentCalendar(issues, new Set([6]), now);
    expect(days.map((d) => d.label)).toEqual(['FRI 13', 'MON 16', 'TUE 17', 'WED 18', 'THU 19']);
    expect(days[0].today).toBe(true);
    expect(days[0].items[0]).toEqual({ number: 6, title: 'Issue 6', live: true });
    expect(days.flatMap((d) => d.items).map((i) => i.number)).toEqual([6, 3, 4, 5, 7, 9]); // #8 isn't trusted to build
    expect(days[0].items).toHaveLength(PER_DAY);
    expect(later).toBe(0);
  });

  it('counts what does not fit in the week as later, and shows an empty week for an empty backlog', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ number: i + 1, title: 't', createdAt: new Date(2026, 0, i + 1).toISOString() }));
    const cal = contentCalendar(many, new Set(), new Date(2026, 10, 10));
    expect(cal.days.flatMap((d) => d.items)).toHaveLength(5 * PER_DAY);
    expect(cal.later).toBe(20 - 5 * PER_DAY);
    expect(contentCalendar([], new Set(), new Date(2026, 10, 10)).days.every((d) => d.items.length === 0)).toBe(true);
  });
});

describe('the research lab (#371)', () => {
  it("blinks the racks' LEDs faster with every session running on the floor", () => {
    const idle = ledBlinkHz([person('idle')]);
    const one = ledBlinkHz([person('working')]);
    const three = ledBlinkHz([person('working'), person('preparing'), person('working')]);
    expect(idle).toBeLessThan(one);
    expect(one).toBeLessThan(three);
    expect(ledBlinkHz([person('working', 'ceo')])).toBe(idle);
    expect(ledBlinkHz(Array.from({ length: 20 }, () => person('working')))).toBe(6);
  });

  it('draws the QA pass rate per day as a falling loss, skipping days without rounds', () => {
    const c = lossCurve([null, 0.5, null, 0.75, null, null, 1]);
    expect(c.points).toEqual([
      { day: 1, loss: 0.5 },
      { day: 3, loss: 0.25 },
      { day: 6, loss: 0 },
    ]);
    expect(c.pass).toBe(1);
    expect(lossCurve(Array.from({ length: 7 }, () => null))).toEqual({ points: [], pass: null });
  });
});

describe('the design studio (#371)', () => {
  it("shows each agent's latest screenshot, newest first, none for agents without one", () => {
    const agents = [
      { id: 'a', name: 'Ada' },
      { id: 'b', name: 'Bo' },
      { id: 'c', name: 'Cy' },
    ];
    expect(galleryShots(agents, { a: 100, c: 300 })).toEqual([
      { id: 'c', at: 300, name: 'Cy' },
      { id: 'a', at: 100, name: 'Ada' },
    ]);
    expect(galleryShots(agents, { a: 1, b: 2, c: 3 }, 2).map((s) => s.id)).toEqual(['c', 'b']);
    expect(galleryShots(agents, {})).toEqual([]);
  });
});

describe('the ops control room (#371)', () => {
  const pull = (number: number, state: 'OPEN' | 'MERGED' = 'OPEN', checks: 'passing' | 'failing' | 'pending' | 'none' = 'none') => ({ number, state, checks });

  it('turns the beacon on while any open PR on any floor is needs-human', () => {
    const repos = [
      { id: 'r1', pulls: [pull(1), pull(2)] },
      { id: 'r2', pulls: [pull(7), pull(8, 'MERGED')] },
    ];
    expect(alertBeacon(repos, {})).toBe(false);
    expect(alertBeacon(repos, { 'r1#1': { status: 'failed' }, 'r2#7': { status: 'passed' } })).toBe(false);
    expect(alertBeacon(repos, { 'r2#8': { status: 'needs-human' } })).toBe(false); // merged: not waiting on anyone
    expect(alertBeacon(repos, { 'r2#7': { status: 'needs-human' } })).toBe(true);
  });

  it("gives each floor's tile its preview, checks and needs-human PRs, and colours it by the worst", () => {
    const repo = (status: 'running' | 'error' | 'installing', pulls = [pull(1, 'OPEN', 'passing'), pull(2, 'OPEN', 'pending')]) => ({ id: 'r', floor: 2, fullName: 'o/shop', preview: { status }, pulls });
    expect(nocFloor(repo('running'), {})).toEqual({ floor: 2, name: 'shop', preview: 'running', checks: { passing: 1, failing: 0, pending: 1 }, needsHuman: 0, level: 'ok' });
    expect(nocFloor(repo('installing'), {}).level).toBe('warn');
    expect(nocFloor(repo('running', [pull(1, 'OPEN', 'failing'), pull(3, 'MERGED', 'failing')]), {})).toMatchObject({ checks: { failing: 1 }, level: 'warn' });
    expect(nocFloor(repo('error'), {}).level).toBe('alert');
    expect(nocFloor(repo('running'), { 'r#2': { status: 'needs-human' } })).toMatchObject({ needsHuman: 1, level: 'alert' });
  });

  it("reads the host's memory and tightest disk from the health strip's numbers, nothing before a reading", () => {
    expect(nocSystem(null)).toEqual({ memoryPct: null, diskFreeGb: null, diskLevel: null, running: 0, level: 'ok' });
    const s = nocSystem({ memory: { availableMb: 1024, totalMb: 8192 }, running: 3, disk: { level: 'warn', disks: [{ freeMb: 40 * 1024 }, { freeMb: 12 * 1024 }] } });
    expect(s).toEqual({ memoryPct: 88, diskFreeGb: 12, diskLevel: 'warn', running: 3, level: 'warn' });
    expect(nocSystem({ memory: { availableMb: 300, totalMb: 8192 }, running: 0 }).level).toBe('alert');
    expect(overallLevel(['ok', 'warn'])).toBe('warn');
    expect(overallLevel(['ok', 'alert', 'warn'])).toBe('alert');
    expect(overallLevel([])).toBe('ok');
  });
});
