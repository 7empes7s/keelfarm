// Voices for the CEO and every agent (docs/voice.md, #320), as both sides see them: the speech speed, favourites, the
// ElevenLabs models and their prices, how a voice list is grouped, and how a new agent gets a voice of their own.
import type { VoiceOption } from './types/voice.ts';

export const SPEED_MIN = 0.7;
export const SPEED_MAX = 1.2;
export const SPEED_STEP = 0.05;
export const SPEED_DEFAULT = 1;

/** A speech speed, 0.7–1.2 in steps of 0.05 (ElevenLabs' voice_settings.speed range); anything unreadable is 1. */
export function clampSpeed(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return SPEED_DEFAULT;
  const stepped = Math.round(Math.min(SPEED_MAX, Math.max(SPEED_MIN, n)) / SPEED_STEP) * SPEED_STEP;
  return Math.round(stepped * 100) / 100;
}

/** "1×", "0.85×" for the slider. */
export const speedLabel = (speed: number) => `${clampSpeed(speed)}×`;

/** An ElevenLabs voice id. */
export const VOICE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const FAVOURITES_MAX = 50;

/** Favourite voices from a saved state or a PATCH: ElevenLabs ids only, each once, at most 50; anything else is dropped. */
export function cleanFavourites(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const id of raw) if (typeof id === 'string' && VOICE_ID.test(id)) out.add(id);
  return [...out].slice(0, FAVOURITES_MAX);
}

/** The favourites with `id` added, or taken out when it's already there (the ☆). */
export function toggleFavourite(favourites: readonly string[], id: string): string[] {
  return favourites.includes(id) ? favourites.filter((f) => f !== id) : cleanFavourites([...favourites, id]);
}

/** An agent's voice from a PATCH: '' clears it; a bad id is refused (null). */
export function agentVoice(raw: { voiceId?: unknown; voiceName?: unknown }): { voiceId: string; voiceName: string } | null {
  const id = typeof raw.voiceId === 'string' ? raw.voiceId.trim() : '';
  if (!id) return { voiceId: '', voiceName: '' };
  if (!VOICE_ID.test(id)) return null;
  return { voiceId: id, voiceName: typeof raw.voiceName === 'string' ? raw.voiceName.trim().slice(0, 80) : '' };
}

// ---------- models ----------

/** An ElevenLabs text-to-speech model the settings offer, with its API price in US dollars per 1,000 characters. */
export interface VoiceModel {
  id: string;
  label: string;
  note: string;
  usdPer1k: number;
}

/**
 * Prices from ElevenLabs' API pricing (elevenlabs.io/pricing/api; v4 from openrouter.ai/elevenlabs/eleven-v4), checked
 * November 2026. Eleven v4 Turbo is what a new office starts with; a saved model is never changed.
 */
export const VOICE_MODELS: VoiceModel[] = [
  { id: 'eleven_v4_turbo', label: 'Eleven v4 Turbo', note: 'expressive and fast, audio tags like [laughs]', usdPer1k: 0.04 },
  { id: 'eleven_v4', label: 'Eleven v4', note: 'the richest, slower', usdPer1k: 0.08 },
  { id: 'eleven_flash_v2_5', label: 'Flash v2.5', note: 'fastest, plain', usdPer1k: 0.04 },
  { id: 'eleven_multilingual_v2', label: 'Multilingual v2', note: 'older, high quality', usdPer1k: 0.08 },
];

/** "$0.04 / 1K chars". */
export const modelPrice = (m: VoiceModel) => `$${m.usdPer1k.toFixed(2)} / 1K chars`;

// ---------- the voice list ----------

/** A voice list in the order every picker shows it: favourites, then the newest (v4) voices, the shortlist, the rest. */
export interface VoiceGroups {
  favourites: VoiceOption[];
  latest: VoiceOption[];
  recommended: VoiceOption[];
  others: VoiceOption[];
}

export function groupVoices(list: readonly VoiceOption[], favourites: readonly string[]): VoiceGroups {
  const fav = new Set(favourites);
  const out: VoiceGroups = { favourites: [], latest: [], recommended: [], others: [] };
  for (const v of list) {
    if (fav.has(v.id)) out.favourites.push(v);
    else if (v.v4) out.latest.push(v);
    else if (v.recommended) out.recommended.push(v);
    else out.others.push(v);
  }
  out.favourites.sort((a, b) => favourites.indexOf(a.id) - favourites.indexOf(b.id));
  return out;
}

/** Whether a voice was made for Eleven v4, from the API's per-voice model metadata. */
export const isV4Voice = (models: readonly string[]) => models.some((m) => m.startsWith('eleven_v4'));

/** A stable number for a string, so the same agent always lands on the same voice. */
function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/**
 * A voice for an agent: from `pool` (favourites, else the v4 voices, else the shortlist), one nobody on the floor has
 * (`used`) where there's one left, and never `not` (Shuffle's current voice) unless it's the only one. Seeded by `seed`
 * (their id, plus a count for each Shuffle), so it's the same on every run. null when the pool is empty.
 */
export function pickVoice(pool: readonly string[], used: Iterable<string>, seed: string, not = ''): string | null {
  const ids = [...new Set(pool)];
  if (!ids.length) return null;
  const taken = new Set(used);
  const others = ids.filter((id) => id !== not);
  const free = others.filter((id) => !taken.has(id));
  const from = free.length ? free : others.length ? others : ids;
  return from[hash(seed) % from.length];
}

/** The pool a new agent's voice is drawn from: the favourites, else the v4 voices, else the shortlist, else any. */
export function voicePool(list: readonly VoiceOption[], favourites: readonly string[]): string[] {
  const known = new Set(list.map((v) => v.id));
  const fav = favourites.filter((id) => known.has(id));
  if (fav.length) return fav;
  for (const group of [list.filter((v) => v.v4), list.filter((v) => v.recommended), list])
    if (group.length) return group.map((v) => v.id);
  return [];
}
