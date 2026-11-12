import { describe, expect, it } from 'vitest';
import { jumpFor } from './chatRefs';
import { ceoTermNote, isCeoTerminal } from './ceoTermRules';

describe("the CEO's terminal (#596)", () => {
  const world = { repos: [], agents: { ceo: { id: 'ceo', name: 'Mimoun', repoId: '' } }, qa: {} } as never;

  it("the stuck card's Open terminal opens it in both offices; @CEO still opens the chat", () => {
    for (const mode of ['office', 'pocket'] as const) {
      const j = jumpFor({ kind: 'agent', agentId: 'ceo', terminal: true, start: 0, end: 0 }, mode, world);
      expect(j?.kind === 'overlay' && isCeoTerminal(j.overlay), mode).toBe(true);
      const chat = jumpFor({ kind: 'agent', agentId: 'ceo', start: 0, end: 0 }, mode, world);
      expect(chat?.kind === 'overlay' && isCeoTerminal(chat.overlay), mode).toBe(false);
    }
    expect(isCeoTerminal({ kind: 'terminal', agentId: 'a1', view: 'terminal' })).toBe(false);
  });

  it('says plainly when the CLI has closed, or runs without a terminal', () => {
    expect(ceoTermNote('Mimoun', true, true)).toBeNull();
    expect(ceoTermNote('Mimoun', true, null)).toBeNull();
    expect(ceoTermNote('Mimoun', true, false)).toBe("Mimoun's terminal has closed: this is the last screen of their session.");
    expect(ceoTermNote('Mimoun', false, null)).toBe("Mimoun runs without a terminal: this is their session's log.");
  });
});
