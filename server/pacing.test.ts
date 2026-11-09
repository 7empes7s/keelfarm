import { describe, expect, it } from 'vitest';
import { keptWaiver } from '../shared/usage.ts';
import { clampPacingSessions, clock, fullSpeedByChoice, mayStart, pacingMessage, resumeRefusal, usageLabel, usageView, waived, warningOutcome, warningView, type WorkKind } from './pacing.ts';

const NOW = new Date(2026, 8, 28, 12, 0).getTime();
const HOUR = 60 * 60_000;
const at = (over: Partial<Parameters<typeof mayStart>[1]> = {}) => ({ now: NOW, pausedUntil: 0, pacingUntil: 0, running: 0, pacingSessions: 3, ...over });
const KINDS: WorkKind[] = ['issue', 'qa', 'fix', 'ceo'];

describe('mayStart', () => {
  it('starts everything when usage is normal, however much is running', () => {
    for (const kind of KINDS) expect(mayStart(kind, at({ running: 20 }))).toBe(true);
  });

  it('starts new issues while pacing only under the cap', () => {
    expect(mayStart('issue', at({ pacingUntil: NOW + HOUR, running: 2 }))).toBe(true);
    expect(mayStart('issue', at({ pacingUntil: NOW + HOUR, running: 3 }))).toBe(false);
    expect(mayStart('issue', at({ pacingUntil: NOW + HOUR, running: 9, pacingSessions: 10 }))).toBe(true);
  });

  it('keeps starting QA, fixes and CEO jobs while pacing', () => {
    for (const kind of ['qa', 'fix', 'ceo'] as const) expect(mayStart(kind, at({ pacingUntil: NOW + HOUR, running: 12 }))).toBe(true);
  });

  it('starts nothing at all once Claude rejects a session, pacing or not', () => {
    for (const kind of KINDS) {
      expect(mayStart(kind, at({ pausedUntil: NOW + HOUR }))).toBe(false);
      expect(mayStart(kind, at({ pausedUntil: NOW + HOUR, pacingUntil: NOW + 2 * HOUR }))).toBe(false);
    }
  });

  it('stops pacing when it expires', () => {
    expect(mayStart('issue', at({ pacingUntil: NOW, running: 10 }))).toBe(true);
    expect(mayStart('issue', at({ pacingUntil: NOW - 1, pausedUntil: NOW - 1, running: 10 }))).toBe(true);
  });
});

describe('usageView and usageLabel', () => {
  it('is normal, pacing or paused, with the pause first', () => {
    expect(usageView({ now: NOW, pausedUntil: 0, pacingUntil: 0 })).toEqual({ state: 'normal', until: null, warning: null });
    expect(usageView({ now: NOW, pausedUntil: 0, pacingUntil: NOW + HOUR })).toEqual({ state: 'pacing', until: NOW + HOUR, warning: null });
    expect(usageView({ now: NOW, pausedUntil: NOW + HOUR, pacingUntil: NOW + 2 * HOUR })).toEqual({ state: 'paused', until: NOW + HOUR, warning: null });
    expect(usageView({ now: NOW, pausedUntil: NOW, pacingUntil: NOW })).toEqual({ state: 'normal', until: null, warning: null });
  });

  it("carries the last warning's limit, fill and reset for the usage meter", () => {
    const warning = warningView({ resetsAt: NOW + HOUR, rateLimitType: 'seven_day', utilization: 0.91 }, NOW);
    expect(warning).toEqual({ limit: 'weekly limit', pct: 91, resetsAt: NOW + HOUR, at: NOW });
    expect(usageView({ now: NOW, pausedUntil: 0, pacingUntil: NOW + HOUR }, warning)).toEqual({ state: 'pacing', until: NOW + HOUR, warning });
    expect(warningView({ resetsAt: null, rateLimitType: null, utilization: null }, NOW)).toEqual({ limit: null, pct: null, resetsAt: null, at: NOW });
  });

  it('reads as the CEO sees it in company_status', () => {
    expect(usageLabel({ state: 'normal', until: null }, NOW)).toBe('normal');
    expect(usageLabel({ state: 'pacing', until: NOW + 150 * 60_000 }, NOW)).toBe('pacing until 14:30');
    expect(usageLabel({ state: 'paused', until: NOW + 5 * 60_000 }, NOW)).toBe('paused until 12:05');
  });

  it('names the day when the window resets on another day', () => {
    expect(clock(NOW + 3 * 24 * HOUR, NOW)).toMatch(/^[A-Z][a-z]{2} 12:00$/);
  });
});

