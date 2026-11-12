import { describe, expect, it } from 'vitest';
import { runLabel, runPinNote, runsByAccount, runText, sameRun, sessionRun } from './sessionRun';

const accounts = [
  { id: 'claude-ultra', label: 'Claude Ultra', tags: ['ultra'], status: 'limited' as const },
  { id: 'claude-pro2', label: 'Pro secondary', tags: ['pro', 'backup'], status: 'ready' as const },
];
const s = { cli: 'claude' as const, model: 'claude-opus-5-5', effort: 'high' as const, at: 1 };

describe('sessionRun', () => {
  it('reports the account the session really started on when rotation moved it off its pin', () => {
    const r = sessionRun('claude-ultra', 'claude-pro2', accounts, s);
    expect(r).toMatchObject({ account: 'claude-pro2', label: 'Pro secondary', pinned: 'Claude Ultra', why: 'limited' });
    expect(runLabel(r)).toBe('Pro secondary · Opus 5.5');
    expect(runPinNote(r)).toBe('because Claude Ultra is limited');
    expect(runText(r)).toBe('Pro secondary · Opus 5.5 high effort (because Claude Ultra is limited)');
  });

  it('a later session on the same account and model is the same chip; a switch is not', () => {
    const r = sessionRun(undefined, 'claude-pro2', accounts, s);
    expect(sameRun(r, { ...r, at: 99 })).toBe(true);
    expect(sameRun(r, sessionRun(undefined, 'claude-ultra', accounts, s))).toBe(false);
    expect(sameRun(r, { ...r, model: 'claude-sonnet-5' })).toBe(false);
  });

  it('says nothing about a pin it is on: by id, by tag, or the rotation', () => {
    for (const pin of ['claude-pro2', 'backup', 'rotation', undefined]) expect(sessionRun(pin, 'claude-pro2', accounts, s).pinned).toBeUndefined();
  });

  it('names a tag pin no account of which it is on', () => {
    expect(sessionRun('ultra', 'claude-pro2', accounts, s)).toMatchObject({ pinned: 'ultra' });
    expect(sessionRun('ultra', 'claude-pro2', accounts, s).why).toBeUndefined();
    expect(runPinNote(sessionRun('ultra', 'claude-pro2', accounts, s))).toBe('pinned: ultra');
  });

  it('a session on no account of the registry says what it runs on instead, and the coding agent for its default model', () => {
    expect(runLabel(sessionRun(undefined, null, accounts, { ...s, cli: 'codex', model: '', instead: 'Cloud' }))).toBe('Cloud · Codex');
    expect(sessionRun(undefined, null, accounts, { ...s, cli: 'opencode' }).label).toBe("OpenCode's own login");
  });
});

describe('runsByAccount', () => {
  const now = 100 * 60 * 60_000;
  const run = (account: string, label: string, extra = {}) => ({ ...s, account, label, at: now - 60_000, ...extra });
  const usage = [{ pct: 40, resetsAt: now + 1 }, { pct: 90, resetsAt: now - 1 }]; // the 90% reset already

  it('groups live sessions by the account they really run on, idle agents by their pin, and recent CEO threads', () => {
    const groups = runsByAccount(
      [
        { id: 'ceo', name: 'Mimoun', account: 'claude-ultra', run: run('claude-pro2', 'Pro secondary', { pinned: 'Claude Ultra', why: 'limited' }) },
        { id: 'ada', name: 'Ada', account: 'ultra' },
        { id: 'bo', name: 'Bo' }, // idle on the rotation: nothing to show
        { id: 'cy', name: 'Cy', run: run('', 'Cloud agent') },
      ],
      [
        { id: 't1', title: 'Hiring', run: run('claude-pro2', 'Pro secondary') },
        { id: 't2', title: 'Old', run: { ...run('claude-ultra', 'Claude Ultra'), at: now - 2 * 24 * 60 * 60_000 } },
      ],
      [{ ...accounts[0], usage }, accounts[1]],
      now,
    );
    expect(groups.map((g) => [g.label, g.pct, g.rows.map((r) => `${r.name}:${r.state}`)])).toEqual([
      ['Claude Ultra', 40, ['Ada:pinned']],
      ['Pro secondary', null, ['Mimoun:live', 'Hiring:thread']],
      ['Cloud agent', null, ['Cy:live']],
    ]);
    expect(groups[1].rows[0].open).toEqual({ agentId: 'ceo' });
    expect(groups[1].rows[1].open).toEqual({ threadId: 't1' });
  });
});
