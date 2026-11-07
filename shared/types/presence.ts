// Presence: everyone viewing the office appears in it as a visitor, and the browser's messages on /ws. Imported through shared/types.ts.
import type { Watch } from './events.ts';

// ---------- presence: everyone viewing the office appears in it as a visitor ----------

/** Someone else in the 3D office (a tab or device that entered it and appears to others). */
export interface VisitorView {
  id: string;
  name: string; // cleaned by the server (shared/presence.ts cleanName)
  color: string; // #rrggbb
  floor: number; // 0 = lobby, -1 = the roof
}

/** What a visitor carries, as the others draw it. `s`: a mug's sips left (0–3). */
export interface VisitorHeld {
  k: 'ball' | 'mug' | 'blaster';
  id: string;
  s?: number;
}

/**
 * Where a visitor stands: floor, position (metres), heading (yaw, 0 facing -Z), look pitch and what they hold. `ts`:
 * when, on the sender's own clock (ms), so others space their poses as they were sent, not as they happened to arrive.
 */
export interface VisitorPose {
  ts: number;
  f: number;
  x: number;
  z: number;
  h: number;
  p: number;
  held: VisitorHeld | null;
}

export type EmoteId = 'wave' | 'thumbs' | 'clap' | 'point' | 'laugh';

/**
 * Browser to server on /ws. resync: send a fresh snapshot (a tab back from the time-lapse replay); lines: which
 * agents' terminal lines this tab shows (shared/watch.ts). The rest: presence.
 */
export type ClientEvent = { type: 'resync' } | ({ type: 'lines' } & Watch) | PresenceEvent | AttentionEvent;

/** A tab telling the office whether the manager is using it (#210): on screen or not, sent on change and on input. */
export type AttentionEvent = { type: 'attention'; visible: boolean };

/**
 * A tab's presence (shared/presence.ts). hello: your name and colour · pose: you're in the office and appear to others ·
 * watch: you're in the office on floor f but don't appear · away: not in the office · fakes: the demo's fake visitors.
 */
export type PresenceEvent =
  | { type: 'hello'; name: string; color: string }
  | ({ type: 'pose' } & VisitorPose)
  | { type: 'watch'; f: number }
  | { type: 'away' }
  | { type: 'emote'; e: EmoteId }
  | { type: 'ping'; x: number; y: number; z: number; label: string }
  | { type: 'fakes'; n: number };
