import { describe, expect, it } from 'vitest';
import { attentionUpdate, INPUT_GAP_MS } from './attention';

describe("a tab's attention (#210)", () => {
  it('reports going on or off screen at once, and input at most once per gap', () => {
    expect(attentionUpdate(true, 0, null, false)).toEqual({ type: 'attention', visible: true });
    expect(attentionUpdate(false, 10, { visible: true, at: 0 }, false)).toEqual({ type: 'attention', visible: false });
    expect(attentionUpdate(true, 1000, { visible: true, at: 0 }, true)).toBeNull();
    expect(attentionUpdate(true, INPUT_GAP_MS, { visible: true, at: 0 }, true)).toEqual({ type: 'attention', visible: true });
    expect(attentionUpdate(false, INPUT_GAP_MS, { visible: false, at: 0 }, true)).toBeNull(); // input in a hidden tab isn't the manager
  });

  it('reports a voice call starting and ending at once (#287), and keeps saying so with the tab hidden', () => {
    expect(attentionUpdate(true, 1000, { visible: true, at: 0 }, false, true)).toEqual({ type: 'attention', visible: true, call: true });
    expect(attentionUpdate(false, 2000, { visible: true, at: 1000, call: true }, false, true)).toEqual({ type: 'attention', visible: false, call: true });
    expect(attentionUpdate(true, 3000, { visible: true, at: 2000, call: true }, false, true)).toBeNull();
    expect(attentionUpdate(true, 4000, { visible: true, at: 3000, call: true }, false, false)).toEqual({ type: 'attention', visible: true });
  });
});
