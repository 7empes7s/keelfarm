import { describe, expect, it, vi } from 'vitest';

// A device's storage, before the store reads its saved choice.
const saved = new Map<string, string>([['cubefarm:chatFull', 'on']]);
vi.stubGlobal('localStorage', { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v) });
const { initialChatFull, leaveFullFor, navLeavesFull, togglesFull, useChatFull } = await import('./chatFull');

const key = { ctrlKey: false, metaKey: false, altKey: false, repeat: false, defaultPrevented: false };

describe('the CEO chat full screen (#201)', () => {
  it('starts as this device left it, normal by default', () => {
    expect(initialChatFull(null)).toBe(false);
    expect(initialChatFull('off')).toBe(false);
    expect(initialChatFull('on')).toBe(true);
    expect(useChatFull.getState().on).toBe(true); // read from storage at start
  });

  it('toggles and remembers the choice per device', () => {
    useChatFull.getState().toggle();
    expect(useChatFull.getState().on).toBe(false);
    expect(saved.get('cubefarm:chatFull')).toBe('off');
    useChatFull.getState().set(true);
    expect(saved.get('cubefarm:chatFull')).toBe('on');
  });

  it('keeps working without storage (private mode)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(() => useChatFull.getState().toggle()).not.toThrow();
    expect(useChatFull.getState().on).toBe(false);
  });

  it("takes its key only in the chat, never while typing or with Ctrl, Alt or ⌘", () => {
    expect(togglesFull(key, true, true, false)).toBe(true);
    expect(togglesFull(key, false, true, false)).toBe(false); // another key
    expect(togglesFull(key, true, false, false)).toBe(false); // focus elsewhere
    expect(togglesFull(key, true, true, true)).toBe(false); // typing
    for (const k of ['ctrlKey', 'metaKey', 'altKey', 'repeat', 'defaultPrevented'] as const) expect(togglesFull({ ...key, [k]: true }, true, true, false), k).toBe(false);
  });

  it('leaves full screen when the rail navigates, wide only (#242)', () => {
    expect(navLeavesFull(true, true)).toBe(true);
    expect(navLeavesFull(true, false)).toBe(false);
    expect(navLeavesFull(false, true)).toBe(false); // a phone's tab bar is hidden while full
    useChatFull.getState().set(true);
    leaveFullFor(false);
    expect(useChatFull.getState().on).toBe(true);
    leaveFullFor(true);
    expect(useChatFull.getState().on).toBe(false);
    useChatFull.getState().toggle(); // ⛶ again brings it back
    expect(useChatFull.getState().on).toBe(true);
  });
});
