import { describe, expect, it, vi } from 'vitest';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';

// A floor's theme (#370): office by default, set through updateRepo (the floor's settings), sent in the snapshot and
// its repo event, kept in the saved state, and an unknown one refused.

describe('floor themes in the office', () => {
  it('starts as the office, re-dresses through the repo event and refuses unknown themes', async () => {
    const swarm = new Swarm(createDemoBackend());
    const repo = await swarm.connectRepo('demo-co/pixel-todo');
    const floor = () => swarm.snapshot().repos.find((r) => r.id === repo.id)!;
    await vi.waitFor(() => expect(floor().lastSync).not.toBeNull());
    expect(floor().theme).toBe('office');
    const sent: unknown[] = [];
    const observe = vi.spyOn(swarm as unknown as { observe: (ev: unknown) => void }, 'observe').mockImplementation((ev) => void sent.push(ev));
    expect(swarm.updateRepo(repo.id, { theme: 'game-studio' }).theme).toBe('game-studio');
    expect(floor().theme).toBe('game-studio');
    expect(sent).toContainEqual(expect.objectContaining({ type: 'repo', repo: expect.objectContaining({ id: repo.id, theme: 'game-studio' }) }));
    observe.mockRestore();
    expect(() => swarm.updateRepo(repo.id, { theme: 'casino' })).toThrow(/theme must be one of/);
    expect(floor().theme).toBe('game-studio');
    // what the state file keeps
    const saved = (swarm as unknown as { state: { repos: { id: string; theme?: string }[] } }).state.repos.find((r) => r.id === repo.id);
    expect(saved?.theme).toBe('game-studio');
  });
});
