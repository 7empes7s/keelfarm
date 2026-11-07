import { describe, expect, it } from 'vitest';
import { closePanel, closeSlot, DOCK_DEFAULT, dockWidth, focusPanel, layerOf, noPanels, openPanel, topPanel, type PanelEntry, type Panels } from './panels';

const p = (key: string, slot = key): PanelEntry<string> => ({ key, slot, label: key, value: key });
const keys = (s: Panels) => s.open.map((x) => x.key);
const start: Panels<string> = noPanels;

describe('the panel manager (#212)', () => {
  it('puts what opens last on top', () => {
    const s = openPanel(openPanel(start, p('console', 'main')), p('terminal:ada', 'pane'));
    expect(keys(s)).toEqual(['console', 'terminal:ada']);
    expect(topPanel(s)?.key).toBe('terminal:ada');
    expect(layerOf(s, 'main')).toBe(1);
    expect(layerOf(s, 'pane')).toBe(2);
    expect(layerOf(s, 'nowhere')).toBe(0);
  });

  it('brings a panel that is already open back to the top when it opens again', () => {
    const s = openPanel(openPanel(openPanel(start, p('console', 'main')), p('card', 'pane')), p('console', 'main'));
    expect(keys(s)).toEqual(['card', 'console']);
    expect(s.back).toBeNull();
  });

  it('focus raises an open panel and ignores unknown ones', () => {
    const s = openPanel(openPanel(start, p('console', 'main')), p('card', 'pane'));
    expect(keys(focusPanel(s, 'console'))).toEqual(['card', 'console']);
    expect(focusPanel(s, 'card')).toBe(s);
    expect(focusPanel(s, 'nope')).toBe(s);
  });

  it('a panel in a taken slot replaces what was there and leaves a back chip', () => {
    const s = openPanel(openPanel(openPanel(start, p('console', 'main')), p('terminal:ada', 'pane')), p('card:7', 'pane'));
    expect(keys(s)).toEqual(['console', 'card:7']);
    expect(s.back?.key).toBe('terminal:ada');
    // the back chip reopens it, which swaps them round
    const back = openPanel(s, s.back!);
    expect(keys(back)).toEqual(['console', 'terminal:ada']);
    expect(back.back?.key).toBe('card:7');
  });

  it('past the most panels beside the chat, the oldest goes and leaves the back chip', () => {
    const s = openPanel(openPanel(openPanel(start, p('a')), p('b')), p('c'));
    expect(keys(s)).toEqual(['b', 'c']);
    expect(s.back?.key).toBe('a');
    expect(keys(openPanel(s, p('d'), 3))).toEqual(['b', 'c', 'd']);
  });

  it('closes the top panel only, or the one named', () => {
    const s = openPanel(openPanel(start, p('console', 'main')), p('card', 'pane'));
    expect(keys(closePanel(s))).toEqual(['console']);
    expect(keys(closePanel(s, 'console'))).toEqual(['card']);
    expect(closePanel(start)).toBe(start);
    expect(keys(closeSlot(s, 'pane'))).toEqual(['console']);
  });

  it('closing the slot the back chip came from drops the chip', () => {
    const s = openPanel(openPanel(start, p('terminal:ada', 'pane')), p('card', 'pane'));
    expect(closePanel(s).back).toBeNull();
    expect(closeSlot(s, 'pane').back).toBeNull();
    expect(closeSlot(openPanel(s, p('console', 'main')), 'main').back?.key).toBe('terminal:ada');
  });
});

describe('the docked chat width', () => {
  it('stays between 360 and 520 px and falls back to the default', () => {
    expect(dockWidth(450)).toBe(450);
    expect(dockWidth('300')).toBe(360);
    expect(dockWidth(900)).toBe(520);
    expect(dockWidth(412.6)).toBe(413);
    expect([null, undefined, '', 'wide', NaN].map(dockWidth)).toEqual(Array(5).fill(DOCK_DEFAULT));
  });
});
