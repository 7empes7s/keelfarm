// The preview viewer's desktop view on a phone (#131), pure: which layout an orientation, width choice and platform
// get, when the "turn your phone sideways" hint shows, and how a desktop-wide page is scaled to fit the screen.
import type { Platform } from './notifySteps';

export type Width = 'desktop' | 'tablet' | 'phone';

/** The CSS px a desktop-width preview is laid out at before it's scaled down to the screen. */
export const DESKTOP_PX = 1280;

/** `viewer`: the normal viewer; `edge`: edge to edge in the page; `fullscreen`: edge to edge in the Fullscreen API. */
export type ViewerLayout = 'viewer' | 'edge' | 'fullscreen';

export interface ViewerScreen {
  width: Width;
  /** A phone-sized screen, either way up. */
  phone: boolean;
  landscape: boolean;
  /** ⋯ Full screen was picked. */
  forced: boolean;
  platform: Platform;
  /** document.fullscreenEnabled: iPhones have no element fullscreen. */
  canFullscreen: boolean;
}

/** Whether the browser's own fullscreen is used: iOS (Safari, Chrome, the home-screen app) has none for pages. */
export function realFullscreen(platform: Platform, canFullscreen: boolean): boolean {
  return platform !== 'ios' && canFullscreen;
}

/** A phone turned sideways on Desktop width, or ⋯ Full screen, goes edge to edge; everything else is the viewer. */
export function viewerLayout(s: ViewerScreen): ViewerLayout {
  const immersive = s.forced || (s.phone && s.landscape && s.width === 'desktop');
  if (!immersive) return 'viewer';
  return realFullscreen(s.platform, s.canFullscreen) ? 'fullscreen' : 'edge';
}

/** The hint shows on a phone held upright once Desktop is picked, until it has been seen once. */
export function showRotateHint(s: Pick<ViewerScreen, 'width' | 'phone' | 'landscape'>, picked: boolean, seen: boolean): boolean {
  return picked && !seen && s.phone && !s.landscape && s.width === 'desktop';
}

/** A desktop-wide page in a `w` x `h` box: laid out `width` x `height` CSS px, then scaled by `scale` to fill it. */
export function desktopFit(w: number, h: number, desktop = DESKTOP_PX): { width: number; height: number; scale: number } {
  if (w <= 0 || h <= 0 || w >= desktop) return { width: Math.max(0, Math.round(w)), height: Math.max(0, Math.round(h)), scale: 1 };
  const scale = w / desktop;
  return { width: desktop, height: Math.round(h / scale), scale };
}
