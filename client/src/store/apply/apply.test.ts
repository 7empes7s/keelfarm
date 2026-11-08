import { describe, expect, it, vi } from 'vitest';
import { CHAT_KEEP } from '../../../../shared/chatPage';
import type { PhoneMessage, WorldSnapshot } from '../../../../shared/types';
import { snapshot } from './phone';

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

describe('paged chat after the store split (#145)', () => {
  it('restores the older-page flag from a snapshot, including older snapshots without it', () => {
    const messages: PhoneMessage[] = [{ id: 41, from: 'manager', text: 'Hello', at: 41 }];
    const ctx = { set: vi.fn(), get: useStore.getState, live: false, cues: false };
    expect(snapshot({ messages, messagesOlder: true } as WorldSnapshot, ctx)).toMatchObject({ messages, chatOlder: true });
    expect(snapshot({ messages } as WorldSnapshot, ctx)).toMatchObject({ messages, chatOlder: false });
  });

  it('keeps loaded history until the chat cap, then allows the dropped page to load again', () => {
    const before = useStore.getState();
    const messages: PhoneMessage[] = Array.from({ length: CHAT_KEEP }, (_, i) => ({ id: i + 1, from: 'manager', text: 'Hello', at: i }));
    try {
      useStore.setState({ messages, chatOlder: false });
      useStore.getState().apply({ type: 'message', message: { id: CHAT_KEEP + 1, from: 'manager', text: 'Newest', at: CHAT_KEEP } });
      expect(useStore.getState().messages).toHaveLength(CHAT_KEEP);
      expect(useStore.getState().messages[0].id).toBe(2);
      expect(useStore.getState().chatOlder).toBe(true);
    } finally {
      useStore.setState(before);
    }
  });
});
