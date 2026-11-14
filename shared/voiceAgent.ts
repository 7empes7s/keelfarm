// The Jarvis voice (#534, docs/voice.md "ElevenLabs Agents"): ElevenLabs Agents does the listening, turn-taking and
// talking on a call, the office is its LLM. Pure: the minutes used (per day, for today and this month), the monthly
// cap, and whether a call can use it at all; without it the call is today's voice mode.

/** ElevenLabs Agents' price per minute of conversation (elevenlabs.io/pricing/agents, November 2026), for the estimate. */
export const AGENT_USD_PER_MIN = 0.08;
const AGENT_CAP_HOURS_DEFAULT = 15;
const CAP_HOURS_MAX = 200;
/** Days of minutes kept: this month and the last. */
const KEEP_DAYS = 62;
/** A call longer than this is counted as this (a tab that never said it ended). */
const SESSION_MAX_S = 4 * 3600;

/** Settings → Voice → Jarvis voice. */
export interface VoiceAgentSettings {
  on: boolean;
  capHours: number; // a month's minutes up to this many hours, then calls fall back to today's voice mode
  /** Who hears the manager on a Jarvis call (#658): the browser's speech recognition (absent: the default) or ElevenLabs' own, from the mic's audio. */
  listen?: AgentListen;
}

export type AgentListen = 'browser' | 'elevenlabs';

export const DEFAULT_VOICE_AGENT: VoiceAgentSettings = { on: true, capHours: AGENT_CAP_HOURS_DEFAULT };

/** The settings from a saved state or a PATCH, field by field; anything invalid keeps `base`. */
export function voiceAgentSettings(base: VoiceAgentSettings, patch: unknown): VoiceAgentSettings {
  const p = (patch && typeof patch === 'object' ? patch : {}) as Partial<Record<keyof VoiceAgentSettings, unknown>>;
  const out = { ...base };
  if (typeof p.on === 'boolean') out.on = p.on;
  if (typeof p.capHours === 'number' && Number.isFinite(p.capHours)) out.capHours = Math.max(0, Math.min(CAP_HOURS_MAX, Math.round(p.capHours * 4) / 4));
  if (p.listen === 'browser' || p.listen === 'elevenlabs') out.listen = p.listen;
  return out;
}

/** Who hears the manager on a Jarvis call (#658), in the order they're tried. */
const LISTENERS = ['browser', 'elevenlabs', 'openai', 'clip'] as const;
export type AgentListener = (typeof LISTENERS)[number];

/** What this call can listen with: the browser's recognition, the mic as a stream (AudioWorklet), the office's OpenAI transcription, a recorder. */
export interface ListenCaps {
  recognition: boolean;
  stream: boolean;
  stt: boolean;
  recorder: boolean;
}

const can = (l: AgentListener, c: ListenCaps) => (l === 'browser' ? c.recognition : l === 'elevenlabs' ? c.stream : l === 'openai' ? c.stream && c.stt : c.recorder);

/**
 * The listener a call starts with (#658): the browser's own recognition (no cost; Chrome, Edge, Safari), else the
 * agent's own listening on the mic's stream (#657; first whenever the setting says ElevenLabs), else the office's
 * OpenAI Realtime transcription, else a clip per turn. The agent speaks in every case.
 */
export function agentListener(setting: AgentListen | undefined, caps: ListenCaps): AgentListener {
  return nextListener(setting === 'elevenlabs' ? 'browser' : null, caps) ?? 'elevenlabs';
}

/** The listener after `cur` failed (couldn't start, or the agent never heard the manager), or null when none is left; null `cur` is the first. */
export function nextListener(cur: AgentListener | null, caps: ListenCaps): AgentListener | null {
  return LISTENERS.slice(cur ? LISTENERS.indexOf(cur) + 1 : 0).find((l) => can(l, caps)) ?? null;
}

/** The words a switch is shown in, once, on the call screen and in the trace. */
export const LISTENER_WORDS: Record<AgentListener, string> = {
  browser: "This browser's own speech recognition is listening",
  elevenlabs: 'ElevenLabs is listening to your microphone',
  openai: 'The office is transcribing your voice with OpenAI',
  clip: 'Each thing you say is recorded and sent to the office to transcribe, so replies take a few seconds longer',
};

/** Seconds of calls per local day ('YYYY-MM-DD'). */
export type AgentUsage = Record<string, number>;

/** The snapshot's voiceAgent and its event: minutes used, for Settings → Voice and the cap. */
export interface VoiceAgentView {
  minutesToday: number;
  minutesMonth: number;
  /** The demo: a fake agent socket, no ElevenLabs and no office address needed. */
  fake: boolean;
}

/** Adds a call's seconds to its day and forgets days older than two months. */
export function addCallSeconds(usage: AgentUsage, day: string, seconds: number): AgentUsage {
  const s = Math.max(0, Math.min(SESSION_MAX_S, Math.round(seconds)));
  const out: AgentUsage = { ...usage, [day]: (usage[day] ?? 0) + s };
  for (const d of Object.keys(out).sort().slice(0, -KEEP_DAYS)) delete out[d];
  return out;
}

/** Minutes used on `today` and in its month (rounded up: a started minute counts, as ElevenLabs bills). */
export function usageMinutes(usage: AgentUsage, today: string): { minutesToday: number; minutesMonth: number } {
  const month = today.slice(0, 7);
  const monthS = Object.entries(usage).reduce((n, [d, s]) => (d.startsWith(month) ? n + s : n), 0);
  return { minutesToday: Math.ceil((usage[today] ?? 0) / 60), minutesMonth: Math.ceil(monthS / 60) };
}

/** Saved usage, keeping only well-formed days. */
export function parseUsage(raw: unknown): AgentUsage {
  const out: AgentUsage = {};
  if (raw && typeof raw === 'object') for (const [d, s] of Object.entries(raw)) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && typeof s === 'number' && s >= 0) out[d] = s;
  return out;
}

/**
 * Why a call can't use the Jarvis voice ('' when it can): then it's today's voice mode, exactly as before. The server
 * asks again when a call starts; the client asks to pick the call's engine and for Settings → Voice.
 */
export function agentWhy(a: { settings: VoiceAgentSettings; keySet: boolean; officeUrl: string; minutesMonth: number; fake: boolean }): string {
  if (!a.settings.on) return 'The Jarvis voice is off.';
  if (!a.keySet) return 'Add an ElevenLabs key to use the Jarvis voice.';
  if (!a.fake && !a.officeUrl.startsWith('https://')) return "ElevenLabs needs the office's https address (Settings → Notifications → Office address) to reach it.";
  if (a.minutesMonth >= a.settings.capHours * 60) return `This month's ${hoursLabel(a.settings.capHours)} of Jarvis voice are used: calls use the office's own voice until next month.`;
  return '';
}

/** "15 h", "1 h", "30 min". */
export function hoursLabel(hours: number): string {
  return hours >= 1 ? `${Math.round(hours * 100) / 100} h` : `${Math.round(hours * 60)} min`;
}

/** "42 min", "3 h 05 min". */
export function minutesLabel(min: number): string {
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

/** "$3.36" at ElevenLabs' price per minute. */
export const minutesCost = (min: number) => `$${(min * AGENT_USD_PER_MIN).toFixed(2)}`;
