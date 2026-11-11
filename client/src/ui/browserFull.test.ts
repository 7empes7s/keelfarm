import { describe, expect, it, vi } from 'vitest';

// A browser with the Fullscreen API, before the chat's store reads its storage.
const fake = { fullscreenEnabled: true, fullscreenElement: null as Element | null, exitFullscreen: vi.fn(), documentElement: { requestFullscreen: vi.fn() } };
fake.exitFullscreen.mockImplementation(async () => void (fake.fullscreenElement = null));
fake.documentElement.requestFullscreen.mockImplementation(async () => void (fake.fullscreenElement = {} as Element));
vi.stubGlobal('document', fake);
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
const { canGoFullscreen, inBrowserFull, toggleBrowserFull } = await import('./browserFull');
const { useChatFull } = await import('./chatFull');
const { buildIndex } = await import('./searchIndex');

describe("the top bar's browser full screen (#415)", () => {
  it('and the chat full screen toggle on their own', async () => {
    useChatFull.getState().set(true);
    toggleBrowserFull();
    await Promise.resolve();
    expect(inBrowserFull()).toBe(true);
    useChatFull.getState().set(false); // leaving the chat's full screen keeps the browser's
    expect(inBrowserFull()).toBe(true);
    expect(fake.exitFullscreen).not.toHaveBeenCalled();
    toggleBrowserFull(); // pressed again: out, the chat untouched
    await Promise.resolve();
    expect(inBrowserFull()).toBe(false);
    expect(useChatFull.getState().on).toBe(false);
    useChatFull.getState().set(true);
    toggleBrowserFull();
    toggleBrowserFull();
    expect(useChatFull.getState().on).toBe(true);
  });

  it("isn't there on an iPhone, which has no Fullscreen API", () => {
    const iphone = { ...fake, fullscreenEnabled: false, documentElement: { requestFullscreen: vi.fn() } };
    expect(canGoFullscreen(iphone)).toBe(false);
    toggleBrowserFull(iphone);
    expect(iphone.documentElement.requestFullscreen).not.toHaveBeenCalled();
    expect(canGoFullscreen(null)).toBe(false);
  });

  it('is found by the search under the top bar, only where the browser has it', () => {
    const input = { repos: [], agents: {}, qa: {}, messages: [] };
    for (const where of ['office', 'pocket'] as const) {
      const found = buildIndex({ ...input, where, fullscreen: true }).filter((i) => i.label === 'Full screen (browser)');
      expect(found).toEqual([expect.objectContaining({ sub: 'Top bar · F11', target: { kind: 'fullscreen' } })]);
      expect(buildIndex({ ...input, where }).some((i) => i.label === 'Full screen (browser)')).toBe(false);
    }
  });
});
