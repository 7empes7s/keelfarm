// What an agent says out loud when clicked (#321): one short line from their real state, in their own voice. Pure: a
// phrasebook of templates filled in with real facts (#numbers, a few words of a title, a teammate's name), a few
// variants per situation taken in turn so it doesn't repeat, and no model call per click. Lines may carry Eleven v4's
// audio tags ([laughs], [sighs], [yawns]); they're spoken only by a v4 model, and stripped for the bubble, the
// captions, other models and the browser voice. The server picks the line (server/swarm/voices.ts) and makes the clip.
import { needsYou, type NeedsWhy } from './needsYou.ts';
import type { AgentStatus, AgentTask } from './types.ts';

/** A new line (and so maybe a new clip) at most this often per agent; a click inside it says the last line again. */
export const LINE_COOLDOWN_MS = 20_000;
/** A merge this recent is still news. */
export const MERGE_NEWS_MS = 15 * 60_000;
/** Lines stay short: about 12 words, tags not counted. */
export const LINE_MAX_WORDS = 12;

/** What the line is about. */
export type LineSituation =
  | { kind: 'stuck'; why: NeedsWhy | 'error' }
  | { kind: 'merged'; pr: number }
  | { kind: 'night'; issue: number | null }
  | { kind: 'building'; issue: number | null; title: string }
  | { kind: 'preparing'; issue: number | null }
  | { kind: 'testing'; pr: number | null; author: string }
  | { kind: 'fixing'; pr: number | null }
  | { kind: 'memory' }
  | { kind: 'free' }
  | { kind: 'ceo'; busy: number; free: number; needs: number; merged: number };

/** The facts a line reads (AgentView has most of them; the rest the server works out). */
export interface LineFacts {
  status: AgentStatus;
  task: AgentTask | null;
  issueNumber: number | null;
  issueTitle: string | null;
  prNumber: number | null;
  blocked?: string | null;
  waiting?: 'ceo' | 'manager' | null;
  needsSignIn?: boolean;
  /** Their newest merged PR and when it merged (career.recent[0]). */
  lastMerge: { pr: number; at: number } | null;
  /** While testing: the name of whoever wrote the PR ('' unknown). */
  author: string;
  /** Work waits for memory right now (the health strip's held work). */
  memoryWait: boolean;
  /** The manager's local hour, 0–23. */
  hour: number;
  now: number;
}

/** Late enough that anyone would want to be in bed. */
const isNight = (hour: number) => hour >= 23 || hour < 5;

/** What an agent's line is about: needing the manager first, then fresh news, the hour, and their work. */
export function lineSituation(f: LineFacts): LineSituation {
  const why = needsYou(f);
  if (why) return { kind: 'stuck', why };
  if (f.status === 'error') return { kind: 'stuck', why: 'error' };
  if (f.lastMerge && f.now - f.lastMerge.at < MERGE_NEWS_MS) return { kind: 'merged', pr: f.lastMerge.pr };
  const busy = f.status === 'working' || f.status === 'preparing';
  if (isNight(f.hour)) return { kind: 'night', issue: busy ? f.issueNumber : null };
  if (f.status === 'preparing') return { kind: 'preparing', issue: f.issueNumber };
  if (f.status === 'working') {
    if (f.task === 'qa') return { kind: 'testing', pr: f.prNumber, author: f.author };
    if (f.task === 'fix') return { kind: 'fixing', pr: f.prNumber };
    return { kind: 'building', issue: f.issueNumber, title: f.issueTitle ?? '' };
  }
  if (f.memoryWait) return { kind: 'memory' };
  return { kind: 'free' };
}

/** Words a cut-off title shouldn't end on. */
const DANGLING = new Set(['a', 'an', 'the', 'for', 'to', 'of', 'and', 'or', 'in', 'on', 'with', 'by', 'at', 'from']);

