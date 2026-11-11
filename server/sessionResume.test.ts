import { describe, expect, it } from 'vitest';
import { canResume, heldElsewhere, lostSession } from './sessionResume.ts';

describe('canResume (#401)', () => {
  const shares = (id: string) => id !== 'claude-solo';

  it("never passes a Codex session to Claude Code, or Claude Code's to Codex", () => {
    expect(canResume({ cli: 'codex', account: 'codex-login' }, { cli: 'claude', account: 'codex-login' }, shares)).toBe(false);
    expect(canResume({ cli: 'claude' }, { cli: 'codex' }, shares)).toBe(false);
    expect(canResume({ cli: null }, { cli: 'claude' }, shares)).toBe(false);
  });

  it("never resumes account A's session on account B, except Claude logins that share their conversations (#377)", () => {
    expect(canResume({ cli: 'codex', account: 'codex-a' }, { cli: 'codex', account: 'codex-b' }, () => true)).toBe(false);
    expect(canResume({ cli: 'claude', account: 'claude-a' }, { cli: 'claude', account: 'claude-solo' }, shares)).toBe(false);
    expect(canResume({ cli: 'claude', account: 'claude-a' }, { cli: 'claude', account: 'claude-b' }, shares)).toBe(true);
  });

  it('resumes on the same CLI and account, or where the account is not known', () => {
    expect(canResume({ cli: 'codex', account: 'codex-a' }, { cli: 'codex', account: 'codex-a' }, () => false)).toBe(true);
    expect(canResume({ cli: 'codex' }, { cli: 'codex', account: 'codex-a' }, () => false)).toBe(true);
    expect(canResume({ cli: 'codex', account: 'codex-a' }, { cli: 'codex' }, () => false)).toBe(true);
  });
});

describe('lostSession', () => {
  it("spots Claude Code's and Codex's messages for a resume with nothing to resume", () => {
    expect(lostSession('claude', '\n No conversation found with session ID: 6cc74c7e-0c81-4bff-a140-cc8307c1d11b\n')).toBe(true);
    expect(lostSession('codex', 'ERROR: No saved session found with ID 0f6b3793-1d2e. Run codex resume without an ID to choose from existing sessions.')).toBe(true);
  });

  it('ignores other screens', () => {
    expect(lostSession('claude', 'Claude Code v2.1.280\n❯ ')).toBe(false);
    expect(lostSession('opencode', 'No saved session found')).toBe(false);
  });
});

describe('heldElsewhere', () => {
  const agent = (id: string, o: Partial<Parameters<typeof heldElsewhere>[1][number]> = {}) => ({ id, name: id, repoId: 'r1', task: 'fix' as const, issueNumber: 7, prNumber: 394, busy: true, ...o });

  it('finds another busy agent fixing the same PR, or on the same issue', () => {
    expect(heldElsewhere(agent('radia'), [agent('radia'), agent('alan')])?.id).toBe('alan');
    expect(heldElsewhere(agent('radia', { task: 'issue' }), [agent('alan', { task: 'issue', prNumber: null })])?.id).toBe('alan');
  });

  it('ignores idle agents, other PRs, other floors, QA on a PR being fixed, and the CEO', () => {
    const me = agent('radia');
    expect(heldElsewhere(me, [agent('alan', { busy: false }), agent('bo', { prNumber: 270 }), agent('cy', { repoId: 'r2' }), agent('di', { task: 'qa' })])).toBeNull();
    expect(heldElsewhere({ ...me, repoId: '', task: null }, [agent('alan')])).toBeNull();
  });
});
