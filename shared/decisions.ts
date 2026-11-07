// Open decisions (#114): every question put to the manager that they haven't answered yet (a CEO message's
// ```suggestions block or ask_manager, an agent's question the CEO passed on, a team change, a charter proposal),
// kept until it's answered, decided, gone, dropped or old, so the chat's tray and the approvals can bring it back and
// the CEO knows what's still open. Pure: the swarm keeps the list (server/swarm/team.ts), the client draws it
// (client/src/ui/Decisions.tsx).

import type { PhoneMessage } from './types.ts';

type DecisionKind = 'suggestion' | 'question' | 'team' | 'charter';
/** archived: open for DECISION_TTL_MS without an answer, kept for the record but never shown or raised. superseded: a newer question replaced it (#183). */
type DecisionStatus = 'open' | 'resolved' | 'dropped' | 'archived' | 'superseded';
/** What a suggestion is about: when every one of them is gone (closed, merged, left), so is the question. */
export type DecisionAbout = { kind: 'issue'; repoId: string; number: number } | { kind: 'agent'; agentId: string };
/** How a decision closed (#208), for the decision log. Decisions saved before it have none. */
type DecisionClosedBy =
  | { kind: 'option'; messageId: number } // the manager tapped or typed one of its options, in message messageId
  | { kind: 'reply'; messageId: number; to: number } // the manager replied to message `to` (the one that asked)
  | { kind: 'reask'; messageId: number; via: string } // the manager answered its re-ask, or the question it re-asks (`via`)
  | { kind: 'confirmed'; done: string } // the manager confirmed a "probably answered"
  | { kind: 'ceo' } // the CEO's resolve_decision
  | { kind: 'action'; done: string; link?: DecisionAbout } // the CEO did what it asked
  | { kind: 'dropped' }
  | { kind: 'auto' }; // decided elsewhere, what it was about is gone, replaced, or a week without an answer

export interface Decision {
  id: string; // msg:<message id> · ask:<question id> · team:<request id> · charter:<repo id>:<proposed at>
  kind: DecisionKind;
  question: string; // one line
  context?: string; // the message that asked it, in plain words and short, for the card's sheet (#183)
  options: string[]; // one-tap answers (a team change's and a charter's are its card's buttons)
  repoIds: string[];
  about: DecisionAbout[];
  messageId: number | null; // the chat message that asked it, the latest time
  askedAt: number;
  lastAskedAt: number;
  raised: number; // times it was asked
  status: DecisionStatus;
  snoozedUntil: number | null; // Not now
  closedAt: number | null;
  outcome: string | null; // the answer, or why it closed
  /** The earlier open question this one asks again (#208): answering either closes both. */
  reAskOf?: string;
  /** A CEO action that probably answered it (#208): it stays open until the manager or the CEO says so. */
  probably?: { done: string; at: number; link?: DecisionAbout };
  closedBy?: DecisionClosedBy;
}

export interface DecisionsState {
  list: Decision[];
  digestAt: number; // the last daily "N decisions waiting" notice
}

/** A decision the office's own state asks for right now (team changes, charter proposals, agents' questions). */
export type DecisionSeed = Pick<Decision, 'id' | 'kind' | 'question' | 'options' | 'repoIds' | 'messageId'> & { at: number };

