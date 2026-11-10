// The CEO's context diet, part 2 (#330), pure: which jobs carry on in the chat's kept session and which start fresh,
// the short digest a fresh session starts with (built by the office, no model call), and the handover a full chat
// session leaves the next one.
import type { CeoJobKind, PhoneMessage } from '../shared/types.ts';
import type { CeoAwakeSettings } from '../shared/ceoAwake.ts';
import type { CeoMandate } from '../shared/followups.ts';
import type { MemoryNote } from '../shared/ceoMemory.ts';
import { mandateWhere } from '../shared/followups.ts';
import { waitingDecisions, type Decision } from '../shared/decisions.ts';

/** The jobs that start fresh with CEO settings' freshJobs on: they don't re-send the whole chat. */
export const BACKGROUND_KINDS: readonly CeoJobKind[] = ['review', 'followup', 'triage', 'research', 'plan'];

/**
 * How a job's session starts. `fresh`: a session of its own, apart from the chat's kept one (which it leaves alone);
 * else `resume` says whether it carries on in the kept session (`step`, from ceoSessionStep): a chat does unless
 * the kept session is full or idle.
 */
export function ceoJobSession(kind: CeoJobKind, s: Pick<CeoAwakeSettings, 'freshJobs'>, step: { resume: boolean; why: string | null }, redo = false): { fresh: boolean; resume: boolean; why: string | null } {
  if (redo || (s.freshJobs && BACKGROUND_KINDS.includes(kind))) return { fresh: true, resume: false, why: null }; // a redo always starts fresh (#332)
  return { fresh: false, resume: step.resume || (kind === 'chat' && !step.why), why: step.why };
}

// ---------- the digest ----------

/** What the CEO's latest background job said and filed, so a chat about it still knows (state.ceo.lastJob). */
export interface CeoJobNote {
  kind: CeoJobKind;
  label: string;
  at: number;
  text: string; // its final message, clipped
  issues: string[]; // its filed issues' cards: "Filed floor 3 #104 · title"
}

export interface DigestInput {
  messages: readonly PhoneMessage[]; // the current conversation
  decisions: readonly Decision[];
  mandates: readonly CeoMandate[]; // the live ones
  remember: readonly MemoryNote[];
  lastJob: CeoJobNote | null;
  now: number;
}

export const DIGEST_MAX = 6000; // characters: about 1,500 tokens
const EXCHANGES = 10;
const REPLY_CHARS = 300;
const NOTE_CHARS = 600;

const clip = (t: string, n: number) => {
  const one = t.replace(/```[\s\S]*?(```|$)/g, ' ').replace(/\s+/g, ' ').trim(); // fenced blocks (spoken, ideas, charts) say it again or are data
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

/** The issues a CEO message's action cards say it filed. */
const filedIssues = (m: Pick<PhoneMessage, 'actions'>): string[] => (m.actions ?? []).filter((a) => a.tool === 'file_issue' && !a.refused).map((a) => a.text);

/** A background job's last reply, as its note. */
export const jobNote = (kind: CeoJobKind, label: string, text: string, m: Pick<PhoneMessage, 'actions'>, at: number): CeoJobNote => ({ kind, label, at, text: clip(text, NOTE_CHARS), issues: filedIssues(m) });

/** The last `EXCHANGES` exchanges: each manager message and the start of the CEO's first reply to it. */
function exchanges(messages: readonly PhoneMessage[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.from !== 'manager') continue;
    let reply: PhoneMessage | undefined;
    for (let j = i + 1; j < messages.length && messages[j].from !== 'manager'; j++) {
      if (messages[j].from === 'ceo' && messages[j].text.trim()) {
        reply = messages[j];
        break;
      }
    }
    out.push(`- Manager: ${clip(m.text, REPLY_CHARS)}${reply ? `\n  You: ${clip(reply.text, REPLY_CHARS)}` : ''}`);
  }
  return out.slice(-EXCHANGES);
}

