import { describe, expect, it } from 'vitest';
import { EMPTY_NUMBERS } from '../../ops';
import { drawTickerStrip, tickerStripWidth } from './themeDraw';
import { tickerQuotes } from './ticker';

/** A 2D context that notes the text drawn and where, measuring a monospace font like a browser does (0.6 em a character). */
function recorder() {
  const drawn: { text: string; x: number; right: number }[] = [];
  let font = '10px mono';
  const size = () => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10);
  const measureText = (t: string) => ({ width: [...t].length * 0.6 * size() });
  const ctx = {
    fillStyle: '',
    textBaseline: '',
    textAlign: '',
    get font() {
      return font;
    },
    set font(f: string) {
      font = f;
    },
    fillRect() {},
    measureText,
    fillText(text: string, x: number) {
      drawn.push({ text, x, right: x + measureText(text).width });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn };
}

describe('the ticker strip', () => {
  const { quotes } = tickerQuotes({ ...EMPTY_NUMBERS, mergedToday: 12, mergedHour: 2, qaPass: 0.83, costToday: 31.4, ciPass: 0.97 }, 14);
  const label = 'FLOOR 3 · RECIPE-BOX-ORGANIZER';

  it('draws every quote on the texture the floor uses, a long floor name and all', () => {
    const { ctx, drawn } = recorder();
    drawTickerStrip(ctx, 2048, 64, quotes, label);
    const texts = drawn.map((d) => d.text);
    for (const s of ['MRG', 'QA', 'CPM', 'OPEN', 'CI', 'SHIP']) expect(texts, s).toContain(s);
    expect(texts.some((t) => t.startsWith('14 PRs'))).toBe(true);
  });

  it('sizes the texture to everything it draws, so nothing runs off its end', () => {
    const { ctx, drawn } = recorder();
    const w = tickerStripWidth(ctx, quotes, label, 64);
    drawTickerStrip(ctx, w, 64, quotes, label);
    expect(Math.max(...drawn.map((d) => d.right))).toBeLessThanOrEqual(w);
  });
});
