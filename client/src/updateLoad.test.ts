import { afterEach, describe, expect, it, vi } from 'vitest';

const state = { updateReady: null as string | null, officeCommit: 'old', chatOutbox: [], pushToast: () => {} };
const loads: string[] = [];
vi.mock('./store', () => ({ useStore: { getState: () => state, setState: (p: object) => Object.assign(state, p) } }));
vi.mock('./pocket/mode', () => ({ useMode: { getState: () => ({ mode: 'office' }) } }));
vi.mock('./ui/voiceCallStore', () => ({ callOn: () => false }));
vi.mock('./updateGate', () => ({
  readyAfter: (_ready: string | null, before: string, after: string) => (before !== after ? after : null),
  tryLoad: (ready: string | null, moment: { kind: string }, _rest: object) => {
    if (ready && moment.kind === 'tap') loads.push(ready);
    return { loaded: !!ready, waitsFor: null };
  },
}));
vi.stubGlobal('document', { querySelector: () => null });
import { noteCommit, reloadAfterUpdate } from './updateLoad';

afterEach(() => {
  loads.length = 0;
  state.updateReady = null;
});

describe('Update office reloads the page afterwards (#673)', () => {
  it('loads the new client once the office is back on a new commit', () => {
    vi.useFakeTimers();
    reloadAfterUpdate();
    noteCommit('new');
    vi.runAllTimers();
    expect(loads).toEqual(['new']);
    vi.useRealTimers();
  });

  it('waits for a safe moment when the manager did not tap Update office', () => {
    vi.useFakeTimers();
    noteCommit('newer');
    vi.runAllTimers();
    expect(loads).toEqual([]);
    expect(state.updateReady).toBe('newer');
    vi.useRealTimers();
  });
});
