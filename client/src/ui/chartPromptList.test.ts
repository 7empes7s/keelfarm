import { describe, expect, it } from 'vitest';
import { CHART_GROUPS, chartSuggestions, iconFor, parsePins, togglePin } from './chartPromptList';

describe("the chat's 📊 Charts (#270)", () => {
  it('offers the ready prompts in their groups', () => {
    expect(CHART_GROUPS.map((g) => g.title)).toEqual(['Money', 'Work', 'Server', 'Usage']);
    expect(CHART_GROUPS[0].prompts[0].text).toBe('Where did the money go this week?');
  });

  it('pins to the top, unpins, and reads only sound saved pins', () => {
    const pins = togglePin(togglePin([], 'Waste by cause'), 'Backlog by floor');
    expect(pins).toEqual(['Backlog by floor', 'Waste by cause']);
    expect(togglePin(pins, 'Waste by cause')).toEqual(['Backlog by floor']);
    expect(parsePins(JSON.stringify(pins))).toEqual(pins);
    expect(parsePins('{oops')).toEqual([]);
    expect(parsePins(null)).toEqual([]);
    expect(parsePins(JSON.stringify(['a', 'a', 3, ' ']))).toEqual(['a']);
  });

  it("offers the CEO's chart suggestions to pin, with a chart icon", () => {
    expect(chartSuggestions(['Show the cost per merge trend', 'Yes, go ahead'])).toEqual(['Show the cost per merge trend']);
    expect(iconFor('Show the cost per merge trend')).toBe('chart-column');
    expect(iconFor('Waste by cause')).toBe('trash-2');
  });
});
