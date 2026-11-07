// The saved accessibility and comfort settings (localStorage `cubefarm:a11y`): captions, the status palette and shapes,
// motion comfort, UI scale and readability. Pure, so old, partial or corrupt values are tested without a browser. The
// defaults are exactly the office as it was, so nothing changes for anyone until they pick something.

import { PALETTES, type Palette } from './statusLook';
import { CHAT_TEXT, snapText } from './chatPinch';

export type ReduceMotion = 'system' | 'on' | 'off';
export const REDUCE_MOTION: readonly ReduceMotion[] = ['system', 'on', 'off'];

export interface A11yPrefs {
  /** Captions for spoken messages and important sounds. */
  captions: boolean;
  /** Caption text size, percent of normal. */
  captionSize: number;
  /** Caption background opacity, percent. */
  captionBg: number;
  palette: Palette;
  /** A shape or icon beside every status colour. */
  statusShapes: boolean;
  /** Vertical field of view, degrees. */
  fov: number;
  headBob: boolean;
  /** Camera sway: the head tilting back for a sip, and any screen shake. */
  cameraShake: boolean;
  /** 'system' follows the operating system's prefers-reduced-motion. */
  reduceMotion: ReduceMotion;
  /** A fixed dot in the middle of the view, which helps against motion sickness. */
  centerDot: boolean;
  /** HUD, phone, console and panels, percent. */
  uiScale: number;
  /** The chat's messages, the artifact and file readers, percent (#135): pinch in the chat, or Settings. */
  chatText: number;
  /** A plainer, wider-spaced font in the panels, easier to read with dyslexia. */
  readableFont: boolean;
  highContrast: boolean;
}

export const LIMITS = {
  captionSize: { min: 75, max: 200, step: 5 },
  captionBg: { min: 0, max: 100, step: 5 },
  fov: { min: 60, max: 100, step: 1 },
  uiScale: { min: 80, max: 150, step: 5 },
  chatText: CHAT_TEXT,
} as const;

export const DEFAULT_A11Y: A11yPrefs = {
  captions: false,
  captionSize: 100,
  captionBg: 75,
  palette: 'standard',
  statusShapes: false,
  fov: 72, // the camera's own field of view (world/Game.tsx)
  headBob: true,
  cameraShake: true,
  reduceMotion: 'system',
  centerDot: false,
  uiScale: 100,
  chatText: 100,
  readableFont: false,
  highContrast: false,
};

/** UI scale on touch screens with nothing saved: buttons and labels big enough for a thumb. */
export const TOUCH_UI_SCALE = 115;

/** The defaults for this device: the office as it was, with a bigger UI scale on a touch screen, the chat text at the phone's own text size. */
export const defaultA11y = (touch = false, chatText = 100): A11yPrefs => ({ ...DEFAULT_A11Y, uiScale: touch ? TOUCH_UI_SCALE : 100, chatText: snapText(chatText) });

type NumberKey = keyof typeof LIMITS;

/** A number in its range, snapped to its step, or the fallback when it's missing, not a number or out of range. */
function inRange(key: NumberKey, v: unknown, base: A11yPrefs): number {
  const { min, max, step } = LIMITS[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) return base[key];
  return Math.min(max, Math.max(min, min + Math.round((v - min) / step) * step));
}

const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

/** Any saved value as complete, valid prefs: each bad field falls back to its default (`base`'s) on its own. */
export function normalizeA11yPrefs(raw: unknown, base: A11yPrefs = DEFAULT_A11Y): A11yPrefs {
  const p = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    captions: bool(p.captions, base.captions),
    captionSize: inRange('captionSize', p.captionSize, base),
    captionBg: inRange('captionBg', p.captionBg, base),
    palette: PALETTES.includes(p.palette as Palette) ? (p.palette as Palette) : base.palette,
    statusShapes: bool(p.statusShapes, base.statusShapes),
    fov: inRange('fov', p.fov, base),
    headBob: bool(p.headBob, base.headBob),
    cameraShake: bool(p.cameraShake, base.cameraShake),
    reduceMotion: REDUCE_MOTION.includes(p.reduceMotion as ReduceMotion) ? (p.reduceMotion as ReduceMotion) : base.reduceMotion,
    centerDot: bool(p.centerDot, base.centerDot),
    uiScale: inRange('uiScale', p.uiScale, base),
    chatText: inRange('chatText', p.chatText, base),
    readableFont: bool(p.readableFont, base.readableFont),
    highContrast: bool(p.highContrast, base.highContrast),
  };
}

/** The prefs saved as JSON text (null when nothing is saved); `touch` picks a touch screen's defaults, `chatText` the system's text size. */
export function parseA11yPrefs(text: string | null, touch = false, chatText = 100): A11yPrefs {
  const base = defaultA11y(touch, chatText);
  try {
    return normalizeA11yPrefs(JSON.parse(text ?? 'null'), base);
  } catch {
    return base;
  }
}

/** Whether to cut non-essential motion: the setting, or with 'system', the operating system's preference. */
export const reducesMotion = (pref: ReduceMotion, systemPrefersReduced: boolean) => pref === 'on' || (pref === 'system' && systemPrefersReduced);

/** Status shapes show when asked for, and always with a colour-blind palette (colour alone is what it's there to fix). */
export const showsShapes = (p: Pick<A11yPrefs, 'statusShapes' | 'palette'>) => p.statusShapes || p.palette !== 'standard';
