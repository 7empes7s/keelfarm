import { describe, expect, it } from 'vitest';
import type { Agent, KanbanCard } from '../store';
import { drawLiftedNote, kanbanNoteRect } from './draw';
import { BOARD_TEX } from './whiteboard';

// A canvas that measures text at 9px a character and records what's written where (and how it's aligned).
function fakeCanvas() {
  const texts: { text: string; x: number; y: number; align: string; width: number }[] = [];
  const state: Record<string, unknown> = { textAlign: 'left', canvas: { width: 600, height: 400 } };
  const ctx = new Proxy(state, {
    get(t, k: string) {
      if (k === 'measureText') return (s: string) => ({ width: s.length * 9 });
      if (k === 'fillText')
        return (s: string, x: number, y: number) => texts.push({ text: s, x, y, align: String(t.textAlign), width: s.length * 9 });
      if (k in t) return t[k];
      return () => ({ addColorStop: () => undefined });
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts };
}

describe('a sticky on the 3D board (#232)', () => {
  it('writes the name and the note on one line without one running over the other or off the note', () => {
    const { w, h } = kanbanNoteRect(0, 0, BOARD_TEX.w);
    const agent = { name: 'Dennis-the-very-long-named', color: '#3366cc' } as Agent;
    const card: KanbanCard = { key: 'pr-1', number: 221, prNumber: 221, title: 'A title', agent, note: 'QA passed · re-running a failed check (ubuntu-latest)' };
    const { ctx, texts } = fakeCanvas();
    drawLiftedNote(ctx, card, 'qa', w, h, 0, 1);
    const row = texts.filter((t) => t.y === h - 14);
    expect(row).toHaveLength(2);
    const [name, note] = row.map((t) => (t.align === 'right' ? { left: t.x - t.width, right: t.x } : { left: t.x, right: t.x + t.width }));
    expect(name.right).toBeLessThanOrEqual(note.left);
    expect(note.right).toBeLessThanOrEqual(w);
    expect(row[1].text.endsWith('…')).toBe(true);
  });
});
