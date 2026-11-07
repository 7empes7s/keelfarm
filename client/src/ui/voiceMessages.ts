// Phone messages read aloud the moment they arrive (docs/voice.md): ElevenLabs' clip through sfx.ts's 'voice' group,
// or the browser's own voice. One at a time and in order, other sounds ducked meanwhile, and one office tab per
// message (voiceClaim.ts). The phone's ▶ replays a message here too, from its saved clip only (never a new synthesis).
// The store loads this on the first message to speak, so it isn't in the main bundle. window.__swarmVoice records what was read, for QA and e2e.
// A CEO message that ends by itself, with nothing else to read, may open the hands-free phone's mic (mic.ts).
// With captions on, what's said is written out as it's read (captions.ts), in step with the clip or the browser's voice.
// During a voice call (voiceCallEngine.ts) the CEO's replies report to the call, sentence by sentence, and can be
// paused where they are, skipped a sentence at a time, or cut short when the manager talks over them.
import { messageSpeech } from '../../../shared/speech';
import type { PhoneMessage, VoiceProvider } from '../../../shared/types';
import { useStore } from '../store';
import { sliderGain } from './audioPrefs';
import { speechClip, speechEnded, speechStarted, speechWord } from './captions';
import { replyEnded } from './mic';
import { holdMusicDuck } from './music';
import { audio, chirp, duckOthers, getAudioPrefs, groupOutput, subscribeAudio } from './sfx';
import { sentenceAt, sentenceFraction, sentenceStarts, splitSentences } from './voiceCall';
import { callOn, dispatchCall, useCall } from './voiceCallStore';
import { wonVoice } from './voiceClaim';
import { enqueue, nextUp, type Queued, type ReplayKind } from './voiceQueue';

/** One message read aloud, for window.__swarmVoice. Times are performance.now(); end is null while it plays. */
export interface SpokenRecord {
  id: number;
  provider: Exclude<VoiceProvider, 'off'>;
  start: number;
  end: number | null;
  /** How loud it started (master × voice level, 0 while muted). */
  volume: number;
  /** Replayed from the phone's ▶ (a saved clip, or the browser's voice again). */
  replay?: true;
}

const spoken: SpokenRecord[] = [];
(window as unknown as Record<string, unknown>).__swarmVoice = spoken;

/** A live message to read aloud, claimed by the store at `arrived`: queued once the claim wait is over, if it won. */
export function speakMessage(message: PhoneMessage, arrived: number, wait: number) {
  setTimeout(
    () => {
      if (!wonVoice(message.id)) return;
      queue = enqueue(queue, { message, arrived });
      if (replaying) stopCurrent?.(); // a new message cuts a replay short
      void pump();
    },
    Math.max(0, arrived + wait - Date.now()),
  );
}

// ---------- the queue ----------

let queue: Queued[] = [];
let stopCurrent: (() => void) | null = null;
let busy = false;
let replayNext: { message: PhoneMessage; kind: Exclude<ReplayKind, 'gone'> } | null = null;
let replaying = false;
let cutShort = false; // the message being read was stopped, not finished

/** The phone's ▶: plays `message` again in this tab, stopping whatever is being read now. */
export function replayMessage(message: PhoneMessage, kind: Exclude<ReplayKind, 'gone'>) {
  replayNext = { message, kind };
  cutShort = true;
  stopCurrent?.();
  void pump();
}

/** Stops the message being read (the HUD's speaking indicator); the next one waiting follows. */
export function stopSpeaking() {
  cutShort = true;
  stopCurrent?.();
}

/** What a voice call steers in the message being read: Skip, Pause, and where it is (for __swarmCall). */
interface Control {
  skip(): void;
  pause(): void;
  resume(): void;
  /** The sentence being said and how long it has played, in ms. */
  at(): { sentence: number; ms: number };
}
let control: { id: number; c: Control } | null = null;

export const skipSentence = () => control?.c.skip();
export const pauseVoice = () => control?.c.pause();
export const resumeVoice = () => control?.c.resume();
/** The message being read and where it is, or null. */
export const voicePosition = () => (control ? { id: control.id, ...control.c.at() } : null);

/** A call's Speaker off reads at the earpiece's level. */
const speakerGain = () => (callOn() && !useCall.getState().speaker ? 0.35 : 1);

const level = () => {
  const p = getAudioPrefs();
  return p.muted ? 0 : sliderGain(p.volume) * sliderGain(p.voice) * speakerGain();
};

async function pump() {
  if (busy) return;
  busy = true;
  try {
    for (;;) {
      if (replayNext) {
        const r = replayNext;
        replayNext = null;
        replaying = true;
        await read(r.message, r.kind).finally(() => (replaying = false));
        continue;
      }
      const { next, rest } = nextUp(queue, Date.now());
      queue = rest;
      if (!next) break;
      await read(next.message);
    }
  } finally {
    busy = false;
    replaying = false;
  }
}

let warned = false;

