import { describe, expect, it } from 'vitest';
import { desktopFit, DESKTOP_PX, realFullscreen, showRotateHint, viewerLayout, type ViewerScreen, type Width } from './desktopView';

const IPHONE: ViewerScreen = { width: 'desktop', phone: true, landscape: false, forced: false, platform: 'ios', canFullscreen: false };
const ANDROID: ViewerScreen = { ...IPHONE, platform: 'android', canFullscreen: true };

describe('viewerLayout', () => {
  it('keeps the viewer on an upright phone, whatever the width', () => {
    for (const width of ['desktop', 'tablet', 'phone'] as Width[]) {
      expect(viewerLayout({ ...IPHONE, width })).toBe('viewer');
      expect(viewerLayout({ ...ANDROID, width })).toBe('viewer');
    }
  });

  it('goes edge to edge on a phone turned sideways on Desktop width only', () => {
    expect(viewerLayout({ ...IPHONE, landscape: true })).toBe('edge');
    expect(viewerLayout({ ...ANDROID, landscape: true })).toBe('fullscreen');
    expect(viewerLayout({ ...IPHONE, landscape: true, width: 'phone' })).toBe('viewer');
    expect(viewerLayout({ ...ANDROID, landscape: true, width: 'tablet' })).toBe('viewer');
  });

  it('never goes edge to edge on its own on a computer or tablet held sideways', () => {
    expect(viewerLayout({ ...ANDROID, phone: false, landscape: true, platform: 'desktop' })).toBe('viewer');
  });

  it('⋯ Full screen goes edge to edge either way up, at any width', () => {
    expect(viewerLayout({ ...IPHONE, forced: true, width: 'phone' })).toBe('edge');
    expect(viewerLayout({ ...ANDROID, forced: true })).toBe('fullscreen');
    expect(viewerLayout({ ...ANDROID, forced: true, phone: false, platform: 'desktop' })).toBe('fullscreen');
  });

  it('falls back to the in-page layout without the Fullscreen API', () => {
    expect(viewerLayout({ ...ANDROID, landscape: true, canFullscreen: false })).toBe('edge');
  });
});

describe('realFullscreen', () => {
  it('is never used on iOS, even where an API shows up', () => {
    expect(realFullscreen('ios', true)).toBe(false);
    expect(realFullscreen('android', true)).toBe(true);
    expect(realFullscreen('android', false)).toBe(false);
    expect(realFullscreen('desktop', true)).toBe(true);
  });
});

describe('showRotateHint', () => {
  const upright = { width: 'desktop' as Width, phone: true, landscape: false };
  it('shows once Desktop is picked on an upright phone, until seen', () => {
    expect(showRotateHint(upright, true, false)).toBe(true);
    expect(showRotateHint(upright, true, true)).toBe(false);
    expect(showRotateHint(upright, false, false)).toBe(false);
  });
  it('not sideways, not at other widths, not on a computer', () => {
    expect(showRotateHint({ ...upright, landscape: true }, true, false)).toBe(false);
    expect(showRotateHint({ ...upright, width: 'phone' }, true, false)).toBe(false);
    expect(showRotateHint({ ...upright, phone: false }, true, false)).toBe(false);
  });
});

describe('desktopFit', () => {
  it('lays a landscape iPhone out desktop-wide and scales it to the screen', () => {
    const f = desktopFit(844, 390);
    expect(f.width).toBe(DESKTOP_PX);
    expect(f.scale).toBeCloseTo(844 / 1280);
    expect(f.height).toBe(Math.round(390 / (844 / 1280)));
    expect(f.width * f.scale).toBeCloseTo(844);
  });
  it('leaves a box at least desktop-wide as it is, and an unmeasured one empty', () => {
    expect(desktopFit(1440, 900)).toEqual({ width: 1440, height: 900, scale: 1 });
    expect(desktopFit(0, 0)).toEqual({ width: 0, height: 0, scale: 1 });
  });
});
