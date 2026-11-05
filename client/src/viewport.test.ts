import { describe, expect, it } from 'vitest';
import { appViewport, blocksPinch, insetsCovered } from './viewport';

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
