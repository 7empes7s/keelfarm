import { describe, expect, it } from 'vitest';
import { placeToasts, TOAST_GAP, toastsFrom, type Box, type ToastSpace } from './toastPlace';

const none = { top: 0, right: 0, bottom: 0, left: 0 };
const boxOf = (p: { left: number; top: number }, s: ToastSpace): Box => ({ left: p.left, top: p.top, right: p.left + s.width, bottom: p.top + s.height });
const hits = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

describe('placeToasts', () => {
  it('stacks top right under the header on a computer', () => {
    const header: Box = { left: 0, top: 0, right: 1280, bottom: 56 };
    const s: ToastSpace = { vw: 1280, vh: 800, width: 360, height: 80, from: 'top', safe: none, avoid: [header] };
    expect(placeToasts(s)).toEqual({ left: 1280 - TOAST_GAP - 360, top: 56 + TOAST_GAP });
  });

  it('never covers an open panel’s header or its tab row (#230: Settings with a toast on it)', () => {
    const appHeader: Box = { left: 0, top: 0, right: 1280, bottom: 56 };
    const panelHead: Box = { left: 140, top: 60, right: 1140, bottom: 120 };
    const tabs: Box = { left: 140, top: 120, right: 1140, bottom: 172 };
    const s: ToastSpace = { vw: 1280, vh: 800, width: 360, height: 140, from: 'top', safe: none, avoid: [appHeader, panelHead, tabs] };
    const placed = boxOf(placeToasts(s), s);
    for (const b of s.avoid) expect(hits(placed, b)).toBe(false);
    expect(placed.top).toBe(172 + TOAST_GAP);
  });

  it('keeps left of the docked CEO chat and inside the safe areas', () => {
    const safe = { top: 47, right: 20, bottom: 34, left: 0 };
    const s: ToastSpace = { vw: 1400, vh: 900, width: 360, height: 80, from: 'top', safe, dockLeft: 1000, avoid: [] };
    const p = placeToasts(s);
    expect(p.left + s.width).toBeLessThanOrEqual(1000 - TOAST_GAP);
    expect(p.top).toBe(47 + TOAST_GAP);
  });

  it('sits over the composer and the tab bar on a phone, never under the header', () => {
    const header: Box = { left: 0, top: 0, right: 390, bottom: 100 };
    const composer: Box = { left: 0, top: 700, right: 390, bottom: 760 };
    const tabBar: Box = { left: 0, top: 760, right: 390, bottom: 810 };
    const s: ToastSpace = { vw: 390, vh: 844, width: 366, height: 70, from: toastsFrom(390), safe: { top: 47, right: 0, bottom: 34, left: 0 }, avoid: [header, composer, tabBar] };
    const p = placeToasts(s);
    expect(p.top + s.height).toBe(700 - TOAST_GAP);
    for (const b of s.avoid) expect(hits(boxOf(p, s), b)).toBe(false);
  });

  it('skips past a header and tab row side by side to the first free spot', () => {
    const s: ToastSpace = { vw: 1280, vh: 800, width: 360, height: 120, from: 'top', safe: none, avoid: [{ left: 0, top: 0, right: 1280, bottom: 56 }, { left: 900, top: 60, right: 1280, bottom: 110 }, { left: 700, top: 100, right: 1000, bottom: 150 }] };
    const placed = boxOf(placeToasts(s), s);
    for (const b of s.avoid) expect(hits(placed, b)).toBe(false);
    expect(placed.top).toBe(150 + TOAST_GAP);
  });
});
