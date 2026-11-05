import { describe, expect, it } from 'vitest';
import { selectableWindow, slidOff } from './touchRules';
import { focusAgent, holdOptions } from '../world/touch/holdOptions';

describe('selectableWindow', () => {
  it('gives selection back in panels with text, not over the bare 3D view', () => {
    expect(selectableWindow(null)).toBe(false);
    expect(selectableWindow({ kind: 'terminal', agentId: 'a' })).toBe(true);
    expect(selectableWindow({ kind: 'kanban', repoId: 'r' })).toBe(true);
    expect(selectableWindow({ kind: 'app', repoId: 'r' })).toBe(true);
    expect(selectableWindow({ kind: 'manager' })).toBe(true);
    expect(selectableWindow({ kind: 'phone' })).toBe(true);
    expect(selectableWindow({ kind: 'elevator' })).toBe(false);
  });
});

describe('slidOff', () => {
  const box = { left: 10, top: 10, right: 58, bottom: 58 };
  it('keeps a tap that lifts on the button or just beside it', () => {
    expect(slidOff(box, 30, 30)).toBe(false);
    expect(slidOff(box, 64, 30)).toBe(false);
  });
  it('drops a tap that slid away', () => {
    expect(slidOff(box, 80, 30)).toBe(true);
    expect(slidOff(box, 30, -5)).toBe(true);
  });
});

describe('holdOptions', () => {
  it('offers an agent their terminal, following and a hello', () => {
    const f = { id: 'agent-a', label: 'Watch Ada', action: { kind: 'terminal' as const, agentId: 'a' } };
    expect(holdOptions(f).map((o) => o.id)).toEqual(['use', 'follow', 'greet']);
    expect(focusAgent(f)).toBe('a');
  });
  it('offers a sticky reading, and carrying only when it can come off', () => {
    const card = { kind: 'card' as const, repoId: 'r', key: 'k', number: 1, pr: false };
    expect(holdOptions({ id: 'c', label: 'Read', action: card }).map((o) => o.id)).toEqual(['use']);
    expect(holdOptions({ id: 'c', label: 'Read', action: { ...card, peel: true } }).map((o) => o.id)).toEqual(['use', 'carry']);
  });
  it('offers anything else its own action', () => {
    expect(holdOptions({ id: 'j', label: 'Next song', action: { kind: 'jukebox', op: 'next' } })).toEqual([{ id: 'use', label: 'Next song' }]);
    expect(focusAgent({ id: 'j', label: 'x', action: { kind: 'jukebox', op: 'next' } })).toBeNull();
  });
});
