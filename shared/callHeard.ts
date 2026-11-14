// What a call does with a finished transcript (#694): the manager's words go on, the voice's own echo, its greeting
// heard back, noise and repeats never do. Pure, for the browser (every listener) and the office (ElevenLabs' own
// transcripts, which reach the office's LLM without passing the browser's check).

/** Why a transcript isn't the manager's turn: '' when it is. */
export type HeardDrop = '' | 'echo' | 'self' | 'noise' | 'short' | 'unsure' | 'repeat';

/** A heard transcript sharing this much of its words with something the voice just said is that thing's echo. */
export const ECHO_SHARE = 0.6;
/** What the voice said counts for echo this long after it ended. */
export const SPOKEN_MS = 30_000;
/** The same words again within this long are a recognizer repeating itself. */
export const REPEAT_MS = 8_000;
/** Below this the recognizer wasn't sure (0 or missing: the browser didn't say). */
export const MIN_CONFIDENCE = 0.5;

const NUMBERS: Record<string, string> = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };

/** A transcript's words, lower case, without punctuation or apostrophes, numbers as digits. */
export const heardWords = (t: string): string[] =>
  t
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => NUMBERS[w] ?? w);

/** Sounds and fragments that are never a turn on their own, as recognizers write a cough, a breath or the room. */
const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'uhm', 'er', 'erm', 'ah', 'ahh', 'oh', 'eh', 'hm', 'hmm', 'mm', 'mhm', 'mmm', 'men', 'man', 'huh', 'the', 'a', 'and', 'so', 'on', 'it', 'on it', 'uh huh', 'i', 'you']);
/** One-word turns the manager really says: answers and commands. */
const ONE_WORD = new Set(['yes', 'no', 'yeah', 'yep', 'nope', 'stop', 'cancel', 'wait', 'okay', 'ok', 'sure', 'bye', 'thanks', 'continue', 'merge', 'approve', 'reject']);

/** Of those, this share of its word pairs in the same order too: an echo is the words as said, a follow-up reuses a few. */
const PAIR_SHARE = 0.4;

const pairs = (w: readonly string[]) => w.slice(1).map((x, i) => `${w[i]} ${x}`);

/** Whether `heard` is the voice's own words: most of its words, and enough of them in order, are in one thing it said. */
export function echoOf(heard: string, spoken: readonly string[], share = ECHO_SHARE): boolean {
  const w = heardWords(heard);
  if (!w.length) return false;
  const p = pairs(w);
  return spoken.some((s) => {
    const sw = heardWords(s);
    const said = new Set(sw);
    if (!said.size || w.filter((x) => said.has(x)).length / w.length < share) return false;
    const saidPairs = new Set(pairs(sw));
    return !p.length || p.filter((x) => saidPairs.has(x)).length / p.length >= PAIR_SHARE;
  });
}

/** The voice introducing itself ("hi, it's me, Mimoun"): its greeting, never the manager's words. */
export function selfIntro(heard: string, names: readonly string[]): boolean {
  const t = heardWords(heard).join(' ');
  const who = [...names.flatMap(heardWords), 'moon', 'mimoun'].join('|'); // recognizers hear the CEO's name as "moon"
  return new RegExp(`\\b(its|this is|it is) (me )?(${who})\\b`).test(t) || /\b(hi|hey|hello) (its|this is) me\b/.test(t);
}

export interface HeardCheck {
  /** What the voice said lately (the greeting, the replies), with when it ended (ms); older than SPOKEN_MS is ignored. */
  spoken: readonly { text: string; at: number }[];
  /** The CEO's name, for its greeting. */
  names: readonly string[];
  /** Turns already forwarded, with when. */
  sent: readonly { text: string; at: number }[];
  now: number;
  /** The recognizer's confidence (0..1), when it gives one. */
  confidence?: number;
}

/** Why `text` isn't a turn ('' when it is): checked once per finished transcript, before it's sent or posted. */
export function heardDrop(text: string, c: HeardCheck): HeardDrop {
  const w = heardWords(text);
  const joined = w.join(' ');
  if (!w.length || w.every((x) => FILLERS.has(x)) || FILLERS.has(joined)) return 'noise';
  if (w.length < 2 && !ONE_WORD.has(w[0])) return 'short';
  if (c.confidence && c.confidence < MIN_CONFIDENCE) return 'unsure';
  if (selfIntro(text, c.names)) return 'self';
  const recent = c.spoken.filter((s) => c.now - s.at <= SPOKEN_MS).map((s) => s.text);
  if (w.length > 1 && echoOf(text, recent)) return 'echo'; // a lone "yes" is in plenty of replies
  if (c.sent.some((s) => c.now - s.at <= REPEAT_MS && heardWords(s.text).join(' ') === joined)) return 'repeat';
  return '';
}

/** Words for the trace. */
export const DROP_WORDS: Record<Exclude<HeardDrop, ''>, string> = {
  echo: "the voice's own words heard back",
  self: "the voice's greeting heard back",
  noise: 'noise or a filler',
  short: 'a single stray word',
  unsure: 'the recognizer was unsure',
  repeat: 'the same words again',
};