/** Reads a live message with the voice in the settings, or replays one (`replay`) the way the phone's ▶ chose. */
async function read(m: PhoneMessage, replay?: Exclude<ReplayKind, 'gone'>) {
  const { settings, voiceKeySet } = useStore.getState();
  const { voiceName, speed } = settings.voice;
  const call = !replay && m.from === 'ceo' && callOn();
  const set = settings.voice.provider === 'off' && call ? 'browser' : settings.voice.provider; // a call always speaks
  const provider = replay ? (replay === 'clip' ? 'elevenlabs' : 'browser') : set;
  if (provider === 'off') return; // turned off while it waited
  const now: { rec: SpokenRecord | null; unduckMusic?: () => void } = { rec: null };
  cutShort = false;
  const words = messageSpeech(m);
  /** `clipMs`: a recording's length (null for the browser's voice), and how many clips the message has. */
  const began = (clipMs: number | null, parts = 1) => {
    speechStarted(m.id, words, clipMs, parts);
    now.rec = { id: m.id, provider, start: performance.now(), end: null, volume: level(), ...(replay ? { replay: true as const } : {}) };
    spoken.push(now.rec);
    if (spoken.length > 50) spoken.splice(0, spoken.length - 50);
    useStore.setState({ voiceSpeaking: m.id });
    duckOthers(true);
    now.unduckMusic = holdMusicDuck();
    if (call) dispatchCall({ type: 'reply', id: m.id, sentences: splitSentences(words).length });
  };
  const sentence = (index: number) => call && dispatchCall({ type: 'sentence', index });
  try {
    if (provider === 'browser' && call) await speakSentences(m.id, words, voiceName, speed, () => began(null), sentence);
    else if (provider === 'browser') await speak(words, voiceName, speed, () => began(null), (i) => speechWord(m.id, i));
    else if (replay) await playClip(m.id, words, began, sentence, true);
    else if (!voiceKeySet) throw new Error('no ElevenLabs key is saved');
    else await playClip(m.id, words, began, sentence);
  } catch (err) {
    // A replay whose clip went meanwhile (pruned or cleared) says so; the phone's ▶ follows the server's list.
    if (replay) {
      if (!now.rec) useStore.getState().pushToast('info', replay === 'clip' ? 'Audio no longer saved' : "The browser couldn't speak this message");
      return;
    }
    // No key, ElevenLabs being down, no voice in this browser: the message still rings, just without words.
    if (!now.rec) chirp();
    if (!warned) {
      warned = true;
      console.warn(`[voice] couldn't read message ${m.id} aloud: ${(err as Error).message}`);
    }
  } finally {
    stopCurrent = null;
    control = null;
    if (call) dispatchCall({ type: 'reply-ended' });
    if (now.rec) {
      speechEnded(m.id);
      now.rec.end = performance.now();
      duckOthers(false);
      now.unduckMusic?.();
      useStore.setState({ voiceSpeaking: null });
      if (!replay && !cutShort && !call && m.from === 'ceo' && !queue.length && !replayNext) replyEnded();
    }
  }
}

// ---------- ElevenLabs ----------

/**
 * Fetches the message's clip and plays it through the 'voice' group, so the master volume, M and its slider apply.
 * `cached`: the phone's ▶, saved clips only (a 404 when they're gone), every part of a long message in order.
 * A call can pause it where it is and skip to the next sentence, found by its share of the words (`words`).
 */
