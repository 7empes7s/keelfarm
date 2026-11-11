import { describe, expect, it } from 'vitest';
import { foldedBadge, foldTools, NAME_ROOM, TOOL_ORDER, TOOL_SLOT, type ChatToolId } from './chatToolFold';

const ALL: ChatToolId[] = [...TOOL_ORDER];
// the docked chat's row: the dock less its padding (20), its ✕ (44) and the gap (8)
const docked = (dock: number) => dock - 72;

describe("the chat header's folding (#270)", () => {
  it('keeps 🔍, 📊 and ⛶ docked at 380 px, and only 🔍 and 📊 on narrower docks', () => {
    expect(foldTools(docked(380), ALL)).toEqual({ shown: ['search', 'charts', 'full'], folded: ['files', 'text', 'call', 'handsFree'] });
    expect(foldTools(docked(360), ALL).shown).toEqual(['search', 'charts']);
    expect(foldTools(docked(330), ALL).shown).toEqual(['search', 'charts']);
  });

  it("leaves the CEO's avatar and a six-letter name whole beside the buttons and ⋯ (#514: the 3D phone cut it to Morg…)", () => {
    const AVATAR = 28 + 8; // the avatar and its gap
    const BUTTON = 44 + 8; // a tool or the ⋯, and its gap
    for (let w = 260; w < 800; w += 2) expect(w - AVATAR - (foldTools(w, ALL).shown.length + 1) * BUTTON, `at ${w}px`).toBeGreaterThanOrEqual(64);
  });

  it('shows every tool on a wide dock (the threads column beside it)', () => {
    expect(foldTools(docked(660), ALL)).toEqual({ shown: ALL, folded: [] });
  });

  it('folds the least used first, one per button of room lost', () => {
    const at = (w: number) => foldTools(w, ALL).shown.length;
    for (let w = 200; w < 800; w += 10) expect(at(w + TOOL_SLOT)).toBeGreaterThanOrEqual(at(w));
    expect(at(NAME_ROOM + TOOL_SLOT * 5)).toBe(4);
  });

  it('only counts the tools there are, in their order, and always keeps 🔍', () => {
    expect(foldTools(366, ['call', 'text', 'search', 'charts'])).toEqual({ shown: ['search', 'charts', 'text', 'call'], folded: [] });
    expect(foldTools(40, ALL).shown).toEqual(['search']);
    expect(foldTools(0, ALL).shown).toEqual(['search', 'charts', 'full']); // before it's measured
  });

  it("carries a folded tool's badge to the ⋯, and none when it shows", () => {
    expect(foldedBadge(foldTools(docked(380), ALL).folded, { files: 89 })).toBe(89);
    expect(foldedBadge(foldTools(docked(660), ALL).folded, { files: 89 })).toBe(0);
  });
});
