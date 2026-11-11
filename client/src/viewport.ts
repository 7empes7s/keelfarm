// The phone's viewport, page-wide (#73): the visible height (keyboard and browser bars taken off) as --app-height and
// --app-top for every full-screen view, put back when the keyboard closes or the app comes back, the zoom lock on touch
// screens, and which browsers misreport the safe areas. The rules are pure and tested; watchViewport() wires them up.
import { keyboardInset } from '../../shared/termKeys';

/** What the page sees of the visual viewport. */
export interface Viewport {
  height: number;
  offsetTop: number;
  scale: number;
}

/** The CSS px the full-screen views get: the visible part of the page, and where it starts. */
export function appViewport(innerHeight: number, vv: Viewport | null): { height: number; top: number } {
  // Pinch zoom (if a browser lets it through) shrinks the visual viewport without changing the room the layout has.
  if (!vv || Math.abs(vv.scale - 1) > 0.01) return { height: Math.round(innerHeight), top: 0 };
  return { height: Math.round(vv.height), top: Math.max(0, Math.round(vv.offsetTop)) };
}

/**
 * The 3D office's phone on a phone screen (#297): its overlay's box in CSS px under the UI scale (the root's zoom), the
 * visible part of the page, so the message box sits right on the keyboard. `band` keeps the strip of dimmed office above
 * it (a tap there puts the phone away); full screen and the keyboard drop it, every px going to the chat.
 */
export function chatDock(innerHeight: number, vv: Viewport | null, uiScale: number, full: boolean): { top: number; height: number; band: boolean } {
  const { height, top } = appViewport(innerHeight, vv);
  // the visible part 80px or more short of the page, wherever iOS scrolled it to (#507: scrolled right down to the
  // message box, nothing seemed to be under it)
  const keyboard = !!vv && Math.abs(vv.scale - 1) <= 0.01 && keyboardInset(innerHeight, { height: vv.height, offsetTop: 0 }) > 0;
  return { top: top / uiScale, height: height / uiScale, band: !full && !keyboard };
}

/** Whether a touch move is a pinch to block: two fingers or more, anywhere but a terminal (it zooms its own text). */
export function blocksPinch(touches: number, inTerminal: boolean): boolean {
  return touches > 1 && !inTerminal;
}

/**
 * Whether the browser's own toolbars sit over the page's top and bottom edges while it reports the phone's notch and
 * home bar anyway: iOS browsers other than Safari, in a tab (Chrome iOS 26 padded the header and the tabs twice).
 */
export function insetsCovered(userAgent: string, standalone: boolean): boolean {
  return !standalone && /\b(CriOS|FxiOS|EdgiOS|OPiOS)\//.test(userAgent);
}

/** A field that brings up the keyboard: a textarea, an editable box, or an input you type into (not a checkbox). */
function isTextField(el: Element | null): boolean {
  if (!el) return false;
  if (el.matches('textarea, [contenteditable=""], [contenteditable="true"]')) return true;
  return el.matches('input') && !/^(button|checkbox|color|file|hidden|image|radio|range|reset|submit)$/.test((el as HTMLInputElement).type);
}

/**
 * Whether the manager is typing on a touch screen (#152: pocket mode hides its tab bar then, so the composer gets the
 * room): the keyboard is up (the visible part 80px or more short of the page), or a text field has focus (Android with
 * interactive-widget=resizes-content shrinks the page itself, so the heights match).
 */
export function typing(touch: boolean, innerHeight: number, visibleHeight: number, textFieldFocused: boolean): boolean {
  return touch && (textFieldFocused || visibleHeight < innerHeight - 80);
}

/**
 * How far to scroll a box so `target` (a field, or the field with its send button) sits inside `view`, the part of the
 * box the keyboard leaves visible, `margin` px clear of its edges; a target taller than the view shows its top.
 */
export function revealDelta(target: { top: number; bottom: number }, view: { top: number; bottom: number }, margin = 8): number {
  const top = view.top + margin;
  const bottom = view.bottom - margin;
  if (target.bottom > bottom) return Math.min(target.bottom - bottom, target.top - top);
  if (target.top < top) return target.top - top;
  return 0;
}

/** Re-checks after a field gains focus (ms): iOS's last resize can come before the keyboard settles, or never. */
const SETTLE_MS = [100, 300, 600, 1000];

/** The focused field, if it brings up the keyboard. */
function focusedField(): HTMLElement | null {
  const el = document.activeElement;
  return el instanceof HTMLElement && isTextField(el) ? el : null;
}

/** The nearest box around `el` that scrolls (never the page itself). */
function scrollBox(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    if (p.scrollHeight > p.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(p).overflowY)) return p;
  }
  return null;
}

