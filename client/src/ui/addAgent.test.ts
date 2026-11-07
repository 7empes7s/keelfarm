import { describe, expect, it } from 'vitest';
import { hirePayload, NO_SETUP, teamFill, teamStats } from './addAgent';

describe('hirePayload', () => {
  it("leaves '' for the office's defaults and drops an empty name", () => {
    expect(hirePayload(NO_SETUP)).toEqual({ cli: '', model: '', effort: '', name: undefined });
    expect(hirePayload({ ...NO_SETUP, name: '   ' }).name).toBeUndefined();
  });

  it('sends the picked setup with the name trimmed', () => {
    expect(hirePayload({ name: '  Ada ', cli: 'codex', model: 'gpt-5', effort: 'high' })).toEqual({ name: 'Ada', cli: 'codex', model: 'gpt-5', effort: 'high' });
  });
});

describe('teamFill', () => {
  it('says how full the floor is and turns Add off at its most', () => {
    expect(teamFill(3, 6, 10)).toEqual({ label: 'Floor 3', value: '6 of 10 agents', pct: 0.6, full: false });
    expect(teamFill(3, 10, 10).full).toBe(true);
    expect(teamFill(3, 11, 10).full).toBe(true);
  });
});

describe('teamStats', () => {
  it('counts busy (setting up or working) and free', () => {
    expect(teamStats([{ status: 'working' }, { status: 'preparing' }, { status: 'idle' }, { status: 'error' }])).toBe('4 agents · 2 busy · 2 free');
    expect(teamStats([{ status: 'idle' }])).toBe('1 agent · 0 busy · 1 free');
    expect(teamStats([])).toBe('0 agents');
  });
});
