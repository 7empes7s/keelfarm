// The Jarvis voice's brain (#534): what the office, as ElevenLabs Agents' custom LLM, says to each turn of a call.
// Pure and instant, so the call is never silent: questions about the company, a floor, open decisions or the
// server's health are answered from the office's own data; anything else goes to the CEO's session like a typed
// message, with a spoken "On it"; anything that changes things is asked first ("Should I…?") and done on a spoken
// yes. The client's markers read the CEO's answer and its progress lines out on the same voice.
import { speechText } from './speech.ts';

/** What a turn can see of the office, built by the server from the snapshot's sources. */
export interface BrainFacts {
  ceoName: string;
  floors: { floor: number; name: string; open: number; prs: number; mergedToday: number; agents: { name: string; status: string; doing: string }[] }[];
  ceoJob: string | null; // what the CEO is doing, in words, or null when free
  decisions: BrainDecision[]; // open ones, newest asked first
  it: { label: string; level: string; line: string }[] | null; // IT's checks (level 'ok' or worse); null: none yet
}

interface BrainDecision {
  id: string;
  kind: string; // shared/decisions.ts' kinds: team and charter are approve/reject, the others are answered with an option
  question: string;
  options: string[];
}

/** Something the manager said yes to, done by the server. */
export type BrainAct = { kind: 'decide'; id: string; option: string; approve?: boolean } | { kind: 'ceo'; text: string };

/** A call's memory between turns: a question waiting for a yes, and the decision last read out ("approve it"). */
export interface BrainState {
  pending: { act: BrainAct; what: string } | null;
  focus: string | null;
}

export const NO_BRAIN: BrainState = { pending: null, focus: null };

export interface BrainTurn {
  say: string;
  act?: BrainAct; // do this now (the manager said yes, or a question for the CEO)
  state: BrainState;
  /** The turn goes into the chat as a voice message (the CEO's own answers and progress lines are there already). */
  record: boolean;
  /** The manager's words are written by the hand-off itself (a message to the CEO). */
  handoff?: true;
}

/** A turn the client sends to have the CEO's message or progress line read out: `[[cubefarm:msg:12]]`. */
export const MARKER = /^\s*\[\[cubefarm:(msg|line):(\d+)\]\]\s*$/;
export const marker = (kind: 'msg' | 'line', id: number) => `[[cubefarm:${kind}:${id}]]`;

const YES = /^(yes|yeah|yep|yup|sure|ok(ay)?|please|do it|go ahead|go for it|confirm(ed)?|correct|absolutely|definitely|affirmative)\b/;
const NO = /^(no|nope|nah|don'?t|do not|cancel|stop|never ?mind|not now|wait|hold on)\b/;
const END = /^(that'?s all|that is all|that'?s it|bye|goodbye|good bye|hang up|end( the)? call|talk (to you )?later|thanks,? (that'?s|bye)|i'?m done)\b/;
const QUESTION = /^(what|what's|whats|who|who's|where|when|why|how|how's|which|is|are|was|were|do|does|did|can|could|would|will|should|has|have|any|tell me|give me|show me|status|update)\b/;
/** Words that change something: asked first, done on a yes. */
const CHANGE = /\b(approve|reject|decline|merge|close|file|create|open an?|hire|fire|let .+ go|delete|remove|start|stop|restart|deploy|release|assign|change|set|turn (on|off)|pause|resume|fix|build|add|update|cancel|rename|move|plan|ship|write|make)\b/;

const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The manager wants to end the conversation ("that's all", "bye"). */
export const wantsToEnd = (text: string) => END.test(norm(text));

const plural = (n: number, one: string, many = `${one}s`) => `${n === 0 ? 'no' : n} ${n === 1 ? one : many}`;
const NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
const listOf = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max).replace(/\s+\S*$/, '')}…` : s);

/** The floor a sentence names ("floor 4", "fourth floor"), or null. */
function floorOf(t: string): number | null {
  const word = `\\d+|${Object.keys(NUMBERS).join('|')}`;
  const m = new RegExp(`\\bfloor (${word})\\b`).exec(t) ?? new RegExp(`\\b(${word})(?:st|nd|rd|th)? floor\\b`).exec(t);
  if (!m) return null;
  return /^\d+$/.test(m[1]) ? Number(m[1]) : (NUMBERS[m[1]] ?? null);
}

function statusSay(f: BrainFacts): string {
  const people = f.floors.reduce((n, x) => n + x.agents.length, 0);
  const working = f.floors.reduce((n, x) => n + x.agents.filter((a) => a.doing).length, 0);
  const merged = f.floors.reduce((n, x) => n + x.mergedToday, 0);
  if (!f.floors.length) return 'No floors yet. Connect a repo and I can tell you about it.';
  const head = `${plural(f.floors.length, 'floor')}, ${plural(people, 'person', 'people')}, ${working} working right now, ${plural(merged, 'merge')} today.`;
  const busiest = [...f.floors].sort((a, b) => b.agents.filter((x) => x.doing).length - a.agents.filter((x) => x.doing).length).slice(0, 3);
  const lines = busiest.map((x) => `Floor ${x.floor}, ${x.name}: ${plural(x.open, 'open issue')}, ${plural(x.prs, 'pull request')}.`);
  const ceo = f.ceoJob ? `I'm ${f.ceoJob}.` : "I'm free."; // the voice is the CEO: never its own name (msg 4603)
  const asks = f.decisions.length ? ` ${plural(f.decisions.length, 'decision')} waiting on you.` : '';
  return `${head} ${lines.join(' ')} ${ceo}${asks}`;
}

