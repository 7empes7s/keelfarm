import { describe, expect, it } from 'vitest';
import { placeToasts, TOAST_GAP, type Box, type ToastSpace } from './toastPlace';

const none = { top: 0, right: 0, bottom: 0, left: 0 };
const boxOf = (p: { left: number; top: number }, s: ToastSpace): Box => ({ left: p.left, top: p.top, right: p.left + s.width, bottom: p.top + s.height });
const hits = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

describe('placeToasts', () => {
  it('stacks top right under the header on a computer', () => {
    const header: Box = { left: 0, top: 0, right: 1280, bottom: 56 };
    const s: ToastSpace = { vw: 1280, vh: 800, width: 360, height: 80, safe: none, avoid: [header] };
    expect(placeToasts(s)).toMatchObject({ left: 1280 - TOAST_GAP - 360, top: 56 + TOAST_GAP });
  });

  it('never covers an open panel’s header or its tab row (#230: Settings with a toast on it)', () => {
    const appHeader: Box = { left: 0, top: 0, right: 1280, bottom: 56 };
    const panelHead: Box = { left: 140, top: 60, right: 1140, bottom: 120 };
    const tabs: Box = { left: 140, top: 120, right: 1140, bottom: 172 };
    const s: ToastSpace = { vw: 1280, vh: 800, width: 360, height: 140, safe: none, avoid: [appHeader, panelHead, tabs] };
    const placed = boxOf(placeToasts(s), s);
    for (const b of s.avoid) expect(hits(placed, b)).toBe(false);
    expect(placed.top).toBe(172 + TOAST_GAP);
  });

  it('keeps left of the docked CEO chat and inside the safe areas', () => {
    const safe = { top: 47, right: 20, bottom: 34, left: 0 };
    const s: ToastSpace = { vw: 1400, vh: 900, width: 360, height: 80, safe, dockLeft: 1000, avoid: [] };
    const p = placeToasts(s);
    expect(p.left + s.width).toBeLessThanOrEqual(1000 - TOAST_GAP);
    expect(p.top).toBe(47 + TOAST_GAP);
  });

  // #521: a phone banner, never from the bottom over the composer and the tab bar (#107 started them there)
  for (const [vw, vh] of [
    [390, 844],
    [1280, 800],
  ]) {
    it(`drops in at the top under the safe area and the header, never at the bottom (${vw} px)`, () => {
      const header: Box = { left: 0, top: 0, right: vw, bottom: 100 };
      const composer: Box = { left: 0, top: vh - 144, right: vw, bottom: vh - 84 };
      const tabBar: Box = { left: 0, top: vh - 84, right: vw, bottom: vh - 34 };
      const safe = { top: 47, right: 0, bottom: 34, left: 0 };
      const s: ToastSpace = { vw, vh, width: Math.min(420, vw - 2 * TOAST_GAP), height: 70, safe, avoid: [header, composer, tabBar] };
      const p = placeToasts(s);
      expect(p.top).toBe(100 + TOAST_GAP);
      expect(p.room).toBe(composer.top - TOAST_GAP - p.top);
      for (const b of s.avoid) expect(hits(boxOf(p, s), b)).toBe(false);
      if (vw === 390) expect([p.left, p.left + s.width]).toEqual([TOAST_GAP, vw - TOAST_GAP]);
      else expect(p.left + s.width).toBe(vw - TOAST_GAP);
    });
  }

  it('never steps down mid-screen to dodge something: it stays under the header', () => {
    const header: Box = { left: 0, top: 0, right: 390, bottom: 100 };
    const card: Box = { left: 0, top: 110, right: 390, bottom: 500 };
    const s: ToastSpace = { vw: 390, vh: 844, width: 366, height: 70, safe: none, avoid: [header, card] };
    const p = placeToasts(s);
    expect(p.top).toBe(100 + TOAST_GAP);
    expect(p.room, 'no room above the card: they wait').toBe(0);
  });

  it('keeps clear of the field being typed in, in the part of the page the keyboard leaves', () => {
    // iOS scrolled the page 300px under a 400px keyboard; the composer sits on it
    const field: Box = { left: 0, top: 640, right: 390, bottom: 700 };
    const s: ToastSpace = { vw: 390, vh: 444, viewTop: 300, width: 366, height: 160, safe: none, avoid: [field] };
    const p = placeToasts(s);
    expect(p.top).toBe(300 + TOAST_GAP);
    expect(p.top + p.room).toBe(640 - TOAST_GAP);
  });

  it('skips past a header and tab row side by side to the first free spot', () => {
    const s: ToastSpace = { vw: 1280, vh: 800, width: 360, height: 120, safe: none, avoid: [{ left: 0, top: 0, right: 1280, bottom: 56 }, { left: 900, top: 60, right: 1280, bottom: 110 }, { left: 700, top: 100, right: 1000, bottom: 150 }] };
    const placed = boxOf(placeToasts(s), s);
    for (const b of s.avoid) expect(hits(placed, b)).toBe(false);
    expect(placed.top).toBe(150 + TOAST_GAP);
  });
});
