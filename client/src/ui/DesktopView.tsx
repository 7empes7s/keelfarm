// The preview viewer's desktop view on a phone (#131): turned sideways on Desktop width (or ⋯ Full screen) the viewer
// goes edge to edge, the page laid out desktop-wide and scaled to the screen, with a floating ‹ Back / ✕ and ⋯ that
// hide after 3 s. Android uses the Fullscreen API; iPhones have none for pages, so they get the same layout without it.
// The rules are pure, in desktopRules.ts.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { pushLayer } from './backStack';
import { Icon } from './Icon';
import { desktopFit, realFullscreen, showRotateHint, viewerLayout, type Width } from './desktopRules';
import { platformOf } from './notifySteps';

const HINT_KEY = 'cubefarm:rotate-hint-seen';
const HIDE_MS = 3000;

function hintSeen() {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

/** Whether a media query matches, kept up to date. */
export function useMedia(query: string) {
  const [on, setOn] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const change = () => setOn(m.matches);
    change();
    m.addEventListener('change', change);
    return () => m.removeEventListener('change', change);
  }, [query]);
  return on;
}

const canFullscreen = () => typeof document !== 'undefined' && document.fullscreenEnabled === true && typeof document.documentElement.requestFullscreen === 'function';

/** Asks for the browser's fullscreen; a refusal (no tap behind it, or no support) leaves the in-page layout. */
function goFullscreen(lock: boolean) {
  if (document.fullscreenElement) return;
  document.documentElement
    .requestFullscreen({ navigationUI: 'hide' })
    .then(() => (lock ? (screen.orientation as { lock?: (o: string) => Promise<void> }).lock?.('landscape') : undefined))
    .catch(() => undefined);
}

/** The viewer's layout for this screen and width, ⋯ Full screen, the rotate hint, and the browser's fullscreen. */
export function useDesktopView(width: Width, phone: boolean) {
  const landscape = useMedia('(orientation: landscape)');
  const [forced, setForced] = useState(false);
  const [picked, setPicked] = useState(false); // Desktop was picked in this viewer: the hint's moment
  const [seen, setSeen] = useState(hintSeen);
  const [platform] = useState(() => platformOf(navigator.userAgent, navigator.maxTouchPoints));
  const can = canFullscreen();
  const real = realFullscreen(platform, can);
  const layout = viewerLayout({ width, phone, landscape, forced, platform, canFullscreen: can });
  const immersive = layout !== 'viewer';
  const hint = showRotateHint({ width, phone, landscape }, picked, seen);

  const dismissHint = () => {
    setSeen(true);
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      // private mode: it shows again next time
    }
  };
  // Turned sideways with the hint up: it did its job.
  useEffect(() => {
    if (immersive && picked && !seen) dismissHint();
  }, [immersive, picked, seen]);

  // Turned sideways the browser may refuse fullscreen (a rotation isn't a tap): the in-page layout stays either way.
  // Leaving the layout (turned upright, Back) leaves fullscreen.
  useEffect(() => {
    if (layout !== 'fullscreen') return;
    if (!forced) goFullscreen(false);
    return () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      (screen.orientation as { unlock?: () => void } | undefined)?.unlock?.();
    };
  }, [layout, forced]);
  // The browser's own way out of fullscreen (Android's Back, Esc) ends ⋯ Full screen too.
  useEffect(() => {
    if (!forced) return;
    const change = () => !document.fullscreenElement && real && setForced(false);
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, [forced, real]);
  // ⋯ Full screen is the top layer: the back gesture leaves it before it closes the viewer.
  useEffect(() => (forced ? pushLayer(() => setForced(false)) : undefined), [forced]);

  // Pinch zoom and pan, which the office locks on touch screens (viewport.ts), are the page's while edge to edge.
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!immersive || !meta) return;
    const was = meta.content;
    meta.content = was.replace(/,\s*(maximum-scale=1|user-scalable=no)/g, '');
    return () => void (meta.content = was);
  }, [immersive]);

  return {
    layout,
    immersive,
    forced,
    hint,
    dismissHint,
    pickedDesktop: () => setPicked(true),
    enterFull: () => {
      dismissHint();
      setForced(true);
      if (real) goFullscreen(true); // straight from the tap: browsers want one behind it
    },
    leaveFull: () => setForced(false),
  };
}

/** The style that lays a stage out desktop-wide and scales it to its box, while `on`. */
export function useDesktopFit(on: boolean) {
  const [box, setBox] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!on || !box) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(box);
    return () => ro.disconnect();
  }, [on, box]);
  const fit = desktopFit(size.w, size.h);
  const style = on ? ({ '--fit-w': `${fit.width}px`, '--fit-h': `${fit.height}px`, '--fit-scale': fit.scale } as CSSProperties) : undefined;
  return { ref: setBox, style };
}

/** "Turn your phone sideways", over the preview after Desktop is picked on an upright phone. */
export function RotateHint({ onDismiss, onFull }: { onDismiss: () => void; onFull: () => void }) {
  return (
    <div className="app-rotate" role="status">
      <span className="app-rotate-icon" aria-hidden>
        <Icon name="smartphone" />
      </span>
      <p>Turn your phone sideways for the desktop view</p>
      <div className="row">
        <button className="btn btn-small" onClick={onFull}>
          ⛶ Full screen
        </button>
        <button className="btn btn-small btn-good" onClick={onDismiss}>
          Got it
        </button>
      </div>
    </div>
  );
}

/**
 * The floating ‹ Back (⋯ Full screen) or ✕ (turned sideways) and the ⋯ menu. They fade after 3 s; a tap on them then
 * only brings them back. They stay while their menu is open.
 */
export function FloatingBar({ forced, onBack, onClose, menu }: { forced: boolean; onBack: () => void; onClose: () => void; menu: ReactNode }) {
  const [shown, setShown] = useState(true);
  const bar = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const wasHidden = useRef(false);
  const wake = () => {
    setShown(true);
    clearTimeout(timer.current);
    const hide = () => (bar.current?.querySelector('[aria-expanded="true"]') ? (timer.current = window.setTimeout(hide, HIDE_MS)) : setShown(false));
    timer.current = window.setTimeout(hide, HIDE_MS);
  };
  useEffect(() => {
    wake();
    return () => clearTimeout(timer.current);
  }, []);
  return (
    <div
      ref={bar}
      className={`app-float ${shown ? '' : 'app-float-hidden'}`}
      onPointerDownCapture={() => {
        wasHidden.current = !shown;
        wake();
      }}
      onClickCapture={(e) => {
        if (!wasHidden.current) return;
        wasHidden.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
      onFocusCapture={wake}
    >
      {forced ? (
        <button className="btn btn-small app-float-btn" onClick={onBack} aria-label="Leave full screen">
          ‹ Back
        </button>
      ) : (
        <button className="btn btn-small app-float-btn" onClick={onClose} aria-label="Close">
          <Icon name="x" />
        </button>
      )}
      <span className="spacer" />
      {menu}
    </div>
  );
}