export const DECISION_TTL_MS = 7 * 24 * 3_600_000;
export const SNOOZE_MS = 24 * 3_600_000;
const DIGEST_MS = 24 * 3_600_000;
/** Raised this often without an answer: it stays in the tray, and the CEO stops asking it in replies. */
export const QUIET_AFTER = 2;
const KEEP_CLOSED = 50;
const QUESTION_MAX = 140;
const CONTEXT_MAX = 400;
const OUTCOME_MAX = 200;
const DAY_MS = 24 * 3_600_000;
/** Closed ones the tabs get for the decision log: the last week's, at most this many. */
const LOG_MAX = 30;

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const plain = (s: string) => s.replace(/^\s*#+\s+/, '').replace(/[*_`>|]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const sameOptions = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.map(norm).sort().join('|') === b.map(norm).sort().join('|');

// A list marker or quote, and a label like "What you need to do:" or "Next step:" in front of the words (#183).
const MARKER = /^(?:[-*+•>]|\d+[.)])\s+/;
const LABEL = /^[\p{L}' ]{0,30}\b(?:need(?:s|ed)?|to ?do|next|steps?|actions?|questions?|decisions?|asks?|tl;?dr|summary|bottom line|blockers?)\b[\p{L}' ]{0,20}:\s*/iu;
const cleanLine = (raw: string) => {
  const s = plain(raw.trim().replace(MARKER, '')).replace(MARKER, '').replace(LABEL, '');
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const lower = (s: string) => (/^\p{Lu}\p{Ll}/u.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/**
 * The question a message asks, in one line, without list markers, bold or labels: its last sentence with a question
 * mark; else its options as one ("Raised the limit or drop the Windows CI job?"); else its last line.
 */
export function questionLine(text: string, options: readonly string[] = []): string {
  const lines = text.split('\n').map(cleanLine).filter(Boolean);
  const asked = [...lines].reverse().find((l) => l.includes('?'));
  const sentence = asked?.match(/[^.!?]*\?/g)?.pop()?.trim();
  if (sentence) return clip(cleanLine(sentence), QUESTION_MAX);
  if (options.length) return clip(`${options.map((o, i) => (i ? lower(o) : o).replace(/[.?!]+$/, '')).join(' or ')}?`, QUESTION_MAX);
  return clip(lines[lines.length - 1] ?? '', QUESTION_MAX);
}

/** The message's words for the card's sheet: plain, its lines joined, short. */
const contextOf = (text: string) => clip(text.split('\n').map(cleanLine).filter(Boolean).join(' '), CONTEXT_MAX);

const STOP = new Set('about after again also because been before being could does done from have here into just like more must need only other over said shall should some still than that their them then there these they this those very want were what when where which while will with would your yours floor floors team agent agents issue issues office file filed follow merge merged close leave keep today'.split(' '));
const words = (s: string) => norm(s).split(' ').filter((w) => w.length >= 4 && !STOP.has(w));

/**
 * A newer question replaces an older open one (#183) when they cover the same ground (a floor or a thing in common;
 * when neither names one, a stronger match) and ask much the same: two words in common between their questions and
 * options (three with no floor), and three in common overall (four, or a third of the shorter one's).
 */
const key = (a: DecisionAbout) => (a.kind === 'issue' ? `${a.repoId}#${a.number}` : `@${a.agentId}`);
const sharesAbout = (a: readonly DecisionAbout[], b: readonly DecisionAbout[]) => {
  const keys = new Set(b.map(key));
  return a.some((x) => keys.has(key(x)));
};
const shared = (a: string, b: string) => {
  const bs = new Set(words(b));
  return new Set(words(a).filter((w) => bs.has(w))).size;
};
const askedText = (d: Decision) => `${d.question} ${d.options.join(' ')}`;

function supersedes(newer: Decision, older: Decision): boolean {
  if (older.kind !== 'suggestion' || older.status !== 'open' || newer.id === older.id) return false;
  const about = new Set(older.about.map(key));
  const scope = newer.about.some((a) => about.has(key(a))) || newer.repoIds.some((r) => older.repoIds.includes(r));
  const unscoped = [newer, older].every((d) => !d.repoIds.length && !d.about.length);
  if (!scope && !unscoped) return false;
  const asked = (d: Decision) => new Set(words(`${d.question} ${d.options.join(' ')}`));
  const askedB = asked(older);
  const sharedAsked = [...asked(newer)].filter((w) => askedB.has(w)).length;
  const all = (d: Decision) => new Set([...asked(d), ...words(d.context ?? '')]);
  const a = all(newer), b = all(older);
  const shared = [...a].filter((w) => b.has(w)).length;
  return sharedAsked >= (scope ? 2 : 3) && shared >= 3 && (shared >= 4 || shared >= Math.min(a.size, b.size) / 3);
}

// Answers every option list has: never what links two questions.
const OPTION_STOP = new Set('drop skip keep later wait sure fine okay leave stop start pause both none'.split(' '));

/**
 * A newer question asks an older one again (#208) when the older is still open and asked in the last day, they are on
 * the same floors (or neither names one), and they share a thing (an issue or an agent), an option keyword, or three
 * words in all.
 */
function reAsks(newer: Decision, older: Decision, now: number): boolean {
  if (older.kind !== 'suggestion' || older.status !== 'open' || newer.id === older.id || now - older.lastAskedAt > DAY_MS) return false;
  const floors = newer.repoIds.length || older.repoIds.length ? newer.repoIds.some((r) => older.repoIds.includes(r)) : true;
  if (!floors) return false;
  if (sharesAbout(newer.about, older.about)) return true;
  const opts = new Set(words(older.options.join(' ')).filter((w) => !OPTION_STOP.has(w)));
  if (words(newer.options.join(' ')).some((w) => opts.has(w))) return true;
  return shared(`${askedText(newer)} ${newer.context ?? ''}`, `${askedText(older)} ${older.context ?? ''}`) >= 3;
}

/** A decision and every one linked to it by re-asks, either way. */
function linked(list: readonly Decision[], id: string): Set<string> {
  const ids = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const d of list) {
      if (!d.reAskOf || ids.has(d.id) === ids.has(d.reAskOf)) continue;
      ids.add(d.id);
      ids.add(d.reAskOf);
      grew = true;
    }
  }
  return ids;
}