describe('pacingMessage', () => {
  it('says which limit, how full, until when and how many sessions', () => {
    expect(pacingMessage({ resetsAt: null, rateLimitType: 'five_hour', utilization: 0.82 }, NOW + 150 * 60_000, 3, NOW)).toBe(
      "🐢 Claude's usage is getting high (5-hour limit, 82%). Until 14:30 the office finishes open work first and starts at most 3 sessions at a time.",
    );
  });

  it('copes with a percentage and with missing details', () => {
    expect(pacingMessage({ resetsAt: null, rateLimitType: 'seven_day', utilization: 91 }, NOW + HOUR, 1, NOW)).toContain('(weekly limit, 91%)');
    expect(pacingMessage({ resetsAt: null, rateLimitType: 'seven_day', utilization: 91 }, NOW + HOUR, 1, NOW)).toContain('at most 1 session at a time');
    expect(pacingMessage({ resetsAt: null, rateLimitType: null, utilization: null }, NOW + HOUR, 3, NOW)).toMatch(/^🐢 Claude's usage is getting high\. Until 13:00/);
  });
});

it('clamps the pacing cap to 1-32, default 3', () => {
  expect(clampPacingSessions(5)).toBe(5);
  expect(clampPacingSessions('7')).toBe(7);
  expect(clampPacingSessions(100)).toBe(32);
  expect(clampPacingSessions(0)).toBe(3);
  expect(clampPacingSessions(-4)).toBe(3);
  expect(clampPacingSessions('lots')).toBe(3);
  expect(clampPacingSessions(2.6)).toBe(3);
});

describe('resume full speed', () => {
  it('clears pacing, but never a hard pause and never when there is nothing to clear', () => {
    expect(resumeRefusal({ now: NOW, pausedUntil: 0, pacingUntil: NOW + HOUR })).toBeNull();
    expect(resumeRefusal({ now: NOW, pausedUntil: NOW + 5 * 60_000, pacingUntil: NOW + HOUR })).toBe(
      "Claude turned a session away at the usage limit, so nothing new starts until 12:05. That pause can't be lifted early.",
    );
    expect(resumeRefusal({ now: NOW, pausedUntil: 0, pacingUntil: 0 })).toBe('The office is already running at full speed.');
    expect(resumeRefusal({ now: NOW, pausedUntil: NOW - 1, pacingUntil: NOW })).toBe('The office is already running at full speed.');
  });

  it("ignores later warnings about the window the manager waived, but not another limit's or a new window's", () => {
    const waiver = { until: NOW + 2 * HOUR, limit: 'five_hour' };
    const warn = (rateLimitType: string | null, resetsAt: number | null) => ({ rateLimitType, resetsAt, utilization: 0.85 });
    expect(waived(warn('five_hour', NOW + 2 * HOUR), waiver, NOW)).toBe(true);
    expect(waived(warn('five_hour', NOW + 2 * HOUR + 30_000), waiver, NOW)).toBe(true); // the same reset, reported a little differently
    expect(waived(warn('five_hour', null), waiver, NOW)).toBe(true);
    expect(waived(warn(null, NOW + HOUR), waiver, NOW)).toBe(true);
    expect(waived(warn('seven_day', NOW + 30 * HOUR), waiver, NOW)).toBe(false);
    expect(waived(warn('five_hour', NOW + 7 * HOUR), waiver, NOW)).toBe(false); // the usage was reset: a new window
    expect(waived(warn('five_hour', NOW + 2 * HOUR), waiver, NOW + 2 * HOUR)).toBe(false); // the waived window is over
    expect(waived(warn('five_hour', NOW + 2 * HOUR), null, NOW)).toBe(false);
  });
});

describe('remembered choices (#323)', () => {
  const warn = (resetsAt: number | null, rateLimitType: string | null = 'five_hour') => ({ rateLimitType, resetsAt, utilization: 0.85 });
  const calm = { now: NOW, pacingUntil: 0, waiver: null };

  it('a waiver restored after a restart keeps full speed in the same window and paces in a new one', () => {
    const saved = JSON.parse(JSON.stringify({ until: NOW + 2 * HOUR, limit: 'five_hour' })) as unknown; // through state.json
    const waiver = keptWaiver(saved, 'pace', NOW + HOUR);
    expect(waiver).toEqual({ until: NOW + 2 * HOUR, limit: 'five_hour' });
    const after = { now: NOW + HOUR, pacingUntil: 0, waiver, choice: 'pace' as const };
    expect(warningOutcome(warn(NOW + 2 * HOUR), after)).toBeNull();
    expect(warningOutcome(warn(NOW + 7 * HOUR), after)).toEqual({ until: NOW + 7 * HOUR, fresh: true }); // the usage was reset
    expect(warningOutcome(warn(NOW + 30 * HOUR, 'seven_day'), after)).toEqual({ until: NOW + 30 * HOUR, fresh: true }); // another limit
  });

  it('drops a saved waiver whose window is over, or one that is not a waiver', () => {
    expect(keptWaiver({ until: NOW, limit: 'five_hour' }, 'pace', NOW)).toBeNull();
    expect(keptWaiver({ until: NOW + HOUR }, undefined, NOW)).toEqual({ until: NOW + HOUR, limit: null });
    for (const raw of [null, undefined, 'x', { until: 'soon' }, {}]) expect(keptWaiver(raw, 'pace', NOW)).toBeNull();
  });

  it('"Keep full speed" never paces, while the warning still shows as full speed by choice', () => {
    expect(warningOutcome(warn(NOW + HOUR), { ...calm, choice: 'full' })).toBeNull();
    expect(warningOutcome(warn(null, null), { ...calm, choice: 'full' })).toBeNull();
    const warning = warningView(warn(NOW + HOUR), NOW);
    expect(fullSpeedByChoice('full', null, warning, NOW)).toBe(true);
    expect(fullSpeedByChoice('full', null, warning, NOW + HOUR)).toBe(false); // that window reset
    expect(fullSpeedByChoice('full', null, null, NOW)).toBe(false); // no warning: just normal
    expect(fullSpeedByChoice('pace', null, warning, NOW)).toBe(false);
    expect(fullSpeedByChoice('pace', { until: NOW + HOUR, limit: null }, warning, NOW)).toBe(true); // Resume full speed
    expect(usageView({ now: NOW, pausedUntil: 0, pacingUntil: 0 }, warning, true)).toEqual({ state: 'normal', until: null, warning, byChoice: true });
    expect(usageLabel(usageView({ now: NOW, pausedUntil: 0, pacingUntil: 0 }, warning, true), NOW)).toBe('normal (full speed by choice)');
  });

  it('a limit still pauses everything under "Keep full speed"', () => {
    const u = usageView({ now: NOW, pausedUntil: NOW + HOUR, pacingUntil: 0 }, null, true);
    expect(u).toEqual({ state: 'paused', until: NOW + HOUR, warning: null });
    for (const kind of KINDS) expect(mayStart(kind, at({ pausedUntil: NOW + HOUR }))).toBe(false);
  });

  it('"Ask me each time" and "Pace new work" pace as before, and "Ask me each time" forgets the waiver on a restart', () => {
    for (const choice of ['pace', 'ask'] as const) {
      expect(warningOutcome(warn(NOW + HOUR), { ...calm, choice })).toEqual({ until: NOW + HOUR, fresh: true });
      expect(warningOutcome(warn(null), { ...calm, choice })).toEqual({ until: NOW + HOUR, fresh: true }); // no reset given: PACING_MS
      expect(warningOutcome(warn(NOW + 2 * HOUR), { ...calm, pacingUntil: NOW + HOUR, choice })).toEqual({ until: NOW + 2 * HOUR, fresh: false });
      expect(warningOutcome(warn(NOW + HOUR), { ...calm, pacingUntil: NOW + HOUR, choice })).toBeNull(); // already pacing that long
      expect(warningOutcome(warn(NOW + HOUR), { ...calm, waiver: { until: NOW + HOUR, limit: 'five_hour' }, choice })).toBeNull(); // resumed, same run
    }
    expect(keptWaiver({ until: NOW + HOUR, limit: 'five_hour' }, 'ask', NOW)).toBeNull();
  });
});
