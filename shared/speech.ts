// What a phone message sounds like read aloud: markdown and emoji out, issue numbers and links said the way a person
// would. Used by the server's ElevenLabs voice and by the browser's own voice, so both read the same words.

/** About how much of a message is spoken; the cut lands on a sentence end. */
export const SPEECH_MAX_CHARS = 1500;

/** What the settings' Test button says, in ElevenLabs' voice or the browser's. */
export const SAMPLE_LINE = "Hi! This is how I'll sound when I message you from the office.";

import type { PhoneMessage } from './types.ts';

const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u{1F3FB}-\u{1F3FF}‍︎️⃣]/gu;
const URL = /\b(?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,;:!?'"]/gi;

/** The words to speak for a message: plain sentences, at most about `max` characters. */
export function speechText(text: string, max = SPEECH_MAX_CHARS): string {
  let s = text.replace(/\r\n?/g, '\n');
  s = s.replace(/```[\s\S]*?(```|$)/g, '\n'); // code blocks aren't worth hearing
  s = s.replace(/`([^`\n]*)`/g, '$1');
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  s = s.replace(/<(https?:[^>\s]+)>/g, '$1');
  s = s.replace(/<\/?[a-z][^>]*>/gi, '');
  s = s.replace(URL, 'a link');
  s = s.replace(EMOJI, '');
  s = s.replace(/(\*\*|__)(.+?)\1/g, '$2');
  s = s.replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1$2');
  s = s.replace(/(^|[^\w])_(?!\s)([^_\n]+?)_(?!\w)/g, '$1$2');
  s = s.replace(/~~(.+?)~~/g, '$1');
  s = s.replace(/#(\d+)\b/g, 'number $1');

  const lines: string[] = [];
  for (let line of s.split('\n')) {
    line = line
      .replace(/^\s*#{1,6}\s+/, '') // headings
      .replace(/^\s*>+\s?/, '') // quotes
      .replace(/^\s*[-*+•]\s+/, '') // bullets
      .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/, '') // table rules
      .replace(/^\s*([-*_]\s*){3,}$/, '') // horizontal rules
      .replace(/\s*\|\s*/g, ', ')
      .replace(/^[,\s]+|[,\s]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!line) continue;
    // A line without its own punctuation (a list item, a heading) still gets a pause.
    lines.push(/[.!?:;,…]$/.test(line) ? line : `${line}.`);
  }
  return cut(lines.join(' ').replace(/\s+([.,!?;:])/g, '$1'), max);
}

/** The CEO's spoken summary of a reply (a ```spoken block, #282), at most: 1-3 sentences. */
export const SPOKEN_MAX_CHARS = 300;
/** A message without one is heard as its first paragraph, at most this many sentences. */
const BRIEF_SENTENCES = 3;

/** A spoken summary as it's said: plain words, no "#", links or markdown, at most SPOKEN_MAX_CHARS. */
export function spokenLine(raw: string): string {
  return speechText(raw.replace(/#(\d+)\b/g, '$1').replace(URL, ''), SPOKEN_MAX_CHARS)
    .replace(/#/g, '')
    .replace(/\ba link\b[,;]?\s*/g, '')
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The fallback summary: a message's first paragraph with something to say, at most `sentences` sentences. */
export function briefSpeech(text: string, sentences = BRIEF_SENTENCES): string {
  for (const para of text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const said = speechText(para);
    // A heading alone, or a quote of what it answers, isn't a summary.
    if (!said || /^\s*#{1,6}\s[^\n]*$/.test(para) || para.trim().split('\n').every((l) => /^\s*>/.test(l))) continue;
    const ends = [...said.matchAll(/[.!?…](?=\s|$)/g)];
    return ends.length > sentences ? said.slice(0, ends[sentences - 1].index + 1) : said;
  }
  return '';
}

/** Filler, not news: "I've answered message 1865 on your phone", "Both messages are answered". Never read aloud. */
export function bookkeeping(said: string): boolean {
  return /\bmessages?\s+(?:number\s+)?\d+\b/i.test(said) || /\b(?:answered|replied)\b[^.!?]*\b(?:phone|chat)\b/i.test(said) || /\b(?:both|all|every)\b[^.!?]*\bmessages?\b[^.!?]*\b(?:answered|replied)\b/i.test(said);
}

/**
 * What a new CEO message says aloud (#282): its spoken line, unless that's bookkeeping, else its first sentences (the
 * fallback) unless those are. `afterReply`: the turn already answered with the reply tool, so its closing text is read
 * only when it has a useful spoken line of its own.
 */
export function spokenOf(m: { text: string; spoken?: string }, afterReply: boolean): { spoken?: string; silent?: true } {
  if (m.spoken && !bookkeeping(m.spoken)) return { spoken: m.spoken };
  return afterReply || bookkeeping(briefSpeech(m.text)) ? { silent: true } : {};
}

/**
 * A phone message's words aloud: the CEO's spoken summary, else its first few sentences (#282); `whole` (the ⋯ menu's
 * "Read the whole message") reads its text up to `max`. Then its attachments by title, never their contents.
 */
export function messageSpeech(m: Pick<PhoneMessage, 'text' | 'artifacts' | 'spoken'>, opts: { whole?: boolean; max?: number } = {}): string {
  if (!opts.whole && m.spoken) return m.spoken;
  const titles = m.artifacts?.map((a) => a.title) ?? [];
  const extra = !titles.length ? '' : titles.length === 1 ? `Plus an attachment: ${titles[0]}.` : `Plus ${titles.length} attachments: ${titles.join('; ')}.`;
  return [opts.whole ? speechText(m.text, opts.max) : briefSpeech(m.text), extra].filter(Boolean).join(' ');
}

/** Cut at the last sentence end within `max`; with none in its second half, at the last word, with an ellipsis. */
function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max + 1);
  const ends = [...head.matchAll(/[.!?…](?=\s|$)/g)];
  const end = ends.length ? ends[ends.length - 1].index + 1 : -1;
  if (end >= max / 2) return s.slice(0, end);
  const space = s.lastIndexOf(' ', max);
  return `${s.slice(0, space > 0 ? space : max).replace(/[,;:\s]+$/, '')}…`;
}

// ---------- the stand-up ----------

/** The part of the day a stand-up greets (the office clock's hour, 0-24). */
export const DAY_PARTS = ['morning', 'afternoon', 'evening'] as const;
export type DayPart = (typeof DAY_PARTS)[number];
export const dayPart = (hour: number): DayPart => (hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : 'evening');

const COUNTS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const GREETING: Record<DayPart, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };

/**
 * What the CEO says at a stand-up at the whiteboard (the 3D office's rituals), for `count` new issues. The server only
 * ever voices these lines, so each is made once and cached like any other clip.
 */
export function standupLine(count: number, part: DayPart): string {
  const n = Math.max(1, Math.floor(count));
  const how = n < COUNTS.length ? COUNTS[n] : 'a pile of';
  return `${GREETING[part]} team, ${how} new feature${n === 1 ? '' : 's'} today!`;
}
