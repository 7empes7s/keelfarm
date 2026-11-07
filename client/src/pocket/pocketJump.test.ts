import { describe, expect, it } from 'vitest';
import { markTeamLanding, pocketJump, takeTeamLanding } from './pocketJump';

const phone = { kind: 'phone' };

describe('pocketJump', () => {
  it('opens a floor team in the Team tab, replacing the chat', () => {
    expect(pocketJump({ tab: 'team', repoId: 'r1' }, true, phone)).toEqual({ to: 'team', repoId: 'r1', backToChat: true, clearBack: true });
    expect(pocketJump({ tab: 'team', repoId: 'r1' }, false, null)).toMatchObject({ backToChat: false });
  });

  it('drops the saved chat for a console jump too, so closing the link does not go back to the Chat tab', () => {
    for (const want of [{ tab: 'charter', repoId: 'r1' }, { tab: 'ceo', repoId: 'r1' }, { tab: 'team' }, {}]) {
      expect(pocketJump(want, true, phone)).toEqual({ to: 'console', clearBack: true });
    }
  });

  it('keeps a saved panel the jump does not replace', () => {
    expect(pocketJump({ tab: 'charter', repoId: 'r1' }, false, null).clearBack).toBe(false);
    expect(pocketJump({ tab: 'charter', repoId: 'r1' }, false, { kind: 'terminal' }).clearBack).toBe(false);
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
