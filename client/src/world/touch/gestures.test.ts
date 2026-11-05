import { describe, expect, it } from 'vitest';
import { cancelAll, createGestures, fingerCancel, fingerDown, fingerMove, fingerUp, GESTURE, slopFor, tickGestures, type GestureEvent } from './gestures';

const types = (evs: GestureEvent[]) => evs.map((e) => e.type);
const S = GESTURE.slopPx;

describe('tap', () => {
  it('fires on a quick press that barely moves, at the landing point', () => {
    const g = createGestures(2);
    fingerDown(g, 1, 100, 200, 0);
    expect(fingerMove(g, 1, 103, 202)).toEqual([]);
    expect(fingerUp(g, 1, 103, 202, GESTURE.tapMs)).toEqual([{ type: 'tap', x: 100, y: 200 }]);
  });

  it('moving just under the slop still taps; just over it walks instead', () => {
    const under = createGestures(2);
    fingerDown(under, 1, 0, 0, 0);
    fingerMove(under, 1, S - 0.5, 0);
    expect(types(fingerUp(under, 1, S - 0.5, 0, 100))).toEqual(['tap']);

    const over = createGestures(2);
    fingerDown(over, 1, 0, 0, 0);
    expect(types(fingerMove(over, 1, S + 0.5, 0))).toEqual(['stick']);
    expect(types(fingerUp(over, 1, S + 0.5, 0, 100))).toEqual(['stick', 'stickEnd']);
  });

  it('a press too long for a tap and too short for a hold does nothing', () => {
    const g = createGestures(2);
    fingerDown(g, 1, 0, 0, 0);
    expect(tickGestures(g, GESTURE.holdMs - 1)).toEqual([]);
    expect(fingerUp(g, 1, 0, 0, GESTURE.tapMs + 1)).toEqual([]);
  });
});

describe('hold', () => {
  it('arms after holdMs held still, and opens the menu on release without a tap', () => {
    const g = createGestures(2);
    fingerDown(g, 1, 50, 60, 0);
    expect(tickGestures(g, GESTURE.holdMs)).toEqual([{ type: 'armed', x: 50, y: 60 }]);
    expect(tickGestures(g, GESTURE.holdMs + 100)).toEqual([]); // arms once
    expect(fingerUp(g, 1, 52, 61, 900)).toEqual([{ type: 'hold', x: 50, y: 60 }]);
  });

  it('hold then move walks, never opening the menu', () => {
    const g = createGestures(2);
    fingerDown(g, 1, 0, 0, 0);
    tickGestures(g, GESTURE.holdMs);
    const moved = fingerMove(g, 1, 0, -40);
    expect(moved).toEqual([{ type: 'stick', cx: 0, cy: 0, x: 0, y: -40 }]);
    expect(types(fingerUp(g, 1, 0, -40, 2000))).toEqual(['stick', 'stickEnd']);
  });

  it('a drag never arms', () => {
    const g = createGestures(2);
    fingerDown(g, 1, 0, 0, 0);
    fingerMove(g, 1, 30, 0);
    expect(tickGestures(g, GESTURE.holdMs * 2)).toEqual([]);
  });
});

describe('the joystick', () => {
  it('is centred where the finger landed', () => {
    const g = createGestures(2);
    fingerDown(g, 1, 300, 500, 0);
    expect(fingerMove(g, 1, 320, 470)).toEqual([{ type: 'stick', cx: 300, cy: 500, x: 320, y: 470 }]);
    expect(fingerMove(g, 1, 330, 470)).toEqual([{ type: 'stick', cx: 300, cy: 500, x: 330, y: 470 }]);
  });
});

describe('multi-touch', () => {
  it('a second finger looks while the first walks', () => {
    const g = createGestures(2);
    fingerDown(g, 1, 0, 0, 0);
    fingerMove(g, 1, 0, -30);
    expect(fingerDown(g, 2, 300, 300, 50)).toEqual([]);
    expect(fingerMove(g, 2, 310, 295)).toEqual([{ type: 'look', dx: 10, dy: -5 }]);
    expect(types(fingerUp(g, 2, 310, 295, 120))).toEqual([]); // a quick look finger never taps
  });

  it('a second finger takes the first press its tap and menu: it walks from its landing point', () => {
    const g = createGestures(2);
    fingerDown(g, 1, 10, 20, 0);
    expect(fingerDown(g, 2, 300, 300, 40)).toEqual([{ type: 'stick', cx: 10, cy: 20, x: 10, y: 20 }]);
    expect(tickGestures(g, GESTURE.holdMs * 2)).toEqual([]);
    expect(types(fingerUp(g, 1, 10, 20, 100))).toEqual(['stick', 'stickEnd']);
    expect(types(fingerUp(g, 2, 300, 300, 100))).toEqual([]);
  });

  it('a finger landing while another looks walks', () => {
    const g = createGestures(2);
    fingerDown(g, 1, 0, 0, 0);
    fingerMove(g, 1, 0, -30); // walking
    fingerDown(g, 2, 300, 300, 10); // looking
    fingerUp(g, 1, 0, -30, 20); // stops walking, still looking
    expect(types(fingerDown(g, 3, 50, 50, 30))).toEqual(['stick']);
  });
});

describe('cancel', () => {
  it('stops walking and fires nothing else', () => {
    const g = createGestures(2);
    fingerDown(g, 1, 0, 0, 0);
    fingerMove(g, 1, 40, 0);
    expect(fingerCancel(g, 1)).toEqual([{ type: 'stickEnd' }]);
    expect(fingerUp(g, 1, 40, 0, 50)).toEqual([]);
  });

  it('a cancelled press neither taps nor holds', () => {
    const g = createGestures(2);
    fingerDown(g, 1, 0, 0, 0);
    tickGestures(g, GESTURE.holdMs);
    expect(fingerCancel(g, 1)).toEqual([]);
    expect(fingerUp(g, 1, 0, 0, 100)).toEqual([]);
  });

  it('cancelAll lets go of every finger', () => {
    const g = createGestures(2);
    fingerDown(g, 1, 0, 0, 0);
    fingerMove(g, 1, 40, 0);
    fingerDown(g, 2, 100, 0, 5);
    expect(cancelAll(g)).toEqual([{ type: 'stickEnd' }]);
    expect(g.fingers.size).toBe(0);
  });
});

describe('slopFor', () => {
  it('is the slop on dense screens and wider on coarse ones', () => {
    expect(slopFor(3)).toBe(GESTURE.slopPx);
    expect(slopFor(1)).toBe(GESTURE.minSlopDevicePx);
    expect(slopFor(0)).toBe(GESTURE.minSlopDevicePx);
  });
});
