import { describe, expect, it } from 'vitest';
import { focusRaises, raiseIn, wrapIndex } from './dialogFocus';

describe('wrapIndex', () => {
  it('steps forward and back through a dialog, wrapping at the ends', () => {
    expect(wrapIndex(0, 3, false)).toBe(1);
    expect(wrapIndex(2, 3, false)).toBe(0);
    expect(wrapIndex(0, 3, true)).toBe(2);
    expect(wrapIndex(1, 3, true)).toBe(0);
  });

  it('brings focus from outside the dialog to its first control, or its last going back', () => {
    expect(wrapIndex(-1, 4, false)).toBe(0);
    expect(wrapIndex(-1, 4, true)).toBe(3);
  });

  it('has nowhere to go in a dialog without controls', () => {
    expect(wrapIndex(-1, 0, false)).toBe(-1);
  });
});

describe('raiseIn (#212)', () => {
  it('moves a dialog or back layer to the top, so Esc and Back close the one last touched', () => {
    const list = ['console', 'terminal', 'card'];
    expect(raiseIn(list, 'console')).toBe(true);
    expect(list).toEqual(['terminal', 'card', 'console']);
    expect(raiseIn(list, 'console')).toBe(false);
    expect(raiseIn(list, 'missing')).toBe(false);
    expect(list).toEqual(['terminal', 'card', 'console']);
  });
});

describe('focusRaises (#212)', () => {
  it('raises a panel for focus inside it, not for focus in a sheet portaled out of it', () => {
    const inside = {};
    const panel = { contains: (n: unknown) => n === inside } as Pick<Node, 'contains'>;
    expect(focusRaises(panel, inside as Node)).toBe(true);
    expect(focusRaises(panel, {} as Node)).toBe(false); // the ⓘ sheet in document.body
    expect(focusRaises(null, inside as Node)).toBe(false);
  });
});
