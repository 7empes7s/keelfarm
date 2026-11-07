// Whether the manager is using this tab (#210): it tells the office when it goes on or off screen, and while on screen
// at most every INPUT_GAP_MS that it's being used, so no device is notified meanwhile (server/notify.ts inApp). A voice
// call (#287) says so too: nothing is notified during it, even with the phone locked.
import type { ClientEvent } from '../../shared/types';
import { callOn } from './ui/voiceCallStore';

/** Input reported at most this often: well inside the office's 60 s "in the app" window. */
export const INPUT_GAP_MS = 20_000;

interface Last {
  visible: boolean;
  at: number;
  call?: boolean;
}

/** What to tell the office now, or null: a visibility or call change always, input only once per gap. */
export function attentionUpdate(visible: boolean, now: number, last: Last | null, input: boolean, call = false): ClientEvent | null {
  const msg: ClientEvent = { type: 'attention', visible, ...(call && { call: true as const }) };
  if (!last || last.visible !== visible || !!last.call !== call) return msg;
  if (input && visible && now - last.at >= INPUT_GAP_MS) return msg;
  return null;
}

let last: Last | null = null;

/** Reports this tab's attention through `send` (false while disconnected); call it on (re)connect too. */
export function report(send: (msg: ClientEvent) => boolean, input = false, fresh = false) {
  if (fresh) last = null;
  const visible = document.visibilityState === 'visible';
  const now = Date.now();
  const call = callOn();
  const msg = attentionUpdate(visible, now, last, input, call);
  if (msg && send(msg)) last = { visible, at: now, call };
}

/** Listens for visibility and input, reporting through `send`. */
export function watchAttention(send: (msg: ClientEvent) => boolean) {
  document.addEventListener('visibilitychange', () => report(send));
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, () => report(send, true), { passive: true, capture: true });
}
