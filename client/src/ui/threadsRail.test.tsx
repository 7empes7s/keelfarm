import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ chat: { conversations: [], current: 'c1' }, repos: [], phoneReadAt: 0 }));
vi.mock('../store', () => ({ useStore: (select: (s: typeof state) => unknown) => select(state) }));
import { ThreadsColumn } from './ChatHistory';
import { RAIL_KEY, saveRail, savedRail, togglesRail } from './threadsRail';

const key = { code: 'Backslash', ctrlKey: true, metaKey: false, altKey: false, repeat: false, defaultPrevented: false };

describe('the threads rail (#346, #396)', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('remembers the folded state on this device', () => {
    expect(savedRail()).toBe(false);
    saveRail(true);
    expect(store.get(RAIL_KEY)).toBe('1');
    expect(savedRail()).toBe(true);
    saveRail(false);
    expect(savedRail()).toBe(false);
  });

  it('survives storage that throws', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('private'); }, setItem: () => { throw new Error('private'); } });
    expect(() => saveRail(true)).not.toThrow();
    expect(savedRail()).toBe(false);
  });

  it('renders as a rail once folded, and as the column otherwise', () => {
    const column = renderToStaticMarkup(<ThreadsColumn ceoName="Morgan" hidden={false} />);
    expect(column).toContain('aria-label="Hide the threads"');
    expect(column).not.toContain('threads-rail');
    saveRail(true);
    const rail = renderToStaticMarkup(<ThreadsColumn ceoName="Morgan" hidden={false} />);
    expect(rail).toContain('class="threads-col threads-rail"');
    expect(rail).toContain('aria-label="Show the threads"');
    expect(rail).toContain('aria-label="New thread"');
    expect(rail).toContain('aria-label="Search every thread"');
    expect(rail).not.toContain('Hide the threads');
  });

  it('Ctrl or ⌘ + \\ in the chat folds it, nothing else does', () => {
    expect(togglesRail(key, true)).toBe(true);
    expect(togglesRail({ ...key, ctrlKey: false, metaKey: true }, true)).toBe(true);
    expect(togglesRail(key, false)).toBe(false);
    expect(togglesRail({ ...key, ctrlKey: false }, true)).toBe(false);
    expect(togglesRail({ ...key, repeat: true }, true)).toBe(false);
    expect(togglesRail({ ...key, code: 'Slash' }, true)).toBe(false);
  });
});
