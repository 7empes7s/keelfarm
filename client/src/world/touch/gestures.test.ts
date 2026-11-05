import { describe, expect, it } from 'vitest';
import { cancelAll, createGestures, fingerCancel, fingerDown, fingerMove, fingerUp, GESTURE, slopFor, tickGestures, zoneAt, type GestureEvent } from './gestures';

const types = (evs: GestureEvent[]) => evs.map((e) => e.type);
const S = GESTURE.slopPx;

describe('tap', () => {
  it('fires on a quick press that barely moves, at the landing point', () => {
    const g = createGestures(2);
    fingerDown(g, 1, 100, 200, 0, 'stick');
    expect(fingerMove(g, 1, 103, 202)).toEqual([]);
    expect(fingerUp(g, 1, 103, 202, GESTURE.tapMs)).toEqual([{ type: 'tap', x: 100, y: 200 }]);
  });

  it('moving just under the slop still taps; just over it walks instead', () => {
    const under = createGestures(2);
    fingerDown(under, 1, 0, 0, 0, 'stick');
    fingerMove(under, 1, S - 0.5, 0);
    expect(types(fingerUp(under, 1, S - 0.5, 0, 100))).toEqual(['tap']);

    const over = createGestures(2);
    fingerDown(over, 1, 0, 0, 0, 'stick');
    expect(types(fingerMove(over, 1, S + 0.5, 0))).toEqual(['stick']);
    expect(types(fingerUp(over, 1, S + 0.5, 0, 100))).toEqual(['stick', 'stickEnd']);
  });

  it('a press too long for a tap and too short for a hold does nothing', () => {
    const g = createGestures(2);
    fingerDown(g, 1, 0, 0, 0, 'stick');
    expect(tickGestures(g, GESTURE.holdMs - 1)).toEqual([]);
    expect(fingerUp(g, 1, 0, 0, GESTURE.tapMs + 1)).toEqual([]);
  });
});

describe('hold', () => {
  it('arms after holdMs held still, and opens the menu on release without a tap', () => {
    const g = createGestures(2);
    fingerDown(g, 1, 50, 60, 0, 'stick');
    expect(tickGestures(g, GESTURE.holdMs)).toEqual([{ type: 'armed', x: 50, y: 60 }]);
    expect(tickGestures(g, GESTURE.holdMs + 100)).toEqual([]); // arms once
    expect(fingerUp(g, 1, 52, 61, 900)).toEqual([{ type: 'hold', x: 50, y: 60 }]);
  });

  it('hold then move walks, never opening the menu', () => {
    const g = createGestures(2);
    fingerDown(g, 1, 0, 0, 0, 'stick');
    tickGestures(g, GESTURE.holdMs);
    const moved = fingerMove(g, 1, 0, -40);
    expect(moved).toEqual([{ type: 'stick', cx: 0, cy: 0, x: 0, y: -40 }]);
    expect(types(fingerUp(g, 1, 0, -40, 2000))).toEqual(['stick', 'stickEnd']);
  });

  it('a drag never arms', () => {
    const g = createGestures(2);
    fingerDown(g, 1, 0, 0, 0, 'stick');
    fingerMove(g, 1, 30, 0);
    expect(tickGestures(g, GESTURE.holdMs * 2)).toEqual([]);
  });
});

describe('the joystick', () => {
  it('is centred where the finger landed', () => {
    const g = createGestures(2);
    fingerDown(g, 1, 300, 500, 0, 'stick');
    expect(fingerMove(g, 1, 320, 470)).toEqual([{ type: 'stick', cx: 300, cy: 500, x: 320, y: 470 }]);
    expect(fingerMove(g, 1, 330, 470)).toEqual([{ type: 'stick', cx: 300, cy: 500, x: 330, y: 470 }]);
  });
});

