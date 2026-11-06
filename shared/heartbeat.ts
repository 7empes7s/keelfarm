// Keeping /ws alive through a phone's background (#93): the office sends every tab a beat, and a tab that hears
// nothing for a while (iOS leaves a suspended app's socket half-open, with no close) reconnects at once, which brings
// a fresh snapshot. Pure: client/src/net.ts asks these on resume and on its watchdog tick.

/** How often the office sends each tab `{ type: 'beat' }`. */
export const BEAT_MS = 15_000;
/** Back from the background (visible, pageshow, online, focus): silence this long means the socket is gone. */
export const RESUME_STALE_MS = 20_000;
/** In the foreground: two missed beats and a bit, so a busy server doesn't make idle tabs churn. */
export const DEAD_MS = 2 * BEAT_MS + 5_000;
/** A connect that hasn't opened in this long is stuck (a resumed phone can leave one hanging). */
export const CONNECTING_MS = 10_000;

export interface SocketLook {
  /** WebSocket.readyState: 0 connecting, 1 open, 2 closing, 3 closed (or no socket yet). */
  readyState: number;
  /** When the current socket started connecting. */
  startedAt: number;
  /** When it last opened or brought a message (0: never). */
  heardAt: number;
}

/** True when the socket can't be trusted to bring the office's events within `limit` ms of silence. */
export function socketStale(s: SocketLook, now: number, limit: number): boolean {
  if (s.readyState === 0) return now - s.startedAt > CONNECTING_MS;
  if (s.readyState !== 1) return true;
  return now - s.heardAt > limit;
}

/** What to do when the app comes back to the foreground: reconnect now (no backoff wait) or leave a live socket be. */
export const onResume = (s: SocketLook, now: number): 'reconnect' | 'none' => (socketStale(s, now, RESUME_STALE_MS) ? 'reconnect' : 'none');

/**
 * The foreground watchdog: an open or connecting socket gone quiet is replaced. A closed one is left to its pending
 * retry (onclose's backoff, and the office's restart), so this never adds a second reconnect on top of it.
 */
export const onTick = (s: SocketLook, now: number): 'reconnect' | 'none' => (s.readyState <= 1 && socketStale(s, now, DEAD_MS) ? 'reconnect' : 'none');
