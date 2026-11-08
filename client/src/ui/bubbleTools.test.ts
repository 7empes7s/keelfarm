import { describe, expect, it } from 'vitest';
import { toolsOffset } from './bubbleTools';

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
    expect(toolsOffset(-400, 140, log)).toBe(500);
  });
  it('clamps a partially scrolled row to the top of the log', () => {
    expect(toolsOffset(70, 92, log)).toBe(30);
  });
});