/** Loads saved decisions, dropping malformed ones. */
export function loadDecisions(raw: unknown): DecisionsState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<DecisionsState>;
  const list = Array.isArray(r.list) ? r.list.filter((d): d is Decision => !!d && typeof d.id === 'string' && typeof d.question === 'string' && Array.isArray(d.options) && Array.isArray(d.about)) : [];
  // Saved before #208: no closedBy (the log reads its status), and nothing malformed carried over.
  const clean = (d: Decision): Decision => {
    const { closedBy, probably, reAskOf, ...rest } = d;
    return { ...rest, ...(typeof reAskOf === 'string' && { reAskOf }), ...(probably && typeof probably.done === 'string' && { probably }), ...(closedBy && typeof closedBy.kind === 'string' && { closedBy }) };
  };
  return { list: list.map(clean), digestAt: Number(r.digestAt) || 0 };
}

/** A CEO message with suggestions becomes an open decision, or raises the open one with the same options again. */
export function fromCeoMessage(list: Decision[], m: PhoneMessage, now: number): Decision[] {
  if (m.from !== 'ceo' || !m.suggestions?.length || m.requestId || m.question) return list;
  const id = `msg:${m.id}`;
  if (list.some((d) => d.id === id || d.messageId === m.id)) return list;
  const same = list.find((d) => d.kind === 'suggestion' && (d.status === 'open' || d.status === 'dropped') && sameOptions(d.options, m.suggestions!));
  if (same?.status === 'dropped') return list; // dropped: never raised again
  const question = (m.ask ? clip(cleanLine(m.ask), QUESTION_MAX) : questionLine(m.text, m.suggestions)) || m.suggestions.join(' / ');
  const context = contextOf(m.text);
  if (same) return list.map((d) => (d === same ? { ...d, question, context, messageId: m.id, lastAskedAt: now, raised: d.raised + 1 } : d));
  const refs = m.refs ?? [];
  const about = refs.flatMap((r): DecisionAbout[] => (r.kind === 'issue' ? [{ kind: 'issue', repoId: r.repoId, number: r.number }] : r.kind === 'agent' ? [{ kind: 'agent', agentId: r.agentId }] : []));
  const repoIds = [...new Set(refs.flatMap((r) => ('repoId' in r ? [r.repoId] : [])))];
  const fresh: Decision = { id, kind: 'suggestion', question, context, options: [...m.suggestions], repoIds, about, messageId: m.id, askedAt: now, lastAskedAt: now, raised: 1, status: 'open', snoozedUntil: null, closedAt: null, outcome: null };
  const earlier = list.filter((x) => reAsks(fresh, x, now)).sort((a, b) => b.lastAskedAt - a.lastAskedAt)[0];
  const d = earlier ? { ...fresh, reAskOf: earlier.id } : fresh;
  return [...list.map((x) => (supersedes(d, x) ? close(x, 'superseded', `replaced by "${question}"`, now, { kind: 'auto' }) : x)), d];
}