const section = (title: string, lines: readonly string[]) => (lines.length ? `${title}\n${lines.join('\n')}` : '');

/** The digest a fresh CEO session starts with, at most DIGEST_MAX characters (the oldest exchanges go first). */
export function ceoDigest(d: DigestInput): string {
  const lastReply = [...d.messages].reverse().find((m) => m.from === 'ceo' && m.actions?.length);
  const job = d.lastJob;
  const tail = [
    section('Open decisions:', waitingDecisions(d.decisions, d.now).map((x) => `- ${x.id}: ${clip(x.question, 200)}`)),
    section('Live mandates:', d.mandates.map((m) => `- ${clip(m.text, 200)} (${mandateWhere(m)})`)),
    section('The manager asked you to always remember:', d.remember.map((n) => `- ${n.text}`)),
    section('Issues your last chat reply filed:', lastReply ? filedIssues(lastReply).map((t) => `- ${t}`) : []),
    job ? section(`Your latest background job (${job.label}):`, [job.text, ...job.issues.map((t) => `- ${t}`)].filter(Boolean)) : '',
  ].filter(Boolean);
  const chat = exchanges(d.messages);
  const build = () => ['Digest from the office (your session starts fresh; your notes file has the rest):', section('Recent chat with the manager, oldest first:', chat), ...tail].filter(Boolean).join('\n\n');
  let text = build();
  while (text.length > DIGEST_MAX && chat.length) {
    chat.shift();
    text = build();
  }
  return text.length > DIGEST_MAX ? `${text.slice(0, DIGEST_MAX - 1)}…` : text;
}

/** For a chat carrying on in its session: what the latest background job said, when it came after the session's last job ('' else). */
export function sinceLastChat(note: CeoJobNote | null, since: number | null): string {
  if (!note || note.at <= (since ?? 0)) return '';
  return `\n\nSince your last chat, your background job (${note.label}) said: ${note.text}${note.issues.length ? `\n${note.issues.map((t) => `- ${t}`).join('\n')}` : ''}`;
}

// ---------- the handover ----------

/** What a full chat session leaves the next one (state.ceo.handover), kept until a fresh session gets it. */
export interface CeoHandover {
  text: string;
  at: number;
}

const HANDOVER_WORDS = 400;

/** What the outgoing session is asked: it isn't sent to the manager. */
export const HANDOVER_PROMPT = `Your session is full, so your next one starts fresh. Write a handover for it in at most ${HANDOVER_WORDS} words: what's in flight, what the manager is waiting for, promises you made. Plain text, no tools. The manager doesn't see it.`;

/** The outgoing session's answer as a handover: trimmed to HANDOVER_WORDS words; null when it said nothing. */
export function handoverOf(text: string, now: number): CeoHandover | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length ? { text: words.length > HANDOVER_WORDS ? `${words.slice(0, HANDOVER_WORDS).join(' ')}…` : text.trim(), at: now } : null;
}

/** A handover as saved in state.json, or null. */
export function loadHandover(raw: unknown): CeoHandover | null {
  const h = raw as Partial<CeoHandover> | null | undefined;
  return h && typeof h.text === 'string' && h.text.trim() && typeof h.at === 'number' ? { text: h.text, at: h.at } : null;
}

const START_END = '\n\n--- end of digest ---\n\n';

/** What a fresh session's first prompt starts with: the handover when there is one, and the digest. */
export const freshStart = (digest: string, handover: CeoHandover | null): string => `${handover ? `Handover from your previous session:\n${handover.text}\n\n` : ''}${digest}${START_END}`;

/** A prompt split into its fresh start ('' without one) and the job after it (the demo CEO reads the job). */
export function splitFreshStart(prompt: string): { start: string; job: string } {
  const i = prompt.indexOf(START_END);
  return i >= 0 && /^(Handover from your previous session:|Digest from the office)/.test(prompt) ? { start: prompt.slice(0, i), job: prompt.slice(i + START_END.length) } : { start: '', job: prompt };
}
