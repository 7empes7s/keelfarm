import { describe, expect, it } from 'vitest';
import { barFit } from './viewerBar';

// The phone's toolbar row as the preview viewer measures it on a 390 px iPhone (pocket mode's UI scale applied).
const PHONE = 315;

describe('barFit', () => {
  it('puts Mobile | Desktop in full on an upright phone, Reload in ⋯', () => {
    expect(barFit(PHONE, ['widths', 'reload'])).toEqual({ widths: 'full', side: 'menu', reload: 'menu' });
  });
  it('shows the toggle as icons on a small phone', () => {
    expect(barFit(280, ['widths', 'reload'])).toEqual({ widths: 'compact', side: 'menu', reload: 'menu' });
  });
  it('lets Reload join the bar on a wider phone or sideways', () => {
    expect(barFit(480, ['widths', 'reload'])).toEqual({ widths: 'full', side: 'menu', reload: 'full' });
  });
  it('keeps compare’s side switch in the bar first, the toggle in ⋯ when both don’t fit', () => {
    expect(barFit(PHONE, ['widths', 'side', 'reload'])).toEqual({ widths: 'menu', side: 'full', reload: 'menu' });
    expect(barFit(450, ['widths', 'side', 'reload'])).toEqual({ widths: 'full', side: 'full', reload: 'menu' });
  });
  it('sends what fits nowhere into ⋯', () => {
    expect(barFit(200, ['widths', 'side', 'reload'])).toEqual({ widths: 'menu', side: 'menu', reload: 'menu' });
    expect(barFit(0, ['widths'])).toEqual({ widths: 'menu', side: 'menu', reload: 'menu' });
  });
  it('never shows an action that was not wanted (Full screen picked: no widths)', () => {
    expect(barFit(1000, ['reload'])).toEqual({ widths: 'menu', side: 'menu', reload: 'full' });
  });
  it('never fills more than the row', () => {
    const px = { widths: { full: 162, compact: 100 }, side: { full: 130, compact: 100 }, reload: { full: 110, compact: 110 } };
    for (let w = 0; w <= 900; w += 7) {
      const fit = barFit(w, ['widths', 'side', 'reload']);
      const used = 144 + (Object.keys(fit) as (keyof typeof fit)[]).reduce((n, a) => n + (fit[a] === 'menu' ? 0 : px[a][fit[a] as 'full' | 'compact']), 0);
      expect(used <= Math.max(w, 144)).toBe(true);
    }
  });
});