async function playClip(id: number, words: string, began: (clipMs: number, parts: number) => void, sentence: (index: number) => void, cached = false) {
  let stopped = false;
  let end: (() => void) | null = null;
  stopCurrent = () => {
    stopped = true;
    end?.();
  };
  let doneMs = 0; // the earlier parts' length
  for (let part = 0, parts = 1; part < parts; part++) {
    const res = await fetch(cached ? `/api/voice/messages/${id}?cached=1&part=${part}` : `/api/voice/messages/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    parts = Math.max(1, Number(res.headers.get('X-Voice-Parts')) || 1);
    const data = await res.arrayBuffer();
    if (stopped) return;
    const a = audio();
    const out = groupOutput('voice');
    if (!a || !out) throw new Error('audio is unavailable');
    const buffer = await a.ctx.decodeAudioData(data);
    if (stopped) return;
    const gain = a.ctx.createGain();
    gain.gain.value = speakerGain();
    gain.connect(out);
    const dur = buffer.duration;
    await new Promise<void>((resolve) => {
      let src: AudioBufferSourceNode | null = null;
      let startedAt = 0; // the context's time at offset 0
      let pausedAt: number | null = null;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      let said = -1;
      const pos = () => (pausedAt ?? Math.min(dur, a.ctx.currentTime - startedAt));
      const halt = () => {
        clearTimeout(deadline);
        if (!src) return;
        src.onended = null;
        try {
          src.stop();
        } catch {
          // never started
        }
        src.disconnect();
        src = null;
      };
      const finish = () => {
        halt();
        clearInterval(ticker);
        resolve();
      };
      const play = (offset: number) => {
        halt();
        pausedAt = null;
        const s = a.ctx.createBufferSource();
        s.buffer = buffer;
        s.connect(gain);
        s.onended = finish;
        src = s;
        startedAt = a.ctx.currentTime - offset;
        s.start(0, offset);
        // A suspended context (a background tab, a headless browser) never ends the clip: don't let it stall the queue.
        deadline = setTimeout(finish, (dur - offset + 2) * 1000);
      };
      const ticker = setInterval(() => {
        const i = sentenceAt(words, (part + pos() / dur) / parts);
        if (i !== said) sentence((said = i));
      }, 200);
      end = finish;
      control = {
        id,
        c: {
          skip: () => {
            if (pausedAt !== null) return;
            const next = sentenceAt(words, (part + pos() / dur) / parts) + 1;
            const at = next < sentenceStarts(words).length ? sentenceFraction(words, next) * parts - part : 1;
            if (at < 1) play(Math.max(0, at) * dur);
            else finish();
          },
          pause: () => {
            if (pausedAt !== null) return;
            const p = pos();
            halt();
            pausedAt = p;
          },
          resume: () => pausedAt !== null && play(pausedAt),
          at: () => ({ sentence: sentenceAt(words, (part + pos() / dur) / parts), ms: Math.round(doneMs + pos() * 1000) }),
        },
      };
      play(0);
      if (part === 0) began(dur * 1000, parts);
      else speechClip(id, part, parts, dur * 1000);
    });
    end = null;
    gain.disconnect();
    doneMs += dur * 1000;
    if (stopped) return;
  }
}

// ---------- the browser's voice ----------

/** The browser's voices, waiting briefly for them to load the first time (they arrive asynchronously). */
async function browserVoices(synth: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> {
  if (synth.getVoices().length) return synth.getVoices();
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 1000);
    synth.addEventListener('voiceschanged', () => (clearTimeout(t), resolve()), { once: true });
  });
  return synth.getVoices();
}

/** Says `text` in the voice called `voiceName` (the browser's default when it's gone) at `rate`, telling `word` where it is. Rejects when it can't. */
async function speak(text: string, voiceName: string, rate: number, began: () => void, word: (charIndex: number) => void, stopper: (stop: () => void) => void = (stop) => (stopCurrent = stop)) {
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') throw new Error("this browser can't speak");
  if (!text) return;
  const u = new SpeechSynthesisUtterance(text);
  const v = (await browserVoices(synth)).find((x) => x.name === voiceName);
  if (v) {
    u.voice = v;
    u.lang = v.lang;
  }
  u.volume = level();
  u.rate = rate;
  await new Promise<void>((resolve, reject) => {
    // An utterance's volume is fixed once it starts, so muting stops it instead; a stuck engine gets a deadline.
    const unsubscribe = subscribeAudio(() => getAudioPrefs().muted && stop());
    const deadline = setTimeout(() => stop(), 20_000 + text.length * 150);
    let over = false;
    const done = (err?: string) => {
      if (over) return;
      over = true;
      clearTimeout(deadline);
      unsubscribe();
      if (err) reject(new Error(err));
      else resolve();
    };
    const stop = () => {
      done();
      synth.cancel();
    };
    stopper(stop);
    u.onstart = began;
    u.onboundary = (e) => e.name !== 'sentence' && word(e.charIndex);
    u.onend = () => done();
    u.onerror = (e) => done(e.error === 'interrupted' || e.error === 'canceled' ? undefined : `speech failed: ${e.error}`);
    synth.speak(u);
  });
}

/** A call's reply in the browser's voice: one sentence at a time, so Skip moves on and Pause picks the sentence up again. */
async function speakSentences(id: number, text: string, voiceName: string, rate: number, began: () => void, sentence: (index: number) => void) {
  const parts = splitSentences(text);
  let i = 0;
  let stopped = false;
  let paused = false;
  let cut: (() => void) | null = null;
  let wake: (() => void) | null = null;
  let spentMs = 0;
  let since: number | null = null;
  stopCurrent = () => {
    stopped = true;
    cut?.();
    wake?.();
  };
  control = {
    id,
    c: {
      skip: () => !paused && cut?.(),
      pause: () => {
        paused = true;
        cut?.();
      },
      resume: () => {
        paused = false;
        wake?.();
      },
      at: () => ({ sentence: i, ms: Math.round(spentMs + (since === null ? 0 : performance.now() - since)) }),
    },
  };
  let first = true;
  while (i < parts.length && !stopped) {
    if (paused) {
      await new Promise<void>((r) => (wake = r));
      wake = null;
      continue;
    }
    await speak(parts[i], voiceName, rate, () => {
      since = performance.now();
      if (first) began();
      first = false;
    }, () => undefined, (stop) => (cut = stop));
    if (since !== null) spentMs += performance.now() - since;
    since = null;
    cut = null;
    if (stopped || paused) continue; // paused: that sentence again on resume
    if (++i < parts.length) sentence(i);
  }
}