/** A few words of an issue's title for a spoken line: "Lighter QA browser for tests" → "lighter QA browser". */
export function shortTitle(title: string, words = 4): string {
  const w = title
    .replace(/\[[^\]]*\]|\(#?\d+\)|#\d+/g, ' ')
    .split(':')
    .pop()!
    .replace(/[^\p{L}\p{N}' -]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, words);
  while (w.length > 1 && DANGLING.has(w[w.length - 1].toLowerCase())) w.pop();
  if (!w.length) return '';
  // "Fix the ..." reads as "fix the ...", but an acronym (QA, CI) or a name keeps its capitals.
  if (!/^\p{Lu}{2}/u.test(w[0])) w[0] = w[0].toLowerCase();
  return w.join(' ');
}

const pr = (n: number | null) => (n ? `PR #${n}` : 'this PR');
const issue = (n: number | null) => (n ? `#${n}` : 'my issue');
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Pool<K extends LineSituation['kind']> = ((s: Extract<LineSituation, { kind: K }>) => string)[];

const STUCK: Record<NeedsWhy | 'error', string[]> = {
  question: ["[sighs] I've got a question for you. Can you look?", 'Quick question waiting on my phone for you.', "I'm stuck until you answer my question."],
  prompt: ["[sighs] I'm stuck on a prompt. Can you look?", 'My terminal is asking something only you can answer.', "Stuck on a prompt. I'd love a hand!"],
  'sign-in': ["[sighs] I'm stuck on the sign-in step. Can you look?", 'I need you to sign me in, please.', "Can't log in. Could you sign me in?"],
  error: ['[sighs] Something broke on my end. Can you look?', 'I hit an error. Could you take a look?', "Ugh, an error. I'm stuck for now."],
};

const POOLS: { [K in LineSituation['kind']]: Pool<K> } = {
  stuck: [(s) => STUCK[s.why][0], (s) => STUCK[s.why][1], (s) => STUCK[s.why][2]],
  merged: [(s) => `[laughs] ${pr(s.pr)} merged, let's go!`, (s) => `${pr(s.pr)} just landed. Feels good!`, (s) => `[laughs] Shipped ${pr(s.pr)}. High five!`],
  night: [
    (s) => (s.issue ? `[yawns] Still on #${s.issue}. I need sleep.` : '[yawns] I need sleep.'),
    () => "[yawns] It's late. Coffee, please.",
    (s) => (s.issue ? `[whispers] Night shift on #${s.issue}. Don't tell anyone.` : "[whispers] Everyone's asleep. Just us now."),
  ],
  building: [
    (s) => (s.title ? `I'm on ${issue(s.issue)}, ${s.title}. Going well!` : `I'm on ${issue(s.issue)}. Going well!`),
    (s) => `Deep in ${issue(s.issue)} right now. Almost there!`,
    (s) => `Building ${issue(s.issue)}. Tests next.`,
  ],
  preparing: [(s) => `Setting up for ${issue(s.issue)}. One sec.`, () => 'Getting my desk ready. Nearly set!', (s) => `Installing things for ${issue(s.issue)}.`],
  testing: [
    (s) => (s.author ? `Checking ${s.author}'s ${pr(s.pr)}, one sec.` : `Checking ${pr(s.pr)}, one sec.`),
    (s) => `Testing ${pr(s.pr)}. Looking good so far.`,
    (s) => `Clicking through ${pr(s.pr)} in the browser.`,
  ],
  fixing: [(s) => `QA sent ${pr(s.pr)} back, fixing the tests.`, (s) => `Fixing what QA found on ${pr(s.pr)}.`, () => '[sighs] Round two. Fixing it now.'],
  memory: [() => 'Waiting for memory, grabbing a coffee.', () => 'No room on the server yet. Coffee time!', () => "I'm queued for memory. Back soon."],
  free: [() => 'Free! Got anything for me?', () => 'Nothing on my desk. Send me something!', () => "I'm free. What's next?"],
  ceo: [
    (s) => `${count(s.busy, 'agent')} busy, ${s.free} free, ${count(s.merged, 'merge')} today.`,
    (s) => (s.needs ? `${count(s.needs, 'agent')} could use you. Otherwise all good!` : `All good! ${count(s.busy, 'agent')} at work.`),
    (s) => (s.merged ? `[laughs] ${count(s.merged, 'PR')} merged today. Nice work, team!` : `${count(s.busy, 'agent')} busy. No merges yet today.`),
  ],
};

/** A small number from an agent's id, so teammates don't all start on the same variant. */
function seedOf(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/** How many variants a situation has. */
export const variants = (kind: LineSituation['kind']) => POOLS[kind].length;

/**
 * The line for `s`, with its audio tags: variant `turn` (each agent's lines so far), offset by their id, so a click
 * after the cooldown says it another way and two agents in the same state say different things.
 */
export function agentLine(s: LineSituation, turn: number, id = ''): string {
  const pool = POOLS[s.kind] as ((x: LineSituation) => string)[];
  return pool[(seedOf(id) + turn) % pool.length](s);
}

const TAG = /\[(?:laughs|sighs|yawns|whispers)\]\s*/g;

/** Eleven v4 and v4 Turbo understand audio tags; other models would read them out. */
const isV4 = (model: string) => model.startsWith('eleven_v4');

/** What's written (bubble, captions) and what the browser voice says: the line without its tags. */
export const lineText = (line: string) => line.replace(TAG, '').trim();

/** What ElevenLabs is asked to say: the tags only for a v4 model. */
export const spokenLine = (line: string, model: string) => (isV4(model) ? line.trim() : lineText(line));

/** An agent's last line: when it was picked, how many they've had, and the line. */
export interface LastLine {
  at: number;
  turn: number;
  line: string;
}

/** Whether a click at `now` gets a new line (else the last one again, so its clip replays from the cache). */
export const freshLine = (last: LastLine | undefined, now: number) => !last || now - last.at >= LINE_COOLDOWN_MS;

/** The line a click at `now` gets, and what to remember for the next one. */
export function nextLine(last: LastLine | undefined, now: number, s: LineSituation, id: string): LastLine {
  if (!freshLine(last, now)) return last!;
  const turn = last ? last.turn + 1 : 0;
  let line = agentLine(s, turn, id);
  // The same words twice in a row (another situation's variant could match) take the next variant.
  if (last && lineText(line) === lineText(last.line) && variants(s.kind) > 1) line = agentLine(s, turn + 1, id);
  return { at: now, turn, line };
}

/** What a tab knows when someone is clicked. */
export interface LineGate {
  agentsSpeak: boolean; // Settings → Voice → Agents speak when clicked
  provider: 'off' | 'browser' | 'elevenlabs';
  keySet: boolean;
  demo: boolean;
  muted: boolean;
  replaying: boolean;
  reading: boolean; // a phone message is being read aloud: nobody talks over it
}

/**
 * Who says a clicked agent's line: ElevenLabs (its provider on, with a key), the browser's voice in the demo (no key
 * needed there), or nobody, and they babble as before.
 */
export function lineVoice(g: LineGate): 'elevenlabs' | 'browser' | null {
  if (!g.agentsSpeak || g.muted || g.replaying || g.reading) return null;
  if (g.provider === 'elevenlabs' && g.keySet) return 'elevenlabs';
  return g.demo ? 'browser' : null;
}
