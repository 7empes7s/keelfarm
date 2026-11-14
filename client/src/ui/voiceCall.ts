// A voice call with the CEO (docs/voice.md, "How a voice call behaves"): one session for the whole app, whatever is on
// screen. Pure, so it's tested without a microphone or a voice; voiceCallEngine.ts runs it and the call screens
// (CallScreens.tsx) only draw it. Nothing shown over the call ends or restarts it: only End (or closing the tab) does.

import type { VoiceSettings } from '../../../shared/types';

/**
 * The voice a message is read in: a call always speaks (the browser's voice with Speak messages off), and a Jarvis call
 * that fell back keeps the CEO's ElevenLabs voice (`eleven`, #682), never quietly switching to another.
 */
export function voiceOnCall(v: VoiceSettings, call: { on: boolean; eleven: boolean }): VoiceSettings {
  if (!call.on) return v;
  if (call.eleven) return v.provider === 'elevenlabs' ? v : { ...v, provider: 'elevenlabs' };
  return v.provider === 'off' ? { ...v, provider: 'browser' } : v;
}

/** Where the call is: dialling, your turn, waiting for the CEO's reply, or the CEO talking. */
type CallPhase = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ended';

/** The reply being read: which message, and which of its sentences. */
interface CallReply {
  id: number;
  sentence: number;
  sentences: number;
}

/** A toast the call held back, shown when it ends (it's in the notifications list meanwhile). */
export interface HeldNote {
  level: 'info' | 'success' | 'error';
  text: string;
  /** The store's NoticeView, kept as is. */
  notice?: unknown;
}

export interface Call {
  /** The session: 0 before the first call; a new one only on a new call. */
  id: number;
  phase: CallPhase;
  startedAt: number;
  muted: boolean;
  /** Paused by the manager: the voice stops where it was and the mic is off. */
  paused: boolean;
  /** The tab is in the background or the phone is locked: never listen then. */
  away: boolean;
  /** Why the mic can't listen by itself ('' when it can): the call falls back to tap-to-talk. */
  tapToTalk: string;
  reply: CallReply | null;
  /** The manager's current run of speech while the CEO talks (barge-in). */
  run: { start: number; last: number } | null;
  held: HeldNote[];
}

export const NO_CALL: Call = { id: 0, phase: 'idle', startedAt: 0, muted: false, paused: false, away: false, tapToTalk: '', reply: null, run: null, held: [] };

/** Speech this long, while the CEO talks, interrupts: shorter is noise or a cough. */
export const BARGE_MS = 300;
/** A gap this long ends a run of speech. */
const RUN_GAP_MS = 400;
/** At most this many toasts wait for the call to end; the oldest give way. */
const HELD_MAX = 20;

/** Words that say "go on" rather than "stop": they never interrupt. */
const BACKCHANNEL = /^(m+|h?m+-?h?m+|mhm|uh-?huh|uh|um|ah|oh|yeah|yep|yes|ok|okay|right|sure|i see)$/;

/** Whether what was heard is a backchannel ("mm-hm", "yeah"), not a turn of its own. */
export function isBackchannel(text: string): boolean {
  const t = text
    .toLowerCase()
    .replace(/[^a-z\s-]/g, '')
    .trim();
  return !t || t.split(/\s+/).every((w) => BACKCHANNEL.test(w));
}

export const inCall = (c: Call) => c.phase !== 'idle' && c.phase !== 'ended';

/** Whether the mic should be open now: in a call, at your turn or while the CEO talks (barge-in), never paused, muted or away. */
export const wantsMic = (c: Call) => inCall(c) && c.phase !== 'connecting' && !c.muted && !c.paused && !c.away && !c.tapToTalk;

/** What the engine does besides drawing the new state. */
export type CallEffect = 'greet' | 'stop-voice' | 'pause-voice' | 'resume-voice' | 'skip-voice' | 'release';

export type CallEvent =
  | { type: 'start'; now: number; id: number }
  | { type: 'connected'; tapToTalk: string }
  /** The mic stopped working (refused, gone): tap-to-talk with this reason. */
  | { type: 'mic-problem'; why: string }
  /** The manager is speaking now; `text` is what was recognised so far ('' for a recording's levels). */
  | { type: 'speech'; now: number; text: string }
  | { type: 'sent' }
  | { type: 'reply'; id: number; sentences: number }
  | { type: 'sentence'; index: number }
  | { type: 'reply-ended' }
  | { type: 'skip' }
  | { type: 'mute' }
  | { type: 'pause' }
  | { type: 'hidden' }
  | { type: 'visible' }
  | { type: 'note'; note: HeldNote }
  | { type: 'end' };

export interface CallStep {
  call: Call;
  effects: CallEffect[];
  /** Toasts to show now: the one that came with no call on, or the held ones once it ends. */
  show: HeldNote[];
}

/** Whether a run of speech this long, saying `text`, takes the turn from the CEO. */
export function bargesIn(runMs: number, text: string): boolean {
  return runMs >= BARGE_MS && (text === '' || !isBackchannel(text));
}

