import { describe, expect, it } from 'vitest';
import { anchorScroll, clampText, gestureFor, isTwoFingerDoubleTap, pinchCancels, pinchText, snapText, stepText, systemText, textLabel, touchDistance, wheelText } from './chatPinch';

describe('chat text size (#135)', () => {
  it('pinching scales the size by how far the fingers spread, clamped to 80–200%', () => {
    expect(pinchText(100, 100, 150)).toBe(150);
    expect(pinchText(100, 100, 50)).toBe(80);
    expect(pinchText(120, 100, 400)).toBe(200);
    expect(pinchText(90, 200, 200)).toBe(90);
    expect(pinchText(100, 0, 50)).toBe(100); // fingers on the same spot: no change
  });

  it('a live size is clamped but smooth; a saved one snaps to 5%', () => {
    expect(clampText(137.4)).toBe(137.4);
    expect(clampText(Number.NaN)).toBe(100);
    expect(snapText(137.4)).toBe(135);
    expect(snapText(198)).toBe(200);
    expect(snapText(10)).toBe(80);
  });

  it('measures the fingers apart', () => {
    expect(touchDistance({ x: 0, y: 0 }, { x: 30, y: 40 })).toBe(50);
  });

  it('Ctrl + wheel up grows, down shrinks, within the limits', () => {
    expect(wheelText(100, -10)).toBeGreaterThan(100);
    expect(wheelText(100, 10)).toBeLessThan(100);
    expect(wheelText(195, -500)).toBe(200);
  });

  it('A− and A+ step by 10% to the next round size', () => {
    expect(stepText(100, 1)).toBe(110);
    expect(stepText(100, -1)).toBe(90);
    expect(stepText(105, 1)).toBe(110);
    expect(stepText(105, -1)).toBe(100);
    expect(stepText(200, 1)).toBe(200);
    expect(stepText(80, -1)).toBe(80);
  });

  it('keeps what is under the fingers in place', () => {
    // 100 px scrolled, fingers 200 px down: that content is at 300; doubled it's at 600, so scroll to 400.
    expect(anchorScroll(100, 200, 2)).toBe(400);
    expect(anchorScroll(0, 50, 0.5)).toBe(0);
  });

  it('two fingers are a pinch until every finger lifts; one finger from rest is a press', () => {
    expect(gestureFor(1, 'none')).toBe('press');
    expect(gestureFor(2, 'press')).toBe('pinch');
    expect(gestureFor(1, 'pinch')).toBe('pinch'); // one finger lifted: still not a press or a swipe
    expect(gestureFor(0, 'pinch')).toBe('none');
    expect(gestureFor(3, 'none')).toBe('pinch');
  });

  it('a pinch after a press began cancels it; an earlier one does not', () => {
    expect(pinchCancels(1000, 1200)).toBe(true);
    expect(pinchCancels(1000, 1000)).toBe(true);
    expect(pinchCancels(1000, 900)).toBe(false);
    expect(pinchCancels(1000, null)).toBe(false);
  });

  it('two two-finger taps close together are a double tap', () => {
    expect(isTwoFingerDoubleTap(1000, 1300)).toBe(true);
    expect(isTwoFingerDoubleTap(1000, 1500)).toBe(false);
    expect(isTwoFingerDoubleTap(null, 1000)).toBe(false);
  });

  it("starts from the phone's own text size", () => {
    expect(systemText(17)).toBe(100);
    expect(systemText(23)).toBe(135);
    expect(systemText(53)).toBe(200);
    expect(systemText(null)).toBe(100);
    expect(systemText(0)).toBe(100);
  });

  it('labels the pill', () => {
    expect(textLabel(119.6)).toBe('Text 120%');
  });
});
