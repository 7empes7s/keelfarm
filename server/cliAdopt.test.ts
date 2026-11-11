import { describe, expect, it } from 'vitest';
import { adoptsCli } from './cliAdopt.ts';

describe('adoptsCli', () => {
  const prev = { cli: 'claude' as const, resumeId: 'conv-1', account: 'pro', boxId: null };
  const next = { cli: 'claude' as const, resumeSessionId: 'conv-1', account: 'pro', boxId: null };
  it('picks up the waiting CLI for a follow-up to its conversation on the same account', () => expect(adoptsCli(prev, next)).toBe(true));
  it('starts its own CLI on another account (#390: a new default moves a kept session at its next one)', () => expect(adoptsCli(prev, { ...next, account: 'ultra' })).toBe(false));
  it('a CLI from before accounts were remembered counts as the same', () => expect(adoptsCli({ ...prev, account: undefined }, { ...next, account: 'ultra' })).toBe(true));
  it('never across conversations, coding agents or hosts; always when it kept working through a restart', () => {
    expect(adoptsCli(prev, { ...next, resumeSessionId: 'conv-2' })).toBe(false);
    expect(adoptsCli(prev, { ...next, cli: 'codex' })).toBe(false);
    expect(adoptsCli(prev, { ...next, boxId: 'box-1' })).toBe(false);
    expect(adoptsCli(prev, { ...next, account: 'ultra', resumeSessionId: undefined, reattach: true })).toBe(true);
  });
});
