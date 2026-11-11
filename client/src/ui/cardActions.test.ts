import { describe, expect, it } from 'vitest';
import { cardActions, cardState, whoPhrase } from './cardActions';

describe('a Kanban card’s actions (#232, #410)', () => {
  it('reads the state from the column and QA', () => {
    expect(cardState('qa', 'testing')).toBe('testing');
    expect(cardState('qa', 'fixing')).toBe('fixing');
    expect(cardState('qa', 'failed')).toBe('fixing');
    expect(cardState('qa', 'needs-human')).toBe('needs-you');
    expect(cardState('qa', 'queued')).toBe('waiting');
    expect(cardState('qa', undefined)).toBe('waiting');
    expect(cardState('ready', 'passed')).toBe('ready');
    expect(cardState('qa', 'testing', true)).toBe('untrusted');
  });

  it('gives each state its primary, Open and GitHub always on the bar, Terminal while someone is on it, the rest in the ⋯ with Close last', () => {
    const all = { agent: true, qaReport: true };
    expect(cardActions('testing', all)).toEqual({ primary: null, bar: ['open', 'github', 'terminal'], menu: ['preview', 'qa-report', 'history', 'close'] });
    expect(cardActions('fixing', { ...all, status: 'fixing' })).toEqual({ primary: null, bar: ['open', 'github', 'terminal'], menu: ['preview', 'qa-report', 'history', 'close'] });
    expect(cardActions('needs-you', { ...all, status: 'needs-human' })).toEqual({
      primary: 'retry-qa',
      bar: ['open', 'github', 'terminal'],
      menu: ['send-back', 'preview', 'qa-report', 'history', 'merge-anyway', 'close'],
    });
    expect(cardActions('waiting', { agent: true })).toEqual({ primary: null, bar: ['open', 'github', 'terminal'], menu: ['preview', 'history', 'close'] });
    expect(cardActions('waiting', { untested: true })).toEqual({ primary: 'send-to-qa', bar: ['open', 'github'], menu: ['preview', 'history', 'close'] });
    expect(cardActions('ready', all)).toEqual({ primary: 'merge', bar: ['open', 'github', 'terminal'], menu: ['preview', 'qa-report', 'history', 'close'] });
    expect(cardActions('untrusted', all)).toEqual({ primary: null, bar: ['open', 'github'], menu: ['close'] });
  });

  it('moves Preview onto the bar while its preview runs', () => {
    expect(cardActions('testing', { agent: true, previewing: true })).toEqual({ primary: null, bar: ['open', 'github', 'terminal', 'preview'], menu: ['history', 'close'] });
  });

  it('gives an issue card the bar only, with no ⋯', () => {
    expect(cardActions('issue', { agent: true, previewing: true })).toEqual({ primary: null, bar: ['open', 'github', 'terminal'], menu: [] });
    expect(cardActions('issue')).toEqual({ primary: null, bar: ['open', 'github'], menu: [] });
  });

  it('drops what a card can’t do: send back only once QA failed', () => {
    expect(cardActions('fixing', { status: 'failed' }).menu).toEqual(['send-back', 'preview', 'history', 'close']);
    expect(cardActions('fixing', { agent: true, status: 'fixing' }).menu).not.toContain('send-back');
  });

  it('keeps every PR action reachable, the bar at most four, Close last in the menu', () => {
    for (const s of ['testing', 'fixing', 'needs-you', 'waiting', 'ready', 'untrusted'] as const) {
      const r = cardActions(s, { agent: true, qaReport: true, untested: true, previewing: true, status: 'failed' });
      expect(r.bar.length).toBeLessThanOrEqual(4);
      expect(r.menu.at(-1)).toBe('close');
      expect(new Set([...r.bar, ...r.menu, r.primary]).size).toBe(r.bar.length + r.menu.length + 1);
    }
  });
});

describe('the who row’s phrase', () => {
  it('keeps the short form within 32 characters and the whole of it for the tooltip', () => {
    const p = whoPhrase('Linus', 'QA passed · re-running a failed check (ubuntu-latest)');
    expect(p.short.length).toBeLessThanOrEqual(32);
    expect(p.short.endsWith('…')).toBe(true);
    expect(p.long).toBe('Linus · QA passed · re-running a failed check (ubuntu-latest)');
  });

  it('leaves a short one as it is', () => {
    expect(whoPhrase('Ken', 'testing · round 2')).toEqual({ short: 'Ken · testing · round 2', long: 'Ken · testing · round 2' });
    expect(whoPhrase(undefined, 'draft')).toEqual({ short: 'draft', long: 'draft' });
  });
});