/**
 * The manager's message answers the decisions it replies to, or whose option it says word for word, and every one
 * linked to those by re-asks (#208): a reply to a question that was asked again closes the re-ask too, and the other way.
 */
export function onManagerMessage(list: Decision[], m: PhoneMessage, now: number): Decision[] {
  if (m.from !== 'manager' || !m.text.trim()) return list;
  const said = norm(m.text);
  const replied = (d: Decision) => d.messageId !== null && d.messageId === m.replyTo;
  const picked = (d: Decision) => d.status === 'open' && (d.kind === 'suggestion' || d.kind === 'question') && d.options.some((o) => norm(o) === said);
  const direct = new Map<string, DecisionClosedBy>();
  for (const d of list) {
    if (replied(d)) direct.set(d.id, { kind: 'reply', messageId: m.id, to: m.replyTo! });
    else if (picked(d)) direct.set(d.id, { kind: 'option', messageId: m.id });
  }
  const via = new Map<string, string>();
  for (const hit of direct.keys()) for (const id of linked(list, hit)) if (!direct.has(id) && !via.has(id)) via.set(id, hit);
  let changed = false;
  const out = list.map((d) => {
    const by = direct.get(d.id) ?? (via.has(d.id) ? { kind: 'reask' as const, messageId: m.id, via: via.get(d.id)! } : null);
    if (d.status !== 'open' || !by) return d;
    changed = true;
    return close(d, 'resolved', m.text, now, by);
  });
  return changed ? out : list;
}

const close = (d: Decision, status: Exclude<DecisionStatus, 'open'>, outcome: string, now: number, closedBy: DecisionClosedBy): Decision => {
  const { probably: _, ...rest } = d;
  return { ...rest, status, closedAt: now, snoozedUntil: null, outcome: clip(plain(outcome), OUTCOME_MAX) || null, closedBy };
};

/** Resolves or supersedes (the CEO's resolve_decision) or drops (the manager's Drop it) an open decision. */
export function closeDecision(list: Decision[], id: string, status: 'resolved' | 'dropped' | 'superseded', outcome: string, now: number): Decision[] {
  const by: DecisionClosedBy = status === 'dropped' ? { kind: 'dropped' } : status === 'superseded' ? { kind: 'auto' } : { kind: 'ceo' };
  return list.map((d) => (d.id === id && d.status === 'open' ? close(d, status, outcome, now, by) : d));
}

// ---------- answered by doing (#208) ----------

/** What the CEO just did in a job a manager's message started: filed an issue, closed one, changed a team or an agent. */
export interface DecisionAct {
  repoId: string;
  about: DecisionAbout[]; // what it acted on
  text: string; // its words: the issue's title, the reason
  done: string; // "filed #207"
  link?: DecisionAbout;
}

/**
 * The open questions a CEO action answered: on what one is about, or on its floor with two of its question's words,
 * it closes as done; on its floor (or a question naming none) with two words in all, it is only probably answered.
 */
export function onCeoAction(list: Decision[], act: DecisionAct, now: number): Decision[] {
  let changed = false;
  const out = list.map((d) => {
    if (d.status !== 'open' || (d.kind !== 'suggestion' && d.kind !== 'question')) return d;
    const floor = d.repoIds.includes(act.repoId);
    if (sharesAbout(d.about, act.about) || (floor && shared(askedText(d), act.text) >= 2)) {
      changed = true;
      return close(d, 'resolved', `done: ${act.done}`, now, { kind: 'action', done: act.done, ...(act.link && { link: act.link }) });
    }
    if ((floor || !d.repoIds.length) && shared(`${askedText(d)} ${d.context ?? ''}`, act.text) >= 2 && d.probably?.done !== act.done) {
      changed = true;
      return { ...d, probably: { done: act.done, at: now, ...(act.link && { link: act.link }) } };
    }
    return d;
  });
  return changed ? out : list;
}

/** The manager's chip on a probably answered one: ✓ Yes closes it, Still open takes the mark away. */
export function settleProbable(list: Decision[], id: string, answered: boolean, now: number): Decision[] {
  return list.map((d) => {
    if (d.id !== id || d.status !== 'open' || !d.probably) return d;
    if (answered) return close(d, 'resolved', `done: ${d.probably.done}`, now, { kind: 'confirmed', done: d.probably.done });
    const { probably: _, ...rest } = d;
    return rest;
  });
}

