import { describe, expect, it } from 'vitest';
import { cardActions, cardState, whoPhrase } from './cardActions';

describe('a Kanban PR card’s action row (#232)', () => {
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

  it('shows two buttons per state, the primary first, and puts the rest in the ⋯ with Close last', () => {
    const all = { agent: true, qaReport: true };
    expect(cardActions('testing', all)).toEqual({ visible: ['preview', 'terminal'], menu: ['qa-report', 'history', 'close'] });
    expect(cardActions('fixing', { ...all, status: 'fixing' })).toEqual({ visible: ['terminal', 'preview'], menu: ['qa-report', 'history', 'close'] });
    expect(cardActions('needs-you', { ...all, status: 'needs-human' })).toEqual({
      visible: ['retry-qa', 'preview'],
      menu: ['send-back', 'qa-report', 'history', 'merge-anyway', 'close'],
    });
    expect(cardActions('waiting', { agent: true })).toEqual({ visible: ['preview', 'history'], menu: ['close'] });
    expect(cardActions('waiting', { untested: true })).toEqual({ visible: ['preview', 'history'], menu: ['send-to-qa', 'close'] });
    expect(cardActions('ready', all)).toEqual({ visible: ['merge', 'preview'], menu: ['qa-report', 'history', 'close'] });
    expect(cardActions('untrusted', all)).toEqual({ visible: ['review'], menu: ['close'] });
  });

  it('drops what a card can’t do: no terminal without an agent, send back only once QA failed', () => {
    expect(cardActions('fixing', { status: 'failed' })).toEqual({ visible: ['preview', 'send-back'], menu: ['history', 'close'] });
    expect(cardActions('fixing', { agent: true, status: 'fixing' }).menu).not.toContain('send-back');
  });

  it('never shows more than two buttons, and Close is always in the menu, last', () => {
    for (const s of ['testing', 'fixing', 'needs-you', 'waiting', 'ready', 'untrusted'] as const) {
      const r = cardActions(s, { agent: true, qaReport: true, untested: true, status: 'failed' });
      expect(r.visible.length).toBeLessThanOrEqual(2);
      expect(r.menu.at(-1)).toBe('close');
      expect(r.visible).not.toContain('close');
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
