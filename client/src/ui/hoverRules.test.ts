import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOSE_MS, HOLD_MS, OPEN_MS, createPeek, placePeek, type PeekMode } from './hoverRules';

describe('createPeek', () => {
  let seen: (PeekMode | null)[];
  let peek: ReturnType<typeof createPeek>;
  beforeEach(() => {
    vi.useFakeTimers();
    seen = [];
    peek = createPeek((m) => seen.push(m));
  });
  afterEach(() => vi.useRealTimers());

  it('opens 350 ms after hover, not before', () => {
    peek.hoverIn();
    vi.advanceTimersByTime(OPEN_MS - 1);
    expect(peek.mode).toBe(null);
    vi.advanceTimersByTime(1);
    expect(peek.mode).toBe('card');
    expect(OPEN_MS).toBe(350);
  });

  it('a pass over the trigger shorter than the delay never opens it', () => {
    peek.hoverIn();
    vi.advanceTimersByTime(200);
    peek.hoverOut();
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual([]);
  });

  it('closes 150 ms after leaving, and moving onto the card keeps it (hoverable)', () => {
    peek.hoverIn();
    vi.advanceTimersByTime(OPEN_MS);
    peek.hoverOut();
    vi.advanceTimersByTime(CLOSE_MS - 10);
    peek.hoverIn(); // the pointer reached the card
    vi.advanceTimersByTime(1000);
    expect(peek.mode).toBe('card');
    peek.hoverOut();
    vi.advanceTimersByTime(CLOSE_MS);
    expect(peek.mode).toBe(null);
    expect(CLOSE_MS).toBe(150);
  });

  it('opens on keyboard focus and closes on blur', () => {
    peek.focusIn();
    vi.advanceTimersByTime(OPEN_MS);
    expect(peek.mode).toBe('card');
    peek.focusOut();
    vi.advanceTimersByTime(CLOSE_MS);
    expect(peek.mode).toBe(null);
  });

  it('Esc dismisses an open peek and says the key was its own', () => {
    expect(peek.escape()).toBe(false);
    peek.focusIn();
    vi.advanceTimersByTime(OPEN_MS);
    expect(peek.escape()).toBe(true);
    expect(peek.mode).toBe(null);
  });

  it('Esc before it opens cancels the pending open', () => {
    peek.hoverIn();
    peek.escape();
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual([]);
  });

  it('a long-press opens the sheet, and the tap that ends it is not the main action', () => {
    peek.pressStart();
    vi.advanceTimersByTime(HOLD_MS);
    expect(peek.mode).toBe('sheet');
    peek.pressEnd();
    expect(peek.click()).toBe(false);
    expect(peek.mode).toBe('sheet'); // persistent until dismissed
    peek.hoverOut();
    vi.advanceTimersByTime(1000);
    expect(peek.mode).toBe('sheet');
  });

  it('a quick tap does the main action and opens nothing', () => {
    peek.pressStart();
    vi.advanceTimersByTime(100);
    peek.pressEnd();
    expect(peek.click()).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual([]);
  });

  it('a click while the card is open closes it and does the main action', () => {
    peek.hoverIn();
    vi.advanceTimersByTime(OPEN_MS);
    expect(peek.click()).toBe(true);
    expect(peek.mode).toBe(null);
  });
});

describe('placePeek', () => {
  const at = (left: number, top: number, w = 60, h = 20) => ({ left, top, right: left + w, bottom: top + h });

  it('sits below its trigger when there is room', () => {
    expect(placePeek(at(100, 100), 300, 150, 1280, 800)).toEqual({ left: 100, top: 128, side: 'bottom' });
  });

  it('flips above near the bottom edge', () => {
    const p = placePeek(at(100, 740), 300, 150, 1280, 800);
    expect(p.side).toBe('top');
    expect(p.top).toBe(740 - 8 - 150);
  });

  it('shifts left to stay on screen near the right edge', () => {
    const p = placePeek(at(1250, 100, 20), 300, 150, 1280, 800);
    expect(p.left).toBe(1280 - 8 - 300);
  });

  it('never leaves the window, even when it fits nowhere', () => {
    const p = placePeek(at(10, 380), 300, 700, 390, 800);
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.top).toBeGreaterThanOrEqual(8);
    expect(p.top + 700).toBeLessThanOrEqual(800 - 8 + 0.001);
  });

  it('moves off the CEO chat column beside the page', () => {
    const chat = { left: 880, top: 0, right: 1280, bottom: 800 };
    const p = placePeek(at(800, 100), 300, 150, 1280, 800, [chat]);
    expect(p.left + 300).toBeLessThanOrEqual(880);
  });

  it('a chat ref near the message box goes above it, never over the input', () => {
    const input = { left: 880, top: 720, right: 1280, bottom: 790 };
    const p = placePeek(at(900, 690), 300, 150, 1280, 800, [input]);
    expect(p.side).toBe('top');
    expect(p.top + 150).toBeLessThanOrEqual(720);
  });
});
