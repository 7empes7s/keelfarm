import { describe, expect, it, vi } from 'vitest';
import type { Agent, State } from '../store';

vi.mock('./sfx', () => ({ alarm: vi.fn(), audioUnlocked: () => false, chirp: vi.fn(), cue: vi.fn() }));
const { ownTools } = await import('./ToolsSettings');

const state = { agents: { a1: { id: 'a1', role: 'worker' } }, settings: { tools: { ceo: { x: false } } } } as unknown as State;

describe('the Setup tab’s Tools & skills (#351)', () => {
  it('reads the same switches twice for an agent with none of their own, so the store never loops', () => {
    // A fresh {} each read makes useSyncExternalStore re-render forever: React error #185, a blank page.
    const agent = { id: 'a1', role: 'worker' } as unknown as Agent;
    expect(ownTools(state, agent)).toBe(ownTools(state, agent));
    expect(ownTools(state, agent)).toEqual({});
  });

  it('gives the CEO the office’s CEO switches', () => {
    expect(ownTools(state, { id: 'ceo', role: 'ceo' } as unknown as Agent)).toEqual({ x: false });
  });
});
