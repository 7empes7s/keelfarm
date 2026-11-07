// Whether the manager is using this tab (#210): it tells the office when it goes on or off screen, and while on screen
// at most every INPUT_GAP_MS that it's being used, so no device is notified meanwhile (server/notify.ts inApp).
import type { ClientEvent } from '../../shared/types';

/** Input reported at most this often: well inside the office's 60 s "in the app" window. */
export const INPUT_GAP_MS = 20_000;

/** What to tell the office now, or null: a visibility change always, input only once per gap. */
export function attentionUpdate(visible: boolean, now: number, last: { visible: boolean; at: number } | null, input: boolean): ClientEvent | null {
  if (!last || last.visible !== visible) return { type: 'attention', visible };
  if (input && visible && now - last.at >= INPUT_GAP_MS) return { type: 'attention', visible };
  return null;
}

let last: { visible: boolean; at: number } | null = null;

/** Reports this tab's attention through `send` (false while disconnected); call it on (re)connect too. */
export function report(send: (msg: ClientEvent) => boolean, input = false, fresh = false) {
  if (fresh) last = null;
  const visible = document.visibilityState === 'visible';
  const now = Date.now();
  const msg = attentionUpdate(visible, now, last, input);
  if (msg && send(msg)) last = { visible, at: now };
}

/** Listens for visibility and input, reporting through `send`. */
export function watchAttention(send: (msg: ClientEvent) => boolean) {
  document.addEventListener('visibilitychange', () => report(send));
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, () => report(send, true), { passive: true, capture: true });
}