export function callStep(c: Call, ev: CallEvent): CallStep {
  const out = (call: Call, effects: CallEffect[] = [], show: HeldNote[] = []): CallStep => ({ call, effects, show });
  const live = inCall(c);
  switch (ev.type) {
    case 'start':
      // A call already on stays the same call: a screen mounting again never redials or greets twice.
      if (live) return out(c);
      return out({ ...NO_CALL, id: ev.id, phase: 'connecting', startedAt: ev.now, away: c.away }, ['greet']);
    case 'connected':
      return c.phase === 'connecting' ? out({ ...c, phase: 'listening', tapToTalk: ev.tapToTalk }) : out(c);
    case 'mic-problem':
      return live ? out({ ...c, tapToTalk: ev.why || 'The microphone stopped' }) : out(c);
    case 'speech': {
      if (!live || c.muted || c.paused || c.away || c.phase !== 'speaking') return out(c);
      const run = c.run && ev.now - c.run.last <= RUN_GAP_MS ? { start: c.run.start, last: ev.now } : { start: ev.now, last: ev.now };
      if (!bargesIn(run.last - run.start, ev.text)) return out({ ...c, run });
      return out({ ...c, phase: 'listening', reply: null, run: null }, ['stop-voice']);
    }
    case 'sent':
      return live ? out({ ...c, phase: 'thinking', run: null }) : out(c);
    case 'reply':
      return live ? out({ ...c, phase: 'speaking', reply: { id: ev.id, sentence: 0, sentences: Math.max(1, ev.sentences) }, run: null }) : out(c);
    case 'sentence':
      return live && c.reply ? out({ ...c, reply: { ...c.reply, sentence: Math.min(ev.index, c.reply.sentences - 1) } }) : out(c);
    case 'reply-ended':
      // Also from thinking: a reply the voice couldn't read still hands the turn back.
      return live && (c.phase === 'speaking' || c.phase === 'thinking') ? out({ ...c, phase: 'listening', reply: null, run: null }) : out(c);
    case 'skip':
      if (!live || c.phase !== 'speaking' || !c.reply) return out(c);
      return out({ ...c, reply: { ...c.reply, sentence: Math.min(c.reply.sentence + 1, c.reply.sentences - 1) } }, ['skip-voice']);
    case 'mute':
      return live ? out({ ...c, muted: !c.muted, run: null }) : out(c);
    case 'pause':
      if (!live) return out(c);
      return out({ ...c, paused: !c.paused, run: null }, c.phase === 'speaking' ? [c.paused ? 'resume-voice' : 'pause-voice'] : []);
    case 'hidden':
      return out({ ...c, away: true, run: null });
    case 'visible':
      return out({ ...c, away: false });
    case 'note':
      if (!live) return out(c, [], [ev.note]);
      return out({ ...c, held: [...c.held, ev.note].slice(-HELD_MAX) });
    case 'end':
      if (!live) return out(c);
      return out({ ...NO_CALL, id: c.id, phase: 'ended', away: c.away }, ['stop-voice', 'release'], c.held);
  }
}

// ---------- sentence by sentence ----------

/** Where each sentence starts in `text` (0 first): what Skip moves through. */
export function sentenceStarts(text: string): number[] {
  const starts = [0];
  const re = /[.!?…]+["')\]]*\s+(?=\S)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) starts.push(m.index + m[0].length);
  return starts;
}

/** The sentences of `text`, for a voice that speaks them one at a time. */
export function splitSentences(text: string): string[] {
  const starts = sentenceStarts(text);
  return starts.map((s, i) => text.slice(s, starts[i + 1] ?? text.length).trim()).filter(Boolean);
}

/** Which sentence is being said `fraction` (0-1) of the way through `text`, by characters. */
export function sentenceAt(text: string, fraction: number): number {
  const at = Math.max(0, Math.min(1, fraction)) * text.length;
  const starts = sentenceStarts(text);
  let i = 0;
  while (i + 1 < starts.length && starts[i + 1] <= at) i++;
  return i;
}

/** How far through `text` (0-1, by characters) sentence `index` starts: where a recording seeks to on Skip. */
export function sentenceFraction(text: string, index: number): number {
  const starts = sentenceStarts(text);
  return text.length ? (starts[Math.min(index, starts.length - 1)] ?? 0) / text.length : 0;
}

/** The call timer: "0:07", "12:34", "1:02:03". */
export function callClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

/** The captions' line: the CEO's sentence while they talk, else what you said (or are saying), else ''. */
export function captionLine(c: Pick<Call, 'phase'>, ceoName: string, saying: string, heard: string): string {
  if (c.phase === 'speaking' && saying) return `${ceoName}: ${saying}`;
  return heard ? `You: ${heard}` : '';
}

/** What the call screen says under the name. */
export function callStatus(c: Call, ceoName: string): string {
  if (c.phase === 'connecting') return 'Connecting…';
  if (c.phase === 'ended') return 'Call ended';
  if (c.paused) return 'Paused';
  if (c.away) return 'On hold while you are away';
  if (c.phase === 'speaking') return `${ceoName} is talking`;
  if (c.phase === 'thinking') return `${ceoName} is thinking…`;
  if (c.muted) return 'Muted';
  if (c.tapToTalk) return 'Tap Talk to speak';
  return 'Listening… just talk';
}
