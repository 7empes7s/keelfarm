import { beforeEach, describe, expect, it, vi } from 'vitest';

// Sounds and pointer lock need a browser.
vi.stubGlobal('document', { pointerLockElement: null });
vi.mock('../../ui/sfx', () => ({ alarm: vi.fn(), audioUnlocked: () => false, chirp: vi.fn(), cue: vi.fn(), noise: vi.fn(), tone: vi.fn() }));

const { useStore } = await import('../../store');
const { decorationAction } = await import('./actions');

const won = { id: 'hat-trick' as const, at: Date.UTC(2026, 10, 7, 12), detail: 'PR #12 on demo-co/pixel-todo: 3 merges within an hour' };

describe('E on a trophy (#311)', () => {
  beforeEach(() => {
    const s = useStore.getState();
    useStore.setState({ overlay: null, toasts: [], progress: { ...s.progress, achievements: [won] } });
  });

  it('opens its card, not a toast', () => {
    decorationAction({ kind: 'trophy', id: 'hat-trick' });
    expect(useStore.getState().overlay).toEqual({ kind: 'trophy-card', id: 'hat-trick' });
    expect(useStore.getState().toasts).toEqual([]);
  });

  it('replaces the open card with the next trophy looked at, locked ones too', () => {
    decorationAction({ kind: 'trophy', id: 'hat-trick' });
    decorationAction({ kind: 'trophy', id: 'century' });
    expect(useStore.getState().overlay).toEqual({ kind: 'trophy-card', id: 'century' });
    expect(useStore.getState().toasts).toEqual([]);
  });
});
