import { describe, expect, it, vi } from 'vitest';

vi.mock('../../ui/sfx', () => ({ alarm: vi.fn(), audioUnlocked: () => false, chirp: vi.fn(), cue: vi.fn() }));

const { APPLY, AREAS } = await import('./index');
const { useStore } = await import('../../store');

describe('the store apply, one handler per event (#257)', () => {
  it('has each event in one area only: a second handler would silently replace the first', () => {
    const owners = new Map<string, string[]>();
    for (const [area, { handlers }] of Object.entries(AREAS)) for (const type of Object.keys(handlers)) owners.set(type, [...(owners.get(type) ?? []), area]);
    expect([...owners].filter(([, areas]) => areas.length > 1)).toEqual([]);
    expect(Object.keys(APPLY).sort()).toEqual([...owners.keys()].sort());
  });

  it('applies an event through its area and ignores the heartbeat', () => {
    useStore.getState().apply({ type: 'phoneRead', at: 42 });
    expect(useStore.getState().phoneReadAt).toBe(42);
    expect(() => useStore.getState().apply({ type: 'beat' })).not.toThrow();
  });
});
