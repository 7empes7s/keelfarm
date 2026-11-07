import { beforeEach, describe, expect, it, vi } from 'vitest';

// #216: a new office commit never reloads the page by itself; the new version loads at a safe moment.
vi.mock('./ui/sfx', () => ({ alarm: vi.fn(), audioUnlocked: () => false, chirp: vi.fn(), cue: vi.fn() }));

const reload = vi.fn();
let sheet: object | null = null;
vi.stubGlobal('location', { reload });
vi.stubGlobal('document', { querySelector: () => sheet, addEventListener: vi.fn(), visibilityState: 'visible' });

const { noteCommit, loadUpdate } = await import('./clientUpdate');
const { useStore } = await import('./store');

describe('a new office commit', () => {
  beforeEach(() => {
    reload.mockClear();
    sheet = null;
    useStore.setState({ chatOutbox: [], toasts: [] });
  });

  it('sets updateReady and does not reload', () => {
    noteCommit('abc1234'); // the page's own
    noteCommit('abc1234'); // a reconnect to the same office
    expect(useStore.getState().updateReady).toBe(false);
    noteCommit('def5678'); // the office updated itself
    expect(useStore.getState().updateReady).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it('waits while a message is sending or a sheet is open, then loads at the next safe moment', async () => {
    useStore.setState({ updateReady: true, chatOutbox: [{ key: 1, clientId: 'c1', text: 'hi', at: 1, delivery: 'sending' }] });
    expect(await loadUpdate('tap')).toBe(false);
    expect(useStore.getState().toasts.at(-1)?.text).toContain('a message is still sending');
    useStore.setState({ chatOutbox: [] });
    sheet = {};
    expect(await loadUpdate('navigate')).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    sheet = null;
    expect(await loadUpdate('navigate')).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
