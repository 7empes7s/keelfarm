import { describe, expect, it } from 'vitest';
import { chatUnavailable, initialChatMode, paneFor, prChip } from './chatMode';

const settings = { runtime: 'terminal' as const, defaultCli: 'claude' as const };
const agent = { cli: '' as const, role: 'agent' as const };

describe('chat mode (#120)', () => {
  it('starts on chat on a phone, else as the device chose', () => {
    expect(initialChatMode(null, true)).toBe(true);
    expect(initialChatMode(null, false)).toBe(false);
    expect(initialChatMode('off', true)).toBe(false);
    expect(initialChatMode('on', false)).toBe(true);
  });

  it('falls back to the terminal, with a note, for coding agents without a transcript', () => {
    expect(chatUnavailable(agent, settings)).toBeNull();
    expect(chatUnavailable({ ...agent, cli: 'codex' }, settings)).toMatch(/Codex doesn't write one/);
    expect(chatUnavailable(agent, { ...settings, defaultCli: 'opencode' })).toMatch(/OpenCode/);
    expect(chatUnavailable({ ...agent, host: 'box' }, settings)).toMatch(/cloud/);
    expect(chatUnavailable({ ...agent, cli: 'codex' }, { ...settings, runtime: 'sdk' as const })).toBeNull(); // the SDK runtime is Claude Code
  });

  it('routes a window: what it was opened on, else chat mode, never a chat that cannot be shown', () => {
    expect(paneFor(undefined, true, null)).toBe('chat');
    expect(paneFor(undefined, false, null)).toBe('terminal');
    expect(paneFor('chat', false, null)).toBe('chat');
    expect(paneFor('chat', true, 'no transcript')).toBe('terminal');
  });
});

describe('the PR chip', () => {
  it("shows QA's live status, then the verdict, then the merge", () => {
    expect(prChip(undefined, false)).toMatchObject({ label: 'Opened', verdict: false });
    expect(prChip({ status: 'testing', round: 1 }, false)).toMatchObject({ label: 'QA testing · round 1', verdict: false });
    expect(prChip({ status: 'failed', round: 2 }, false)).toMatchObject({ label: 'QA failed · round 2', tone: 'bad', verdict: true });
    expect(prChip({ status: 'passed', round: 2 }, true)).toMatchObject({ label: 'Merged', tone: 'good' });
  });
});
