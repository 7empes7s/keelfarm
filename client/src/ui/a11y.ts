// The accessibility settings in this browser (a11yPrefs.ts has the rules): a small store the settings page, the HUD
// and the 3D view read, and the page-wide part applied to <html> as data attributes and CSS variables (UI scale,
// readable font, high contrast, status palette and shapes, reduced motion). Per-frame code calls the plain getters.
// window.__swarmA11y shows the settings and what they come to, and set() changes them, for QA and e2e.

import { create } from 'zustand';
import { defaultA11y, normalizeA11yPrefs, parseA11yPrefs, reducesMotion, showsShapes, type A11yPrefs } from './a11yPrefs';
import { systemText } from './chatPinch';
import { paletteVars, PALETTE_VAR_NAMES, type StatusLook } from './statusLook';

const KEY = 'cubefarm:a11y';
const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

/** A touch screen starts with a bigger UI scale (a11yPrefs.ts defaultA11y). */
const touch = typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;

/** The phone's own text size (iOS Dynamic Type), read once: where the chat's text size starts (#135). */
function systemBodyPx(): number | null {
  try {
    const probe = document.createElement('span');
    probe.style.font = '-apple-system-body';
    if (!probe.style.font) return null; // not an Apple browser
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    document.body.append(probe);
    const px = parseFloat(getComputedStyle(probe).fontSize);
    probe.remove();
    return px;
  } catch {
    return null;
  }
}

const chatTextStart = typeof document === 'undefined' || !document.body ? 100 : systemText(systemBodyPx());
const defaults = () => defaultA11y(touch, chatTextStart);

function load(): A11yPrefs {
  try {
    return parseA11yPrefs(localStorage.getItem(KEY), touch, chatTextStart);
  } catch {
    return defaults();
  }
}

const systemReduced = () => typeof matchMedia === 'function' && matchMedia(REDUCED_QUERY).matches;

interface A11yState {
  prefs: A11yPrefs;
  /** The operating system asks for reduced motion. */
  systemReduced: boolean;
}

export const useA11y = create<A11yState>(() => ({ prefs: typeof window === 'undefined' ? defaultA11y() : load(), systemReduced: typeof window !== 'undefined' && systemReduced() }));

export const getA11y = () => useA11y.getState().prefs;

/** Whether non-essential motion is cut right now (the setting, or the system's preference). */
export const reduceMotion = () => {
  const { prefs, systemReduced } = useA11y.getState();
  return reducesMotion(prefs.reduceMotion, systemReduced);
};

/** The status palette and shapes, for the canvases (whiteboard, name tags). */
export const statusLook = (p: A11yPrefs = getA11y()): StatusLook => ({ palette: p.palette, shapes: showsShapes(p) });

/** Changes some settings and saves them in this browser. */
export function setA11y(patch: Partial<A11yPrefs>) {
  const prefs = normalizeA11yPrefs({ ...getA11y(), ...patch }, defaults());
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // storage may be unavailable (private mode); the setting lasts for this visit
  }
  useA11y.setState({ prefs });
}

export const resetA11y = () => setA11y(defaults());

// ---------- the page ----------

/** Writes the page-wide settings onto <html>; with the defaults it sets nothing at all. */
function applyToPage({ prefs, systemReduced }: A11yState) {
  const root = document.documentElement;
  const flag = (name: string, on: boolean) => (on ? root.setAttribute(name, '') : root.removeAttribute(name));
  flag('data-reduce-motion', reducesMotion(prefs.reduceMotion, systemReduced));
  flag('data-readable-font', prefs.readableFont);
  flag('data-high-contrast', prefs.highContrast);
  flag('data-status-shapes', showsShapes(prefs));
  if (prefs.palette === 'standard') root.removeAttribute('data-palette');
  else root.setAttribute('data-palette', prefs.palette);
  const vars = paletteVars(prefs.palette);
  for (const name of PALETTE_VAR_NAMES) {
    if (vars[name]) root.style.setProperty(name, vars[name]);
    else root.style.removeProperty(name);
  }
  flag('data-ui-scale', prefs.uiScale !== 100);
  if (prefs.uiScale === 100) root.style.removeProperty('--ui-scale');
  else root.style.setProperty('--ui-scale', String(prefs.uiScale / 100));
  setChatTextVar(prefs.chatText);
}

/** The chat's text size on the page; a live pinch sets it every frame and saves it with setA11y when the fingers lift. */
export function setChatTextVar(percent: number) {
  const root = document.documentElement;
  if (percent === 100) root.style.removeProperty('--chat-text');
  else root.style.setProperty('--chat-text', String(percent / 100));
}

if (typeof window !== 'undefined') {
  applyToPage(useA11y.getState());
  useA11y.subscribe(applyToPage);
  try {
    matchMedia(REDUCED_QUERY).addEventListener('change', (e) => useA11y.setState({ systemReduced: e.matches }));
  } catch {
    // older browsers: the system setting is read once at load
  }
  // Another tab changed the settings.
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) useA11y.setState({ prefs: parseA11yPrefs(e.newValue, touch, chatTextStart) });
  });
  Object.defineProperty(window, '__swarmA11y', {
    configurable: true,
    enumerable: false,
    value: {
      get prefs() {
        return getA11y();
      },
      get reduceMotion() {
        return reduceMotion();
      },
      get statusLook() {
        return statusLook();
      },
      set: setA11y,
      reset: resetA11y,
    },
  });
}