/** Reopen: a question closed by mistake waits again, as if just asked. */
export function reopenDecision(list: Decision[], id: string, now: number): Decision[] {
  return list.map((d) => {
    if (d.id !== id || d.status === 'open') return d;
    const { closedBy: _, probably: __, ...rest } = d;
    return { ...rest, status: 'open', closedAt: null, outcome: null, snoozedUntil: null, lastAskedAt: now };
  });
}

/** Every CEO job with a manager's message: the open questions of the last day, one line each ('' when none). */
export function decisionsReminder(list: readonly Decision[], now: number, floorOf: (repoId: string) => number | null): string {
  const recent = waitingDecisions(list, now).filter((d) => now - d.lastAskedAt <= DAY_MS);
  if (!recent.length) return '';
  const line = (d: Decision) => {
    const floors = d.repoIds.map(floorOf).filter((f): f is number => f !== null);
    return `- ${d.id}: ${d.question}${floors.length ? ` (floor ${floors.join(', ')})` : ''}${d.probably ? ` · probably answered: ${d.probably.done}` : ''}`;
  };
  return `\n\nOpen decisions from the last 24 h (resolve_decision any this message answered):\n${recent.map(line).join('\n')}`;
}

/** After a CEO job: the ones its actions probably answered that are still open, for its next job's "Since you last looked". */
export function probablyLeft(list: readonly Decision[], since: number): string[] {
  return list.filter((d) => d.status === 'open' && d.probably && d.probably.at >= since).map((d) => `${d.id} "${d.question}" looks answered (${d.probably!.done}) but is still open: resolve_decision it, or leave it if it is not.`);
}

/** Not now: out of the tray and the CEO's list for SNOOZE_MS. */
export function snoozeDecision(list: Decision[], id: string, now: number): Decision[] {
  return list.map((d) => (d.id === id && d.status === 'open' ? { ...d, snoozedUntil: now + SNOOZE_MS } : d));
}

/**
 * Brings the list up to date with the office: a seed with no decision yet opens one; an open team change, charter
 * proposal or agent question with no seed any more was decided; a suggestion whose issues, PRs and agents are all gone
 * closes; one open past DECISION_TTL_MS is archived; the oldest closed ones past KEEP_CLOSED go. Returns `list` itself
 * when nothing changed.
 */
export function syncDecisions(list: Decision[], world: { seeds: DecisionSeed[]; gone: (a: DecisionAbout) => boolean }, now: number): Decision[] {
  let changed = false;
  const seeded = new Set(world.seeds.map((s) => s.id));
  const out = list.map((d) => {
    if (d.status !== 'open') return d;
    const next =
      d.kind !== 'suggestion' && !seeded.has(d.id)
        ? close(d, 'resolved', 'decided', now, { kind: 'auto' })
        : d.kind === 'suggestion' && d.about.length && d.about.every(world.gone)
          ? close(d, 'resolved', 'what it was about is gone', now, { kind: 'auto' })
          : now - d.lastAskedAt > DECISION_TTL_MS
            ? close(d, 'archived', 'no answer in 7 days', now, { kind: 'auto' })
            : d;
    if (next !== d) changed = true;
    return next;
  });
  for (const s of world.seeds) {
    if (out.some((d) => d.id === s.id)) continue;
    const { at, ...rest } = s;
    out.push({ ...rest, about: [], askedAt: at, lastAskedAt: at, raised: 1, status: 'open', snoozedUntil: null, closedAt: null, outcome: null });
    changed = true;
  }
  const closed = out.filter((d) => d.status !== 'open').sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
  if (closed.length > KEEP_CLOSED) {
    const gone = new Set(closed.slice(KEEP_CLOSED));
    return out.filter((d) => !gone.has(d));
  }
  return changed ? out : list;
}

