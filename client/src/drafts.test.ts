import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDrafts, memoryKv } from './drafts';

// #216: what the manager writes is kept per conversation, 300 ms after the last change, and comes back after a reload.
describe('drafts', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('saves and restores each conversation on its own', async () => {
    const kv = memoryKv();
    const d = createDrafts(kv);
    d.save('ceo:c1', { text: 'Plan the bakery' });
    d.save('ceo:c2', { text: 'Grow floor 2?' });
    await vi.advanceTimersByTimeAsync(300);
    // a reload: a fresh drafts object on the same storage
    const after = createDrafts(kv);
    expect(await after.load('ceo:c1')).toEqual({ text: 'Plan the bakery' });
    expect(await after.load('ceo:c2')).toEqual({ text: 'Grow floor 2?' });
    expect(await after.load('ceo:c3')).toBeUndefined();
  });

  it('writes 300 ms after the last change, and at once on flush (before a reload)', async () => {
    const kv = memoryKv();
    const set = vi.spyOn(kv, 'set');
    const d = createDrafts(kv);
    d.save('agent:a1', 'h');
    await vi.advanceTimersByTimeAsync(200);
    d.save('agent:a1', 'hello');
    await vi.advanceTimersByTimeAsync(200);
    expect(set).not.toHaveBeenCalled();
    expect(await d.load('agent:a1')).toBe('hello'); // a save still waiting counts
    await vi.advanceTimersByTimeAsync(100);
    expect(set).toHaveBeenCalledTimes(1);
    d.save('agent:a1', 'hello there');
    await d.flush();
    expect(await kv.get('agent:a1')).toBe('hello there');
  });

  it('forgets a draft saved as null (sent or emptied), and survives a store that throws', async () => {
    const kv = memoryKv();
    const d = createDrafts(kv);
    await d.put('ceo:c1', { text: 'x' });
    d.save('ceo:c1', null);
    await d.flush();
    expect(await kv.get('ceo:c1')).toBeUndefined();
    const broken = createDrafts({ get: () => Promise.reject(new Error('private mode')), set: () => Promise.reject(new Error('quota')), del: () => Promise.reject(new Error('x')) });
    broken.save('k', 'v');
    await expect(broken.flush()).resolves.toBeUndefined();
    await expect(broken.load('k')).resolves.toBeUndefined();
  });
});
