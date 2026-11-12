// An agent's camera in a call or chat (#539), pure: "turn on your camera" (or the 📷 button) shows their 3D character
// live in a small video tile (world/AgentCamTile.tsx), framed at their desk. This file holds the rules: which words
// turn it on or off, the playful refusal while they're busy (a template, never an LLM call), the pose for the moment,
// the voice's level as the mouth's opening, and when the tile draws a frame. agentCameraStore.ts keeps the state.

import type { AgentView } from '../../../shared/types';
import { tileDue, type TileShown } from '../world/meeting';

// ---------- the words ----------

export type CameraCommand = 'on' | 'off';

const ON = [
  /\b(turn|switch|put|flip)\s+(on\s+)?(your\s+|the\s+)?(camera|cam|video|webcam)(\s+on)?\b/,
  /\b(camera|cam|video|webcam)\s+on\b/,
  /\b(enable|start)\s+(your\s+|the\s+)?(camera|cam|video|webcam)\b/,
  /\bshow\s+(me\s+)?(yourself|your\s+face)\b/,
  /\blet\s+me\s+see\s+you\b/,
];
const OFF = [
  /\b(turn|switch|put|flip)\s+(off\s+)?(your\s+|the\s+)?(camera|cam|video|webcam)\s+off\b/,
  /\b(turn|switch)\s+off\s+(your\s+|the\s+)?(camera|cam|video|webcam)\b/,
  /\b(camera|cam|video|webcam)\s+off\b/,
  /\b(disable|stop|close|hide)\s+(your\s+|the\s+)?(camera|cam|video|webcam)\b/,
  /\bhide\s+yourself\b/,
];

/** Whether a message (typed or said) asks to turn the camera on or off: only a short ask, never a longer message that mentions one. */
export function cameraCommand(text: string): CameraCommand | null {
  const t = text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.split(' ').length > 9) return null;
  if (OFF.some((r) => r.test(t))) return 'off';
  if (ON.some((r) => r.test(t))) return 'on';
  return null;
}

// ---------- camera shy ----------

/** The agent's state that decides whether they're camera shy. */
export type CamWho = Pick<AgentView, 'id' | 'name' | 'status' | 'task' | 'nudge'>;

const SHY: Record<'conflict' | 'fix' | 'qa', string[]> = {
  conflict: ["Camera shy while I'm in a merge conflict Ask me again and I'll risk it.", "Not now, I'm knee-deep in a merge conflict. Ask again if you really want to see this."],
  fix: ["Camera shy while I'm fixing QA's notes Ask again and I'll show you.", "Hold on, I'm mid-fix and my hair's a mess. Ask me again?"],
  qa: ["Shh, I'm testing a PR Ask again and I'll wave.", "Camera off while I test, it puts the builds off. Ask again?"],
};

/** Why they'd rather not turn the camera on right now: busy with a merge conflict, a fix or a test. */
export function shyReason(a: CamWho): keyof typeof SHY | null {
  if (a.status !== 'working') return null;
  if (a.nudge && /conflict|merge main/i.test(a.nudge)) return 'conflict';
  if (a.task === 'fix') return 'fix';
  if (a.task === 'qa') return 'qa';
  return null;
}

/** A second ask this soon after a refusal turns the camera on anyway. */
export const SHY_GRACE_MS = 60_000;

/** The playful refusal (a template picked by name, so it's steady), or null to turn on: never twice in a row. */
export function shyLine(a: CamWho, refusedAt: number | undefined, now: number): string | null {
  const why = shyReason(a);
  if (!why || (refusedAt !== undefined && now - refusedAt < SHY_GRACE_MS)) return null;
  const lines = SHY[why];
  let h = 0;
  for (const c of a.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return lines[h % lines.length];
}

/** What they say as the camera comes on, shown on the tile while they wave. */
export const hello = (name: string, ceo: boolean) => (ceo ? `Hi! It's ${name}, live from the office` : `Hey, it's ${name} at my desk`);

// ---------- the pose ----------

export type CamPose = 'wave' | 'talk' | 'think' | 'idle';

/** How long the wave lasts once the camera comes on. */
export const WAVE_MS = 1800;

/** The pose now: a wave as it comes on, talking while their voice is up, thinking while the CEO works on an answer. */
export function camPose(sinceOn: number, level: number, thinking: boolean): CamPose {
  if (sinceOn < WAVE_MS) return 'wave';
  if (level > MOUTH_GATE) return 'talk';
  if (thinking) return 'think';
  return 'idle';
}

// ---------- the voice and the mouth ----------

/** Below this the voice's level is room noise: the mouth stays shut. */
export const MOUTH_GATE = 0.04;

/** The mouth's opening (0..1) for the voice's level (0..1): shut under the gate, then a soft curve up to wide open. */
export function mouthOpen(level: number): number {
  if (!(level > MOUTH_GATE)) return 0;
  const x = Math.min(1, (level - MOUTH_GATE) / (0.5 - MOUTH_GATE));
  return Math.sqrt(x);
}

/** A voice-like level (0..1) at t seconds, for speech we can't measure (the browser's voice, a greeting): syllables at ~4 a second. */
export function speechLevel(t: number): number {
  const syl = Math.abs(Math.sin(t * Math.PI * 4.2));
  const phrase = 0.65 + 0.35 * Math.sin(t * 1.7);
  return Math.max(0, syl * phrase - 0.05);
}

/** How long a line takes to say, for the greeting's talking: about 14 characters a second. */
export const sayMs = (text: string) => Math.min(6000, 600 + text.length * 70);

/** The demo's camera on load (`?camera=ceo`, or an agent's id), for QA and the tour; nothing outside the demo. */
export function demoCamera(search: string, demo: boolean): string | null {
  return (demo && new URLSearchParams(search).get('camera')) || null;
}

// ---------- drawing ----------

/** The tile draws at most this many frames a second, at CAM_PX × CAM_PX pixels (CSS size × DPR). */
export const CAM_FPS = 15;
export const CAM_PX = 360;

export interface CamShown {
  /** The tab is in the background. */
  hidden: boolean;
  /** The tile is on screen (not scrolled away or covered). */
  onScreen: boolean;
}

/** The tile's frames take at most this share of the time, so a slow device's office view keeps its frame rate. */
export const CAM_SHARE = 0.2;

/** Frames a second the tile draws at, its last frame having taken `costMs` to draw: CAM_FPS, fewer when frames are dear. */
export const camFps = (costMs: number) => Math.min(CAM_FPS, (1000 * CAM_SHARE) / Math.max(costMs, 1e-3));

/** Whether the tile draws a frame at `now`: never while the tab is in the background or the tile is off screen (closed, it's gone). */
export const camDue = (now: number, last: number, s: CamShown, costMs = 0): boolean => tileDue(now, last, { folded: false, hidden: s.hidden, onScreen: s.onScreen } satisfies TileShown, camFps(costMs));
