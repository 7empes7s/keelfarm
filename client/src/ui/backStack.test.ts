import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { depthOf, stepsTo, toClose, withDepth } from './backStack';

describe('the back stack rules', () => {
  it('pushes for new layers and goes back for closed ones', () => {
    expect(stepsTo(1, 0)).toBe(1);
    expect(stepsTo(2, 3)).toBe(-1);
    expect(stepsTo(1, 1)).toBe(0);
  });
  it('closes the layers above where Back landed', () => {
    expect(toClose(2, 1)).toBe(1);
    expect(toClose(1, 0)).toBe(1);
    expect(toClose(1, 2)).toBe(0); // Forward reopens nothing
  });
  it('reads only its own depth from a history entry', () => {
    expect(depthOf(null)).toBe(0);
    expect(depthOf({ other: 1 })).toBe(0);
    expect(depthOf({ cubefarmBack: 2 })).toBe(2);
    expect(withDepth({ keep: 'x' }, 3)).toEqual({ keep: 'x', cubefarmBack: 3 });
  });
});

/** A browser's session history, enough for pushState, go() and popstate. */
function fakeBrowser() {
  const entries: unknown[] = [null];
  let at = 0;
  const listeners: ((e: { state: unknown }) => void)[] = [];
  const history = {
    get state() {
      return entries[at];
    },
    pushState(s: unknown) {
      entries.splice(at + 1);
      entries.push(s);
      at++;
    },
    go(n: number) {
      setTimeout(() => {
        at = Math.max(0, Math.min(entries.length - 1, at + n));
        for (const l of listeners) l({ state: entries[at] });
      }, 0);
    },
  };
  vi.stubGlobal('history', history);
  vi.stubGlobal('window', { addEventListener: (_: string, l: (e: { state: unknown }) => void) => listeners.push(l) });
  return { at: () => at, length: () => entries.length, back: () => history.go(-1) };
}

describe('pushLayer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('Back closes the top layer, not the app', async () => {
    const b = fakeBrowser();
    const { pushLayer } = await import('./backStack');
    const closed: string[] = [];
    let removeSheet = () => {};
    pushLayer(() => closed.push('viewer'));
    removeSheet = pushLayer(() => {
      closed.push('sheet');
      removeSheet();
    });
    await vi.runAllTimersAsync();
    expect(b.at()).toBe(2);
    b.back();
    await vi.runAllTimersAsync();
    expect(closed).toEqual(['sheet']);
    expect(b.at()).toBe(1); // still in the app, the viewer open
  });

  it('a layer closed by its × takes its history entry with it', async () => {
    const b = fakeBrowser();
    const { pushLayer } = await import('./backStack');
    const remove = pushLayer(() => undefined);
    await vi.runAllTimersAsync();
    expect(b.at()).toBe(1);
    remove();
    await vi.runAllTimersAsync();
    expect(b.at()).toBe(0);
  });

  it('one panel opened in place of another keeps a single entry', async () => {
    const b = fakeBrowser();
    const { pushLayer } = await import('./backStack');
    const card = pushLayer(() => undefined);
    await vi.runAllTimersAsync();
    card();
    pushLayer(() => undefined); // the viewer, in the same tick
    await vi.runAllTimersAsync();
    expect(b.at()).toBe(1);
    expect(b.length()).toBe(2);
  });
});
