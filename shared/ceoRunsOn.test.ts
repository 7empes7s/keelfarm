import { describe, expect, it } from 'vitest';
import { ceoCli, ceoModelOn, ceoRunsText } from './ceoRunsOn.ts';

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
