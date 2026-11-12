import { describe, expect, it } from 'vitest';
import { foldedBadge, foldTools, LIGHT_UNDER, NAME_ROOM, TOOL_ORDER, TOOL_SLOT, type ChatToolId } from './chatToolFold';

const ALL: ChatToolId[] = [...TOOL_ORDER];
// the docked chat's row: the dock less its padding (20), its ✕ (44) and the gap (8)
const docked = (dock: number) => dock - 72;

describe("the chat header's folding (#270)", () => {
  it('keeps 🔍, files and call docked at 380 px, folding 📊, Aa, ⛶ and hands-free first (#588)', () => {
    expect(foldTools(docked(380), ALL)).toEqual({ shown: ['search', 'files', 'call'], folded: ['charts', 'text', 'full', 'handsFree', 'it'] });
    expect(foldTools(docked(360), ALL).shown).toEqual(['search', 'files']);
    expect(foldTools(docked(330), ALL).shown).toEqual(['search', 'files']);
  });

  it("leaves the CEO's avatar and a six-letter name whole beside the buttons and ⋯ (#514: the 3D phone cut it to Morg…)", () => {
    const AVATAR = 28 + 8; // the avatar and its gap
    const BUTTON = 44 + 8; // a tool or the ⋯, and its gap
    for (let w = 260; w < 800; w += 2) expect(w - AVATAR - (foldTools(w, ALL).shown.length + 1) * BUTTON, `at ${w}px`).toBeGreaterThanOrEqual(64);
  });

  it('keeps only 🔍, files and call under 720 px, even with room for more (#588: nine buttons were heavy)', () => {
    for (let w = 300; w < LIGHT_UNDER; w += 10) expect(foldTools(w, ALL).shown.length, `at ${w}px`).toBeLessThanOrEqual(3);
    expect(foldTools(docked(660), ALL).shown).toEqual(['search', 'files', 'call']);
  });

  it('shows every tool on a very wide header', () => {
    expect(foldTools(LIGHT_UNDER + 40, ALL)).toEqual({ shown: ALL, folded: [] });
  });

  it('folds the least used first, one per button of room lost', () => {
    const at = (w: number) => foldTools(w, ALL).shown.length;
    for (let w = 200; w < 800; w += 10) expect(at(w + TOOL_SLOT)).toBeGreaterThanOrEqual(at(w));
    expect(at(NAME_ROOM + TOOL_SLOT * 4)).toBe(3);
  });

  it('only counts the tools there are, in their order, and always keeps 🔍', () => {
    expect(foldTools(LIGHT_UNDER, ['call', 'text', 'search', 'charts'])).toEqual({ shown: ['search', 'call', 'charts', 'text'], folded: [] });
    expect(foldTools(366, ['call', 'text', 'search', 'charts'])).toEqual({ shown: ['search', 'call', 'charts'], folded: ['text'] });
    expect(foldTools(40, ALL).shown).toEqual(['search']);
    expect(foldTools(0, ALL).shown).toEqual(['search', 'files', 'call']); // before it's measured
  });

  it("carries a folded tool's badge to the ⋯, and none when it shows", () => {
    expect(foldedBadge(foldTools(150, ALL).folded, { files: 89 })).toBe(89);
    expect(foldedBadge(foldTools(docked(380), ALL).folded, { files: 89 })).toBe(0);
  });
});
