import { describe, expect, it } from 'vitest';
import { appViewport, blocksPinch, chatDock, insetsCovered, typing } from './viewport';

describe('appViewport', () => {
  it('is the visible part of the page: the keyboard and the browser bars taken off', () => {
    expect(appViewport(844, { height: 844, offsetTop: 0, scale: 1 })).toEqual({ height: 844, top: 0 });
    expect(appViewport(844, { height: 508.4, offsetTop: 0, scale: 1 })).toEqual({ height: 508, top: 0 });
  });

  it('follows the visible part when iOS scrolls the page under the keyboard', () => {
    expect(appViewport(844, { height: 500, offsetTop: 120, scale: 1 })).toEqual({ height: 500, top: 120 });
  });

  it('ignores a pinch zoom and a missing visualViewport', () => {
    expect(appViewport(844, { height: 300, offsetTop: 200, scale: 2.5 })).toEqual({ height: 844, top: 0 });
    expect(appViewport(700, null)).toEqual({ height: 700, top: 0 });
  });
});

describe('chatDock', () => {
  const vv = (height: number, offsetTop = 0, scale = 1) => ({ height, offsetTop, scale });
  it('docks under the band, the whole screen tall, with no keyboard', () => {
    expect(chatDock(844, vv(844), 1, false)).toEqual({ top: 0, height: 844, band: true });
    expect(chatDock(844, vv(800), 1, false)).toEqual({ top: 0, height: 800, band: true }); // browser bars, not a keyboard
  });
  it('ends on the keyboard and drops the band while it is up', () => {
    expect(chatDock(844, vv(508), 1, false)).toEqual({ top: 0, height: 508, band: false });
    // iOS scrolled the visual viewport down to the field: the box follows it
    expect(chatDock(844, vv(460, 40), 1, false)).toEqual({ top: 40, height: 460, band: false });
  });
  it('fills the visible screen in full screen', () => {
    expect(chatDock(844, vv(844), 1, true)).toEqual({ top: 0, height: 844, band: false });
    expect(chatDock(844, vv(508), 1, true)).toEqual({ top: 0, height: 508, band: false });
  });
  it('divides by the UI scale, which zooms the page', () => {
    expect(chatDock(844, vv(508, 20), 1.25, false)).toEqual({ top: 16, height: 406.4, band: false });
  });
  it('keeps the page size under pinch zoom and without a visual viewport', () => {
    expect(chatDock(844, vv(400, 100, 2), 1, false)).toEqual({ top: 0, height: 844, band: true });
    expect(chatDock(844, null, 1, false)).toEqual({ top: 0, height: 844, band: true });
  });
});

describe('blocksPinch', () => {
  it('blocks two fingers or more outside a terminal, never one finger', () => {
    expect(blocksPinch(2, false)).toBe(true);
    expect(blocksPinch(3, false)).toBe(true);
    expect(blocksPinch(1, false)).toBe(false);
    expect(blocksPinch(2, true)).toBe(false);
  });
});

describe('insetsCovered', () => {
  const chromeIos = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/157.0.0.0 Mobile/15E148 Safari/604.1';
  const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
  it("is Chrome iOS and the like in a tab, where the toolbars cover the notch and the home bar", () => {
    expect(insetsCovered(chromeIos, false)).toBe(true);
    expect(insetsCovered(chromeIos.replace('CriOS', 'FxiOS'), false)).toBe(true);
  });
  it('is never Safari or the home-screen app: their safe areas are real', () => {
    expect(insetsCovered(safari, false)).toBe(false);
    expect(insetsCovered(chromeIos, true)).toBe(false);
    expect(insetsCovered(safari, true)).toBe(false);
  });
});

describe('typing', () => {
  it('is a touch screen with the keyboard up or a text field focused', () => {
    expect(typing(true, 844, 508, false)).toBe(true); // iOS: the visual viewport shrinks under the keyboard
    expect(typing(true, 508, 508, true)).toBe(true); // Android resizing the page itself: the focus tells
    expect(typing(true, 844, 800, false)).toBe(false); // browser bars, not a keyboard
    expect(typing(true, 844, 844, false)).toBe(false);
    expect(typing(false, 844, 508, true)).toBe(false); // a computer keeps its tabs
  });
});
