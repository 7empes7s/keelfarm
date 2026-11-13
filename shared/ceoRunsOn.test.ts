import { describe, expect, it } from 'vitest';
import { ceoCli, ceoModelOn, ceoRunsText, stuckCardNow } from './ceoRunsOn.ts';

const office = { defaultCli: 'claude' as const, defaultModel: '' };

describe('what the CEO runs on (#418)', () => {
  it('runs the picked coding agent in the terminal runtime only, else Claude Code', () => {
    expect(ceoCli('codex', true)).toBe('codex');
    expect(ceoCli('codex', false)).toBe('claude');
    expect(ceoCli('', true)).toBe('claude');
    expect(ceoCli('vim', true)).toBe('claude');
  });

  it("keeps the CEO's Claude default on Claude Code and drops a Claude model on another coding agent", () => {
    expect(ceoModelOn('claude', '', office, 'claude-opus-5-5')).toBe('claude-opus-5-5');
    expect(ceoModelOn('codex', 'claude-opus-5-5', office, 'claude-opus-5-5')).toBe('');
    expect(ceoModelOn('codex', 'gpt-5.5', office, 'claude-opus-5-5')).toBe('gpt-5.5');
  });

  it('says when the switch applies', () => {
    expect(ceoRunsText('Mimoun', 'codex', 'gpt-5.5', false)).toMatch(/^🔀 Mimoun now runs on Codex \(.+\)\.$/);
    expect(ceoRunsText('Mimoun', 'claude', '', true)).toBe('🔀 Mimoun now runs on Claude Code from the next job: the one running now finishes where it started.');
  });
});

describe('the "is stuck" card (#637)', () => {
  const card = { cardAt: 100, lastCeoAt: 50, back: 'claude-ultra', binding: '', runningOn: null, next: 'claude-pro' };
  it('clears once the CEO made progress after it', () => {
    expect(stuckCardNow(card)).toEqual({ over: false, showBack: true });
    expect(stuckCardNow({ ...card, lastCeoAt: 150 })).toEqual({ over: true, showBack: false });
  });

  it('hides "Switch back to Claude Ultra" when the chat is already on Ultra', () => {
    expect(stuckCardNow({ ...card, runningOn: 'claude-ultra' }).showBack).toBe(false); // its live session
    expect(stuckCardNow({ ...card, next: 'claude-ultra' }).showBack).toBe(false); // where its next turn starts
    expect(stuckCardNow({ ...card, binding: 'claude-ultra' }).showBack).toBe(false); // pinned there
    expect(stuckCardNow({ ...card, back: null }).showBack).toBe(false);
    expect(stuckCardNow({ ...card, back: '', binding: 'claude-pro' }).showBack).toBe(true); // back to the office default
  });
});
