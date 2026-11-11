import { describe, expect, it } from 'vitest';
import { EDGE, placeAnchored } from './popoverRules';

const VW = 1280;
const VH = 800;
/** A 44 px header button whose left edge is at `x`. */
const button = (x: number, top = 8) => ({ left: x, top, right: x + 44, bottom: top + 44 });

/** On screen with the 12 px margin, under the trigger, the arrow's tip on the trigger (its centre, short of the card's rounded corners). */
function expectUnder(t: ReturnType<typeof button>, w: number, h: number, vw = VW, align: 'center' | 'end' = 'center') {
  const p = placeAnchored(t, w, h, vw, VH, align);
  expect(p.side).toBe('bottom');
  expect(p.top).toBeGreaterThan(t.bottom);
  expect(p.left).toBeGreaterThanOrEqual(EDGE);
  expect(p.left + w).toBeLessThanOrEqual(vw - EDGE);
  expect(p.left + p.arrow).toBeGreaterThan(t.left + 4);
  expect(p.left + p.arrow).toBeLessThan(t.right - 4);
  return p;
}

describe('placeAnchored', () => {
  it('centres a popover under a button in the middle', () => {
    const p = expectUnder(button(600), 300, 200);
    expect(p.left).toBe(622 - 150);
    expect(p.left + p.arrow).toBe(622);
  });

  it('stays on screen at the left edge, the arrow still at the button', () => {
    expectUnder(button(4), 300, 200);
  });

  it('stays on screen at the right edge, the arrow still at the button', () => {
    const p = expectUnder(button(VW - 48), 380, 400);
    expect(p.left).toBe(VW - EDGE - 380);
  });

  it('with the CEO chat open on the right, the speaker stays above its button, not moved off the chat (the bug)', () => {
    // At 1280 and 1920 the speaker sits over the chat column; the card used to land at the window's far left.
    for (const vw of [1280, 1920]) {
      const speaker = button(vw - 420);
      const p = expectUnder(speaker, 300, 220, vw);
      expect(p.left).toBeGreaterThan(vw / 2);
    }
  });

  it('right-aligns with its button when asked', () => {
    const p = expectUnder(button(900), 380, 300, VW, 'end');
    expect(p.left + 380).toBe(944);
  });

  it('opens over a trigger at the bottom of the window, and taller content scrolls inside', () => {
    const t = button(600, VH - 60);
    const p = placeAnchored(t, 300, 200, VW, VH);
    expect(p.side).toBe('top');
    expect(p.top + 200).toBeLessThan(t.top);
    const tall = placeAnchored(button(600), 380, 2000, VW, VH);
    expect(tall.side).toBe('bottom');
    expect(tall.top + tall.maxHeight).toBeLessThanOrEqual(VH - EDGE);
  });

  it('on a 390 px phone a wide popover fills the width inside the margins', () => {
    const p = placeAnchored(button(300), 366, 300, 390, 844);
    expect(p.left).toBe(EDGE);
    expect(p.left + p.arrow).toBeCloseTo(322);
  });
});
