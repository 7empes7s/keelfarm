// Who hears the manager on a Jarvis call (#658, docs/voice.md "Who listens"), apart from the agent's own listening:
// the browser's speech recognition for the whole call (continuous, interim words), or the office's OpenAI
// transcription over /ws/voice-stt. Either hands back the words being said (shown live, and a barge-in) and each
// finished utterance, which agentCallEngine.ts sends to the agent as a user_message. Utterances is the pure part.
import { encodeMic, inputFormat } from './agentCall';
import type { Recognition, RecognitionClass } from './micFake';
import type { Phrase } from './micText';

/**
 * An utterance is sent this long after its last new interim word, if the recognizer hasn't settled it by then (#665:
 * 700 ms before, all of it waited on every turn the recognizer is slow to settle; a longer pause mid-thought sends the
 * rest as its own turn).
 */
const QUIET_MS = 550;

/** What the call does with what it hears. */
export interface EarsHooks {
  /** The words being said now ('' once they're sent). */
  interim(text: string): void;
  /** A finished utterance: exactly once each. */
  utterance(text: string): void;
  /** Listening broke for good (a recognition error code, or the relay's reason). */
  failed(why: string): void;
}

export interface Ears {
  stop(): void;
}

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean);
const key = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
/** Settled phrases remembered across restarts: one coming back whole is the recognizer repeating itself (msgs 4626/4629). */
const RECENT = 5;

/**
 * The browser's results (one recognition's growing list of phrases) as utterances: a settled phrase is sent once, words
 * still being said are shown, and `flush` sends them early after QUIET_MS. Words already sent are never sent again,
 * even when the recognizer settles or extends that phrase later.
 */
export class Utterances {
  private sent = new Map<number, number>(); // phrase index → words of it already sent
  private last: readonly Phrase[] = [];
  private recent: string[] = []; // the last settled phrases sent, kept through reset()

  /** One onresult: the utterance to send now ('' for none) and the words still being said. */
  results(phrases: readonly Phrase[]): { send: string; interim: string } {
    this.last = phrases;
    const send: string[] = [];
    const interim: string[] = [];
    phrases.forEach((p, i) => {
      const w = words(p.transcript);
      const rest = w.slice(this.sent.get(i) ?? 0);
      if (!rest.length) return;
      if (p.final) {
        this.sent.set(i, w.length);
        const k = key(p.transcript);
        if (rest.length === w.length && this.recent.includes(k)) return; // a whole earlier phrase again: stale, never resent
        this.recent = [...this.recent.filter((x) => x !== k), k].slice(-RECENT);
        send.push(...rest);
      } else interim.push(...rest);
    });
    return { send: send.join(' '), interim: interim.join(' ') };
  }

  /** The words being said went quiet: they're the utterance now ('' when there are none). */
  flush(): string {
    const out: string[] = [];
    this.last.forEach((p, i) => {
      if (p.final) return;
      const w = words(p.transcript);
      out.push(...w.slice(this.sent.get(i) ?? 0));
      this.sent.set(i, Math.max(this.sent.get(i) ?? 0, w.length));
    });
    return out.join(' ');
  }

  /** A new recognition: its phrases count from 0 again. */
  reset() {
    this.sent.clear();
    this.last = [];
  }
}

/** Recognition errors that mean it can't listen here (anything else, like a quiet room, just starts it again). */
const FATAL = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported', 'bad-grammar']);
/** A recognition that ends this soon after starting, this many times in a row, isn't listening. */
const QUICK_MS = 500;
const QUICK_MAX = 5;

/** The browser's recognition for the whole call, started again whenever it stops by itself (phones do after a quiet). */
export function browserEars(R: RecognitionClass, h: EarsHooks, lang: string): Ears {
  const u = new Utterances();
  let r: Recognition | null = null;
  let stopped = false;
  let quiet: ReturnType<typeof setTimeout> | null = null;
  let quick = 0;
  const clearQuiet = () => {
    if (quiet) clearTimeout(quiet);
    quiet = null;
  };
  const say = (text: string) => {
    clearQuiet();
    h.interim('');
    if (text) h.utterance(text);
  };
  const begin = () => {
    const cur = new R();
    r = cur;
    cur.lang = lang;
    cur.continuous = true;
    cur.interimResults = true;
    let error = '';
    const at = performance.now();
    cur.onresult = (e) => {
      if (r !== cur) return;
      quick = 0;
      const { send, interim } = u.results(Array.from(e.results, (x) => ({ transcript: x[0]?.transcript ?? '', final: x.isFinal })));
      if (send) say(send);
      if (!interim) return;
      h.interim(interim);
      clearQuiet();
      quiet = setTimeout(() => say(u.flush()), QUIET_MS);
    };
    cur.onerror = (e) => void (error = e.error);
    cur.onend = () => {
      if (r !== cur || stopped) return;
      say(u.flush());
      if (FATAL.has(error)) return h.failed(error);
      quick = performance.now() - at < QUICK_MS ? quick + 1 : 0;
      if (quick >= QUICK_MAX) return h.failed(error || 'audio-capture');
      u.reset();
      try {
        begin();
      } catch {
        h.failed('audio-capture');
      }
    };
    cur.start();
  };
  begin();
  return {
    stop() {
      stopped = true;
      clearQuiet();
      r?.abort();
      r = null;
    },
  };
}

/** The OpenAI relay's PCM: 24 kHz 16-bit mono. */
const STT_FORMAT = inputFormat('pcm_24000');

/** The office's OpenAI transcription for the call: `push` the mic's samples in, utterances come back. */
export function relayEars(url: string, h: EarsHooks): Ears & { push(samples: Float32Array, rate: number): void } {
  const ws = new WebSocket(url);
  let interim = '';
  let done = false;
  const fail = (why: string) => {
    if (done) return;
    done = true;
    h.failed(why);
  };
  ws.onmessage = (e) => {
    let m: { type?: string; text?: unknown; message?: unknown };
    try {
      m = JSON.parse(String(e.data));
    } catch {
      return;
    }
    const text = typeof m.text === 'string' ? m.text : '';
    if (m.type === 'delta') h.interim((interim = `${interim}${text}`.trimStart()));
    else if (m.type === 'final') {
      interim = '';
      h.interim('');
      if (text.trim()) h.utterance(text.trim());
    } else if (m.type === 'error') fail(typeof m.message === 'string' ? m.message : 'OpenAI sent an error');
  };
  ws.onclose = (e) => fail(`the office's OpenAI listener closed (${e.code}${e.reason ? `: ${e.reason}` : ''})`);
  return {
    push(samples, rate) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ audio: encodeMic(samples, rate, STT_FORMAT).b64 }));
    },
    stop() {
      done = true;
      ws.close();
    },
  };
}