describe('the split screen (#83)', () => {
  const phone = { top: 0, height: 844 };

  it('the top half looks, the bottom half walks', () => {
    expect(zoneAt(100, phone)).toBe('look');
    expect(zoneAt(421, phone)).toBe('look');
    expect(zoneAt(422, phone)).toBe('stick');
    expect(zoneAt(800, phone)).toBe('stick');
  });

  it('splits the visible part of the page (the keyboard or a toolbar taken off)', () => {
    expect(zoneAt(350, { top: 100, height: 600 })).toBe('look');
    expect(zoneAt(450, { top: 100, height: 600 })).toBe('stick');
  });

  it('a drag in the top half looks and never walks', () => {
    const g = createGestures(2);
    fingerDown(g, 1, 200, 200, 0, 'look');
    expect(fingerMove(g, 1, 200 + S + 5, 200)).toEqual([{ type: 'look', dx: S + 5, dy: 0 }]);
    expect(fingerMove(g, 1, 200 + S + 8, 196)).toEqual([{ type: 'look', dx: 3, dy: -4 }]);
    expect(types(fingerUp(g, 1, 200 + S + 8, 196, 500))).toEqual([]);
  });

  it('a drag in the bottom half walks', () => {
    const g = createGestures(2);
    fingerDown(g, 1, 200, 700, 0, 'stick');
    expect(fingerMove(g, 1, 200, 660)).toEqual([{ type: 'stick', cx: 200, cy: 700, x: 200, y: 660 }]);
  });

  it('a finger keeps its role when it crosses the middle', () => {
    const look = createGestures(2);
    fingerDown(look, 1, 200, 300, 0, 'look');
    fingerMove(look, 1, 200, 330);
    expect(types(fingerMove(look, 1, 200, 700))).toEqual(['look']);

    const walk = createGestures(2);
    fingerDown(walk, 1, 200, 600, 0, 'stick');
    fingerMove(walk, 1, 200, 560);
    expect(types(fingerMove(walk, 1, 200, 100))).toEqual(['stick']);
    expect(types(fingerUp(walk, 1, 200, 100, 900))).toEqual(['stick', 'stickEnd']);
  });

  it('tap and hold work in either half', () => {
    const top = createGestures(2);
    fingerDown(top, 1, 100, 100, 0, 'look');
    expect(fingerUp(top, 1, 101, 101, 100)).toEqual([{ type: 'tap', x: 100, y: 100 }]);

    const held = createGestures(2);
    fingerDown(held, 1, 100, 100, 0, 'look');
    expect(types(tickGestures(held, GESTURE.holdMs))).toEqual(['armed']);
    expect(types(fingerUp(held, 1, 100, 100, 900))).toEqual(['hold']);
  });
});

describe('multi-touch', () => {
  it('one finger in each half walks and looks together', () => {
    const g = createGestures(2);
    fingerDown(g, 1, 100, 700, 0, 'stick');
    fingerMove(g, 1, 100, 660);
    expect(fingerDown(g, 2, 300, 200, 50, 'look')).toEqual([]);
    expect(fingerMove(g, 2, 310, 195)).toEqual([{ type: 'look', dx: 10, dy: -5 }]);
    expect(fingerMove(g, 1, 110, 650)).toEqual([{ type: 'stick', cx: 100, cy: 700, x: 110, y: 650 }]);
    expect(types(fingerUp(g, 2, 310, 195, 120))).toEqual([]); // a quick second finger never taps
  });

  it('the look finger first, then the walking one', () => {
    const g = createGestures(2);
    fingerDown(g, 1, 300, 200, 0, 'look');
    fingerMove(g, 1, 330, 200);
    expect(fingerDown(g, 2, 100, 700, 50, 'stick')).toEqual([{ type: 'stick', cx: 100, cy: 700, x: 100, y: 700 }]);
    expect(types(fingerMove(g, 1, 340, 200))).toEqual(['look']);
  });

  it('a second finger takes the first press its tap and menu: each drags by its own half', () => {
    const g = createGestures(2);
    fingerDown(g, 1, 10, 700, 0, 'stick');
    expect(fingerDown(g, 2, 300, 200, 40, 'look')).toEqual([{ type: 'stick', cx: 10, cy: 700, x: 10, y: 700 }]);
    expect(tickGestures(g, GESTURE.holdMs * 2)).toEqual([]);
    expect(types(fingerUp(g, 1, 10, 700, 100))).toEqual(['stick', 'stickEnd']);
    expect(types(fingerUp(g, 2, 300, 200, 100))).toEqual([]);

    const top = createGestures(2);
    fingerDown(top, 1, 10, 100, 0, 'look');
    expect(fingerDown(top, 2, 300, 200, 40, 'look')).toEqual([]);
    expect(types(fingerUp(top, 1, 10, 100, 100))).toEqual([]); // neither taps nor walks
  });

  it('two fingers in the bottom half: one joystick, the other looks', () => {
    const g = createGestures(2);
    fingerDown(g, 1, 100, 700, 0, 'stick');
    fingerMove(g, 1, 100, 660);
    expect(fingerDown(g, 2, 300, 700, 10, 'stick')).toEqual([]);
    expect(types(fingerMove(g, 2, 320, 700))).toEqual(['look']);
  });
});

describe('cancel', () => {
  it('stops walking and fires nothing else', () => {
    const g = createGestures(2);
    fingerDown(g, 1, 0, 0, 0, 'stick');
    fingerMove(g, 1, 40, 0);
    expect(fingerCancel(g, 1)).toEqual([{ type: 'stickEnd' }]);
    expect(fingerUp(g, 1, 40, 0, 50)).toEqual([]);
  });

  it('a cancelled press neither taps nor holds', () => {
    const g = createGestures(2);
    fingerDown(g, 1, 0, 0, 0, 'stick');
    tickGestures(g, GESTURE.holdMs);
    expect(fingerCancel(g, 1)).toEqual([]);
    expect(fingerUp(g, 1, 0, 0, 100)).toEqual([]);
  });

  it('cancelAll lets go of every finger', () => {
    const g = createGestures(2);
    fingerDown(g, 1, 0, 0, 0, 'stick');
    fingerMove(g, 1, 40, 0);
    fingerDown(g, 2, 100, 0, 5, 'stick');
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
