import { describe, expect, it } from 'vitest';
import { ALARM_AFTER_MS, bumpIssue, isBumpTitle, latestLabel, loadSdkState, needsNewerClaude, releaseOf, sdkAlarm, sdkStep } from './agentSdk.ts';

const old = { version: '0.3.283', claudeCode: '2.1.283' };
const latest = { version: '0.3.330', claudeCode: '2.1.330' };
const base = { installed: old, latest, inFlight: false, canBump: true, behindSince: null, now: 1_000_000_000_000 };

describe('the agents built-in Claude (#569)', () => {
  it('behind: one bump; up to date or in flight: none', () => {
    expect(sdkStep(base)).toEqual({ behindSince: base.now, bump: true });
    expect(sdkStep({ ...base, installed: latest })).toEqual({ behindSince: null, bump: false });
    expect(sdkStep({ ...base, inFlight: true, behindSince: 5 })).toEqual({ behindSince: 5, bump: false });
    expect(sdkStep({ ...base, canBump: false })).toMatchObject({ bump: false });
    expect(sdkStep({ ...base, latest: null })).toEqual({ behindSince: null, bump: false });
  });

  it('raises the alarm after a week behind with nothing in flight', () => {
    const week = { ...base, behindSince: base.now - ALARM_AFTER_MS - 86_400_000 };
    expect(sdkAlarm(week)).toBe("The agents' built-in Claude is 8 days behind Claude Code 2.1.330. New models may not run until it's updated.");
    expect(sdkAlarm({ ...week, canBump: false })).toContain("can't file its own update");
    expect(sdkAlarm({ ...week, inFlight: true })).toBeNull();
    expect(sdkAlarm({ ...base, behindSince: base.now - 6 * 86_400_000 })).toBeNull();
    expect(sdkAlarm({ ...week, installed: latest })).toBeNull();
  });

  it('reads the registry and files a bump the floor can build', () => {
    expect(releaseOf({ version: '0.3.330', claudeCodeVersion: '2.1.330' })).toEqual(latest);
    expect(() => releaseOf({ error: 'not found' })).toThrow('without a version');
    const b = bumpIssue(old, latest, 'Fable 5.2 needs a newer one.');
    expect(b.title).toBe('Bump the Agent SDK to 0.3.330 (Claude Code 2.1.330)');
    expect(isBumpTitle(b.title)).toBe(true);
    expect(b.body).toContain('npm install @anthropic-ai/claude-agent-sdk@^0.3.330');
    expect(b.body).toContain('Never hand-edit the lock');
    expect(b.body).toContain('Fable 5.2 needs a newer one.');
  });

  it("knows the session error a model too new for it gives", () => {
    expect(needsNewerClaude(['API Error: 400 Claude Code 2.1.283 does not support this model; version 2.1.290 or newer is required.'])).toBe(true);
    expect(needsNewerClaude(["Claude Code 2.1.283 can't run this model: it needs 2.1.290 or newer. Update the office, or pick another model"])).toBe(true);
    expect(needsNewerClaude(['prompt is too long'])).toBe(false);
  });

  it('labels the check and loads a saved state safely', () => {
    const clock = () => '09:14';
    expect(latestLabel({ latest, checkedAt: 1, error: null }, clock)).toBe('latest 2.1.330, checked 09:14');
    expect(latestLabel({ latest, checkedAt: 1, error: 'the npm registry answered 503' }, clock)).toBe("Couldn't check for a newer one (the npm registry answered 503), checked 09:14");
    expect(latestLabel({ latest: null, checkedAt: null, error: null }, clock)).toBeNull();
    expect(loadSdkState('junk')).toEqual({ checkedAt: null, latest: null, error: null, behindSince: null, bump: null, told: [] });
    expect(loadSdkState({ checkedAt: 5, latest, bump: { issue: 7, version: '0.3.330', at: 6 }, told: ['x', 3] })).toMatchObject({ checkedAt: 5, latest, bump: { issue: 7 }, told: ['x'] });
  });
});