/** Scrolls the focused field (with its form or message box, when they fit) into the visible part of its scrolling box. */
function revealFocused() {
  const field = focusedField();
  const box = field && scrollBox(field);
  if (!field || !box) return;
  const vv = window.visualViewport;
  const r = box.getBoundingClientRect();
  const view = { top: Math.max(r.top, vv?.offsetTop ?? 0), bottom: Math.min(r.bottom, (vv?.offsetTop ?? 0) + (vv?.height ?? window.innerHeight)) };
  const group = field.closest<HTMLElement>('form, .chat-input');
  const block = group && box.contains(group) ? group.getBoundingClientRect() : null;
  const delta = revealDelta(block && block.height <= view.bottom - view.top - 16 ? block : field.getBoundingClientRect(), view);
  if (delta) box.scrollTop += delta;
}

/** Tells the full-screen views the viewport changed and stray scrolls were put back (the chat sticks to its end). */
export const VIEWPORT_EVENT = 'cubefarm:viewport';

/** Overflow-hidden boxes the browser may scroll to show a focused field, and leave scrolled after the keyboard closes. */
const CLIPPED = '.pocket, .pk-main-chat, .phone-chat, .phone-screen';

/**
 * Puts the page back where it belongs: the window at the top, no hidden scroll in the shell. Never while a field has
 * focus (#494): that would undo the browser's scroll to it; its focusout puts things back.
 */
export function resetViewport() {
  if (!focusedField()) {
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
    for (const el of document.querySelectorAll<HTMLElement>(CLIPPED)) if (el.scrollTop || el.scrollLeft) el.scrollTo(0, 0);
  }
  window.dispatchEvent(new Event(VIEWPORT_EVENT));
}

/** The home-screen app: no browser chrome, so no Back button of its own. */
export function standalone() {
  return matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** Keeps --app-height / --app-top up to date and the zoom locked on touch screens; call once at startup. */
export function watchViewport() {
  const root = document.documentElement;
  const vv = window.visualViewport;
  let frame = 0;
  let keyboard = false;
  const touch = matchMedia('(pointer: coarse)').matches;
  let measured = ''; // the visible part's height and top, last measured
  const update = () => {
    frame = 0;
    const { height, top } = appViewport(window.innerHeight, vv);
    measured = `${height} ${top}`;
    root.style.setProperty('--app-height', `${height}px`);
    root.style.setProperty('--app-top', `${top}px`);
    const open = height < window.innerHeight - 80; // smaller differences are browser bars, not a keyboard
    if (keyboard && !open) resetViewport(); // the keyboard just closed: nothing stays where it pushed it
    keyboard = open;
    if (typing(touch, window.innerHeight, height, isTextField(document.activeElement))) root.setAttribute('data-typing', '');
    else root.removeAttribute('data-typing');
    if (insetsCovered(navigator.userAgent, standalone())) root.setAttribute('data-insets-covered', '');
    else root.removeAttribute('data-insets-covered');
  };
  const later = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  const reset = () => {
    update();
    resetViewport();
  };
  // A field with the keyboard up (#494): measure again until the keyboard has settled, then bring the field into view.
  let checks: number[] = [];
  const check = (first: boolean) => {
    const before = measured;
    update();
    if (measured !== before) window.dispatchEvent(new Event(VIEWPORT_EVENT));
    if (first || measured !== before) revealFocused();
  };
  const settle = () => {
    checks.forEach(clearTimeout);
    checks = touch && focusedField() ? SETTLE_MS.map((ms, i) => window.setTimeout(() => check(i === 0), ms)) : [];
  };
  update();
  vv?.addEventListener('resize', later);
  vv?.addEventListener('resize', settle);
  document.addEventListener('focusin', settle);
  vv?.addEventListener('scroll', later);
  window.addEventListener('resize', later);
  window.addEventListener('orientationchange', () => setTimeout(reset, 300)); // iOS reports the new size late
  window.addEventListener('pageshow', reset);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reset());
  document.addEventListener('focusin', later); // data-typing
  // A field losing focus to something that isn't another field: the keyboard is going away.
  document.addEventListener('focusout', (e) => {
    later();
    if (!(e.relatedTarget instanceof HTMLElement && e.relatedTarget.matches('input, textarea, select'))) setTimeout(reset, 250);
  });

  // The zoom lock (touch screens only, so a trackpad pinch and ctrl +/- still zoom on a computer). iOS ignores
  // user-scalable=no, so its pinch gestures and two-finger moves are cancelled here as well.
  if (!touch) return;
  const stop = (e: Event) => e.preventDefault();
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, stop, { passive: false });
  document.addEventListener(
    'touchmove',
    (e) => {
      // A terminal zooms its own text; the preview's desktop view (#131) is the page's to zoom.
      if (blocksPinch(e.touches.length, e.target instanceof Element && e.target.closest('.xterm, .panel-app-immersive') !== null)) e.preventDefault();
    },
    { passive: false },
  );
}
