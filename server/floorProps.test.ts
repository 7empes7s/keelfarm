import { describe, expect, it, vi } from 'vitest';
import { createDemoBackend } from './demo.ts';
import { patchOf } from './outbox.ts';
import { Swarm } from './swarm.ts';

// A floor's project props (#536): no pick by default (its profile picks), a manual pick through updateRepo (Floor
// settings), sent in the snapshot, kept in the saved state, 'auto' clears it, and an unknown set is refused.

describe('project props in the office', () => {
  it('keeps the manual pick per floor, clears it with auto and refuses unknown sets', async () => {
    const swarm = new Swarm(createDemoBackend());
    const repo = await swarm.connectRepo('demo-co/pixel-todo');
    const floor = () => swarm.snapshot().repos.find((r) => r.id === repo.id)!;
    await vi.waitFor(() => expect(floor().lastSync).not.toBeNull());
    expect(floor().props).toBeNull();
    expect(swarm.updateRepo(repo.id, { props: 'vault' }).props).toBe('vault');
    expect(floor().props).toBe('vault');
    const saved = () => (swarm as unknown as { state: { repos: { id: string; props?: string }[] } }).state.repos.find((r) => r.id === repo.id);
    expect(saved()?.props).toBe('vault');
    expect(() => swarm.updateRepo(repo.id, { props: 'casino' })).toThrow(/props must be auto or one of/);
    expect(floor().props).toBe('vault');
    swarm.updateRepo(repo.id, { props: 'auto' });
    expect(floor().props).toBeNull(); // sent as null, so the floor's next patch carries it
    expect(saved()?.props).toBeUndefined();
    expect(patchOf({ id: repo.id, props: 'vault' as string | null }, { id: repo.id, props: null })).toEqual({ id: repo.id, props: null });
  });
});