/** Open and not snoozed: in the tray, the approvals and the CEO's list. Newest first. */
export function waitingDecisions(list: readonly Decision[], now: number): Decision[] {
  return list.filter((d) => d.status === 'open' && !(d.snoozedUntil !== null && d.snoozedUntil > now)).sort((a, b) => b.lastAskedAt - a.lastAskedAt);
}

/** The chat's own questions, which the approvals list beside their team-change and charter cards. */
export const chatDecisions = (list: readonly Decision[], now: number) => waitingDecisions(list, now).filter((d) => d.kind === 'suggestion' || d.kind === 'question');

/** What the tabs get: everything open (snoozed too: the snooze ends on the client's clock) and the last week's closed ones, for the decision log. */
export function shownDecisions(list: readonly Decision[], now = Date.now()): Decision[] {
  const open = list.filter((d) => d.status === 'open');
  const closed = list.filter((d) => d.status !== 'open' && now - (d.closedAt ?? 0) <= DECISION_TTL_MS).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)).slice(0, LOG_MAX);
  return [...open, ...closed];
}

// ---------- the decision log (#208) ----------

/** Who closed it: the manager (an answer, a confirmation, Drop it), the CEO (resolve_decision or doing it), or the office by itself. */
export type DecisionCloser = 'you' | 'ceo' | 'auto';

export function closerOf(d: Decision): DecisionCloser {
  const k = d.closedBy?.kind;
  if (k) return k === 'ceo' || k === 'action' ? 'ceo' : k === 'auto' ? 'auto' : 'you';
  // saved before #208: only its status and outcome say
  return d.status === 'dropped' || (d.status === 'resolved' && d.outcome !== 'decided' && d.outcome !== 'what it was about is gone') ? 'you' : 'auto';
}

/** How it closed, in the log's words, with the message to jump to or the thing it was done on. */
export function closedHow(d: Decision): { text: string; messageId?: number; link?: DecisionAbout } {
  const by = d.closedBy;
  switch (by?.kind) {
    case 'reply':
      return { text: `Replied to message ${by.to}`, messageId: by.to };
    case 'option':
      return { text: 'Tapped an option', messageId: by.messageId };
    case 'reask':
      return { text: `Answered by a re-ask (message ${by.messageId})`, messageId: by.messageId };
    case 'confirmed':
      return { text: `You confirmed: ${by.done}` };
    case 'ceo':
      return { text: 'Resolved by the CEO' };
    case 'action':
      return { text: `Done by the CEO: ${by.done}`, ...(by.link && { link: by.link }) };
    case 'dropped':
      return { text: 'Dropped' };
  }
  if (d.status === 'dropped') return { text: 'Dropped' };
  if (d.status === 'superseded') return { text: 'Replaced by a newer question' };
  if (d.status === 'archived') return { text: 'No answer in 7 days' };
  return { text: closerOf(d) === 'you' ? 'Answered' : 'Closed by itself' };
}

/** The log's bar: open now, and this week's closed ones by who closed them. */
export function decisionCounts(list: readonly Decision[], now: number) {
  const week = list.filter((d) => d.status !== 'open' && now - (d.closedAt ?? 0) <= DECISION_TTL_MS);
  const by = (c: DecisionCloser) => week.filter((d) => closerOf(d) === c).length;
  return { open: list.filter((d) => d.status === 'open').length, you: by('you'), ceo: by('ceo'), auto: by('auto') };
}

/** company_status's openDecisions, short. trayOnly: asked QUIET_AFTER times already, so not again in a reply. */
export function decisionsForCeo(list: readonly Decision[], now: number, floorOf: (repoId: string) => number | null) {
  return waitingDecisions(list, now).map((d) => {
    const floors = d.repoIds.map(floorOf).filter((f): f is number => f !== null);
    return { id: d.id, question: d.question, ...(d.options.length && { options: d.options }), ...(floors.length && { floors }), askedHoursAgo: Math.round((now - d.askedAt) / 3_600_000), ...(d.raised >= QUIET_AFTER && { trayOnly: true }) };
  });
}

/** The daily digest: how many decisions wait, when one is due (at most once a day, and only with some waiting), else 0. */
export function digestDue(s: DecisionsState, now: number): number {
  if (now - s.digestAt < DIGEST_MS) return 0;
  return waitingDecisions(s.list, now).length;
}