function floorSay(f: BrainFacts, n: number): string {
  const x = f.floors.find((y) => y.floor === n);
  if (!x) return `There's no floor ${n}. ${f.floors.length ? `The floors are ${listOf(f.floors.map((y) => String(y.floor)))}.` : ''}`.trim();
  const busy = x.agents.filter((a) => a.doing).slice(0, 4).map((a) => `${a.name} is ${a.doing}`);
  const free = x.agents.filter((a) => !a.doing).length;
  const who = busy.length ? `${busy.join('; ')}.` : 'Nobody is working right now.';
  return `Floor ${n}, ${x.name}: ${plural(x.open, 'open issue')}, ${plural(x.prs, 'pull request')}, ${plural(x.mergedToday, 'merge')} today. ${who}${free ? ` ${plural(free, 'person', 'people')} free.` : ''}`;
}

function decisionsSay(f: BrainFacts): { say: string; focus: string | null } {
  const d = f.decisions;
  if (!d.length) return { say: 'Nothing is waiting on you. All decided.', focus: null };
  const first = d[0];
  const opts = first.kind === 'team' || first.kind === 'charter' ? 'Say approve or reject.' : first.options.length ? `The options are ${listOf(first.options.slice(0, 3))}.` : '';
  const more = d.length > 1 ? ` After that: ${listOf(d.slice(1, 3).map((x) => clip(x.question, 60)))}.` : '';
  return { say: `${plural(d.length, 'decision')} waiting. The first: ${clip(first.question, 140)} ${opts}${more}`, focus: first.id };
}

function itSay(f: BrainFacts): string {
  if (!f.it?.length) return "IT hasn't run its health checks yet.";
  const bad = f.it.filter((c) => c.level !== 'ok');
  if (!bad.length) return `The server looks healthy: all ${f.it.length} checks are fine.`;
  return `${plural(bad.length, 'check')} need${bad.length === 1 ? 's' : ''} a look. ${bad.slice(0, 3).map((c) => `${c.label}: ${c.line}.`).join(' ')}`;
}

/** The decision "approve it" / "the second one" / "the hire" is about: a numbered one, else the one last read out, else the first. */
function decisionFor(t: string, f: BrainFacts, focus: string | null): BrainDecision | null {
  const m = /\b(first|second|third|fourth|fifth|one|two|three|four|five|\d+)\b/.exec(t);
  const n = m ? (/^\d+$/.test(m[1]) ? Number(m[1]) : NUMBERS[m[1]]) : 0;
  if (n && f.decisions[n - 1]) return f.decisions[n - 1];
  return f.decisions.find((d) => d.id === focus) ?? f.decisions[0] ?? null;
}

