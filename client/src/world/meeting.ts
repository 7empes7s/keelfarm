// The meeting room's rules (#369), pure: where the CEO is and what they do at each moment of a voice call, what E at a
// chair does and the view from it, and when the call window's live view of the room draws a frame. MeetingRoom.tsx
// (the room in the lobby) and MeetingTile.tsx (the call window's view) run them.

import type { Call } from '../ui/voiceCall';
import type { Gesture } from './body';
import type { Expression } from './face';
import { MEETING_CHAIRS } from './layout';

// ---------- the CEO ----------

export interface CeoAtCall {
  /** At the meeting table's head (true) or back in the corner office. */
  inRoom: boolean;
  gesture: Gesture;
  expression: Expression;
}

/** Where the CEO is and how they look for the call as it is now: talking while they speak, nodding while they listen. */
export function ceoAtCall(call: Pick<Call, 'phase' | 'paused' | 'away'>): CeoAtCall {
  const at = (gesture: Gesture, expression: Expression): CeoAtCall => ({ inRoom: true, gesture, expression });
  if (call.phase === 'idle' || call.phase === 'ended') return { inRoom: false, gesture: 'none', expression: 'neutral' };
  if (call.phase === 'connecting') return at('wave', 'joyful');
  if (call.paused || call.away) return at('none', 'neutral');
  if (call.phase === 'speaking') return at('talk', 'joyful');
  if (call.phase === 'thinking') return at('tap', 'focused');
  return at('nod', 'neutral');
}

// ---------- the chairs ----------

/** How high your eye is, sat at the table. */
const SEATED_EYE = 1.2;

/** The view from meeting chair i: the eye over the seat, facing the CEO's place, looking a little down at the table. */
export function chairView(i: number) {
  const c = MEETING_CHAIRS[i];
  return { x: c.x, y: SEATED_EYE, z: c.z, yaw: c.yaw, pitch: -0.08, exit: c.exit };
}

/** What the crosshair says at a chair: join the call that's on, or sit down and call the CEO. */
export const chairLabel = (callOn: boolean, ceo: string) => (callOn ? 'Join the call' : `Sit down and call ${ceo}`);

export interface ChairPlan {
  /** Sit down in it (false: you already sit there, or it's no chair). */
  sit: boolean;
  /** Start a call: none is on. */
  start: boolean;
  /** Fold the call screen: on a narrow screen it would cover the room you just sat down in. */
  fold: boolean;
}

/** E at chair i, sitting in `sitting` (or on your feet), with a call on or not, on a narrow screen or not. */
export function chairPlan(i: number, sitting: number | null, callOn: boolean, narrow: boolean): ChairPlan {
  if (!MEETING_CHAIRS[i] || sitting === i) return { sit: false, start: false, fold: false };
  return { sit: true, start: !callOn, fold: narrow };
}

// ---------- the call window's view ----------

/** The call window's view of the room draws at most this many frames a second: it's a video tile, not the game. */
export const TILE_FPS = 12;

export interface TileShown {
  /** The call window is folded to its pill or orb. */
  folded: boolean;
  /** The tab is in the background. */
  hidden: boolean;
  /** The tile is on screen (scrolled into view, not covered by a full-screen panel). */
  onScreen: boolean;
}

/** Whether the view draws a frame at `now` (ms), its last one at `last`: only while it shows, and TILE_FPS a second at most. */
export function tileDue(now: number, last: number, shown: TileShown, fps = TILE_FPS): boolean {
  if (shown.folded || shown.hidden || !shown.onScreen) return false;
  return now - last >= 1000 / fps - 1; // a millisecond's slack for timer jitter
}
