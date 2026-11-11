import { describe, expect, it } from 'vitest';
import { cardPlace, pickSpot, stageChange, toVisual } from './tourSpot';
import { stepsFor, type Track } from './tourSteps';

const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height });

describe("the tour's spotlight (#408)", () => {
  it('scales a rect an engine reports unzoomed (WebKit inside the UI scale) to where it is drawn', () => {
    // a 44 px button at 300,10 inside a 115% pocket: drawn at 345,11.5, 50.6 wide
    expect(toVisual(box(300, 10, 44, 44), 100, 1.15)).toEqual(box(345, 11.5, 50.6, 50.6));
  });

  it('keeps a rect an engine already reports zoomed (Chromium), and any rect at 100%', () => {
    expect(toVisual(box(345, 11.5, 50.6, 50.6), 115, 1.15)).toEqual(box(345, 11.5, 50.6, 50.6));
    expect(toVisual(box(300, 10, 44, 44), 100, 1)).toEqual(box(300, 10, 44, 44));
  });

  it("never rings a control inside the tour's own card, nor one something covers", () => {
    const tabs = box(0, 760, 390, 84);
    expect(pickSpot([{ box: box(250, 700, 100, 44), inCard: true, covered: false }, { box: tabs, inCard: false, covered: false }])).toEqual(tabs);
    expect(pickSpot([{ box: tabs, inCard: false, covered: true }])).toBeNull();
    expect(pickSpot([{ box: box(0, 0, 0, 0), inCard: false, covered: false }])).toBeNull();
  });

  it('moves the card clear of a target low on the screen, and centres it when its target is nowhere', () => {
    expect(cardPlace(box(0, 760, 390, 84), true, 844)).toBe('top');
    expect(cardPlace(box(300, 10, 44, 44), true, 844)).toBe('bottom');
    expect(cardPlace(null, true, 844)).toBe('center');
    expect(cardPlace(null, false, 844)).toBe('bottom'); // a step about no control (the 3D walk-through)
  });
});

describe("the tour's pages (#408)", () => {
  it('opens the page a step is about, keeps it across steps on it, and puts the first page back after', () => {
    expect(stageChange(undefined, 'chat')).toEqual({ restore: false, open: 'chat' });
    expect(stageChange('chat', 'chat')).toEqual({ restore: false, open: null });
    expect(stageChange('chat', 'charter')).toEqual({ restore: false, open: 'charter' });
    expect(stageChange('charter', undefined)).toEqual({ restore: true, open: null });
    expect(stageChange(undefined, undefined)).toEqual({ restore: false, open: null });
  });

  it('takes the manager to the chat for its header buttons and to the console for its sections, on every track', () => {
    for (const track of ['phone', 'desk', 'office'] as Track[]) {
      const page = Object.fromEntries(stepsFor(track).map((s) => [s.id, s.page]));
      expect(page['chat-full'], track).toBe('chat');
      expect(page['chat-charts'], track).toBe('chat');
      expect(page.charter, track).toBe('charter');
      expect(page.costs, track).toBe('costs');
    }
  });

  it("points the console step at the console's way in, never at ⓘ", () => {
    const console = stepsFor('phone').find((s) => s.id === 'console')!;
    expect(console.targets?.[0]).toBe('console');
    expect(console.targets).not.toContain('info');
  });
});