/** "Approve it" or "reject it" on a decision: the act and how it's asked, or why it can't be done by voice. */
function decideAct(d: BrainDecision, approve: boolean): { act: BrainAct; what: string } | string {
  if (d.kind === 'team' || d.kind === 'charter') return { act: { kind: 'decide', id: d.id, option: approve ? 'Approve' : 'Reject', approve }, what: `${approve ? 'approve' : 'reject'} "${clip(d.question, 90)}"` };
  const pick = d.options.find((o) => (approve ? /^(yes|approve|go|ok|do it|merge|accept|ship)/i : /^(no|not|skip|reject|don'?t|leave|later)/i).test(o.trim())) ?? (approve ? d.options[0] : undefined);
  if (!pick) return `I can't answer that one with ${approve ? 'approve' : 'reject'}; its options are in the chat.`;
  return { act: { kind: 'decide', id: d.id, option: pick }, what: `answer "${clip(d.question, 80)}" with "${pick}"` };
}

/**
 * One turn of a call: `text` is what the manager just said. Instant answers from `facts`, a hand-off to the CEO, or a
 * "Should I…?" kept in `state` until a yes or no.
 */
export function brainTurn(text: string, state: BrainState, facts: BrainFacts): BrainTurn {
  const t = norm(text);
  const out = (say: string, next: Partial<BrainState> = {}, extra: Partial<BrainTurn> = {}): BrainTurn => ({ say: speechText(say, 600), state: { ...state, pending: null, ...next }, record: true, ...extra });
  if (!t) return out("Sorry, I didn't catch that.", { pending: state.pending });
  if (state.pending) {
    if (YES.test(t)) return out(state.pending.act.kind === 'ceo' ? "On it. I'll tell you when it's done." : 'Done.', {}, { act: state.pending.act, ...(state.pending.act.kind === 'ceo' && { handoff: true as const }) });
    if (NO.test(t)) return out("Okay, I won't.");
  }
  if (wantsToEnd(text)) return out('Okay. Talk soon.');
  const approve = /^(approve|accept|yes to|say yes|go with|okay|ok) ?(it|that|this|the|one)?\b/.test(t) || /\bapprove\b/.test(t);
  const reject = /^(reject|decline|deny|say no|no to)\b/.test(t) || /\b(reject|decline)\b/.test(t);
  if ((approve || reject) && facts.decisions.length && !/\b(pr|pull request|issue)\b/.test(t)) {
    const d = decisionFor(t, facts, state.focus);
    if (d) {
      const a = decideAct(d, approve && !reject);
      if (typeof a === 'string') return out(a, { focus: d.id });
      return out(`Should I ${a.what}?`, { pending: a, focus: d.id });
    }
  }
  if (/\b(decision|decisions|approval|approvals|waiting on me|need me|needs me|needs you|anything for me)\b/.test(t)) {
    const d = decisionsSay(facts);
    return out(d.say, { focus: d.focus });
  }
  if (/\b(health|server|disk|memory|ram|cpu|load|backups?|it department|it status|it health)\b/.test(t) && !CHANGE.test(t)) return out(itSay(facts));
  const floor = floorOf(t);
  if (floor !== null && !CHANGE.test(t)) return out(floorSay(facts, floor));
  if (/\b(status|how are we doing|how's it going|how is it going|what's everyone|what is everyone|everyone doing|everyone working|overview|catch me up|what's happening|what is happening)\b/.test(t) && !CHANGE.test(t)) return out(statusSay(facts));
  // Real work goes to the CEO: a question at once, a change once you've said yes.
  const ask = clip(text.trim().replace(/[.?!]+$/, ''), 160);
  if (CHANGE.test(t) && !QUESTION.test(t)) return out(`Should I ${ask.charAt(0).toLowerCase()}${ask.slice(1)}?`, { pending: { act: { kind: 'ceo', text: text.trim() }, what: ask } });
  return out("On it. I'll look into that now and tell you when I have it.", {}, { act: { kind: 'ceo', text: text.trim() }, handoff: true });
}

/** A turn sent again this soon with the same words is the same turn (msgs 4593/4595: every utterance reached the chat twice). */
const REPEAT_MS = 8000;

/** Whether `text` repeats the last turn (`last`) within a few seconds: answered again, never forwarded twice. Never a yes or no. */
export function repeatTurn(last: { text: string; at: number } | undefined, text: string, now: number): boolean {
  const t = norm(text);
  if (YES.test(t) || NO.test(t)) return false; // a yes or no answers a new "Should I…?" each time
  return !!last && now - last.at < REPEAT_MS && norm(last.text) === t;
}

/** A marker's words: the CEO's spoken answer (with "the full answer's in the chat" when it's longer), or a progress line. */
export function markerSay(spoken: string, longer: boolean): string {
  const s = speechText(spoken, 600);
  return longer ? `${s} The full answer's in the chat.` : s;
}

/** The last thing the manager said in an OpenAI-style message list (ElevenLabs sends the whole conversation each turn). */
export function lastUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: unknown; content?: unknown };
    if (m?.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content.slice(0, 2000);
    if (Array.isArray(m.content)) return m.content.map((p: { text?: unknown }) => (typeof p?.text === 'string' ? p.text : '')).join(' ').slice(0, 2000);
    return '';
  }
  return '';
}
