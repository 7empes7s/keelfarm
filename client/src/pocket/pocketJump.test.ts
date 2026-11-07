import { describe, expect, it } from 'vitest';
import { markTeamLanding, pocketJump, takeTeamLanding } from './pocketJump';

describe('pocketJump', () => {
  it('opens a floor team in the Team tab and drops the saved back panel', () => {
    expect(pocketJump({ tab: 'team', repoId: 'r1' }, true)).toEqual({ to: 'team', repoId: 'r1', backToChat: true, clearBack: true });
    expect(pocketJump({ tab: 'team', repoId: 'r1' }, false)).toMatchObject({ backToChat: false });
  });

  it('keeps the saved back panel for every other console jump', () => {
    for (const want of [{ tab: 'charter', repoId: 'r1' }, { tab: 'ceo', repoId: 'r1' }, { tab: 'team' }, {}]) {
      expect(pocketJump(want, true)).toEqual({ to: 'console', clearBack: false });
    }
  });
});

describe('team landing', () => {
  it('scrolls and lights up once per link, not on later visits', () => {
    expect(takeTeamLanding()).toBe(false);
    markTeamLanding();
    expect(takeTeamLanding()).toBe(true);
    expect(takeTeamLanding()).toBe(false);
  });
});
