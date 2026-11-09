import { describe, expect, it } from 'vitest';
import { toolsInRow, toolsOffset } from './bubbleTools';

describe('bubble tool placement', () => {
  const log = { top: 100, bottom: 700 };
  it('starts at the bubble top when there is room', () => {
    expect(toolsOffset(200, 140, log)).toBe(0);
    expect(toolsOffset(560, 140, log)).toBe(0);
  });
  it('keeps the last action above the composer at the log bottom', () => {
    expect(toolsOffset(620, 140, log)).toBe(-60);
  });
  it('keeps every action visible when a tall bubble extends past both log edges', () => {
    expect(toolsOffset(-400, 140, log, 1200)).toBe(500);
  });
  it('clamps a partially scrolled row to the top of the log', () => {
    expect(toolsOffset(70, 92, log)).toBe(30);
  });
  it('leaves a row scrolled out of the log alone, so scrolling to it converges', () => {
    expect(toolsOffset(4000, 140, log, 4400)).toBe(0);
    expect(toolsOffset(-500, 140, log, 100)).toBe(0);
  });
  it('lays the stack down as a row only when the log is shorter than it', () => {
    expect(toolsInRow(140, 83)).toBe(true);
    expect(toolsInRow(140, 140)).toBe(false);
    expect(toolsInRow(92, 300)).toBe(false);
  });
});
