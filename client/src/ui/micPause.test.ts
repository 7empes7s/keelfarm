import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePause, pauseLabel } from './micPause';

describe('the pause before done', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('defaults to 3 s and keeps only the offered choices', () => {
    expect(parsePause(null)).toBe(3000);
    expect(parsePause('nonsense')).toBe(3000);
    expect(parsePause('1200')).toBe(3000);
    expect(parsePause('1500')).toBe(1500);
    expect(parsePause('8000')).toBe(8000);
  });

  it('is saved on this device, and a page without storage still gets the default', async () => {
    const saved = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => saved.set(k, v) });
    const first = await import('./micPause');
    expect(first.useMicPause.getState().ms).toBe(3000);
    first.useMicPause.getState().set(5000);
    vi.resetModules();
    const again = await import('./micPause'); // a reload
    expect(again.useMicPause.getState().ms).toBe(5000);
    vi.stubGlobal('localStorage', undefined);
    vi.resetModules();
    expect((await import('./micPause')).useMicPause.getState().ms).toBe(3000);
  });

  it('reads as seconds', () => {
    expect(pauseLabel(1500)).toBe('1.5 s');
    expect(pauseLabel(3000)).toBe('3 s');
  });
});
