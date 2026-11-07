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

const STOP = new Set('about after again also because been before being could does done from have here into just like more must need only other over said shall should some still than that their them then there these they this those very want were what when where which while will with would your yours floor floors team agent agents issue issues office'.split(' '));
const words = (s: string) => norm(s).split(' ').filter((w) => w.length >= 4 && !STOP.has(w));

/**
 * A newer question replaces an older open one (#183) when they cover the same ground (a floor or a thing in common,
 * or either names no floor) and say much the same: at least three words in common (four, or a third of the shorter
 * one's), one of them in either's question or options.
 */
function supersedes(newer: Decision, older: Decision): boolean {
  if (older.kind !== 'suggestion' || older.status !== 'open' || newer.id === older.id) return false;
  const key = (a: DecisionAbout) => (a.kind === 'issue' ? `${a.repoId}#${a.number}` : `@${a.agentId}`);
  const about = new Set(older.about.map(key));
  const scope = newer.about.some((a) => about.has(key(a))) || newer.repoIds.some((r) => older.repoIds.includes(r)) || !newer.repoIds.length || !older.repoIds.length;
  if (!scope) return false;
  const asked = (d: Decision) => words(`${d.question} ${d.options.join(' ')}`);
  const all = (d: Decision) => new Set([...asked(d), ...words(d.context ?? '')]);
  const a = all(newer), b = all(older);
  const shared = [...a].filter((w) => b.has(w));
  const pointed = new Set([...asked(newer), ...asked(older)]);
  return shared.length >= 3 && (shared.length >= 4 || shared.length >= Math.min(a.size, b.size) / 3) && shared.some((w) => pointed.has(w));
}

/** Loads saved decisions, dropping malformed ones. */
export function loadDecisions(raw: unknown): DecisionsState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<DecisionsState>;
  const list = Array.isArray(r.list) ? r.list.filter((d): d is Decision => !!d && typeof d.id === 'string' && typeof d.question === 'string' && Array.isArray(d.options) && Array.isArray(d.about)) : [];
  return { list, digestAt: Number(r.digestAt) || 0 };
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
  const d: Decision = { id, kind: 'suggestion', question, context, options: [...m.suggestions], repoIds, about, messageId: m.id, askedAt: now, lastAskedAt: now, raised: 1, status: 'open', snoozedUntil: null, closedAt: null, outcome: null };
  return [...list.map((x) => (supersedes(d, x) ? close(x, 'superseded', `replaced by "${question}"`, now) : x)), d];
}

/** The manager's message answers the open decisions it replies to, or whose option it says word for word. */
export function onManagerMessage(list: Decision[], m: PhoneMessage, now: number): Decision[] {
  if (m.from !== 'manager' || !m.text.trim()) return list;
  const said = norm(m.text);
  const answers = (d: Decision) => d.status === 'open' && ((d.messageId !== null && d.messageId === m.replyTo) || ((d.kind === 'suggestion' || d.kind === 'question') && d.options.some((o) => norm(o) === said)));
  if (!list.some(answers)) return list;
  return list.map((d) => (answers(d) ? close(d, 'resolved', m.text, now) : d));
}

const close = (d: Decision, status: Exclude<DecisionStatus, 'open'>, outcome: string, now: number): Decision => ({ ...d, status, closedAt: now, snoozedUntil: null, outcome: clip(plain(outcome), OUTCOME_MAX) || null });

/** Resolves or supersedes (the CEO's resolve_decision) or drops (the manager's Drop it) an open decision. */
export function closeDecision(list: Decision[], id: string, status: 'resolved' | 'dropped' | 'superseded', outcome: string, now: number): Decision[] {
  return list.map((d) => (d.id === id && d.status === 'open' ? close(d, status, outcome, now) : d));
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
        ? close(d, 'resolved', 'decided', now)
        : d.kind === 'suggestion' && d.about.length && d.about.every(world.gone)
          ? close(d, 'resolved', 'what it was about is gone', now)
          : now - d.lastAskedAt > DECISION_TTL_MS
            ? close(d, 'archived', 'no answer in 7 days', now)
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

/** What the tabs get: everything open (snoozed too: the snooze ends on the client's clock) and the latest closed ones. */
export function shownDecisions(list: readonly Decision[]): Decision[] {
  const open = list.filter((d) => d.status === 'open');
  const closed = list.filter((d) => d.status !== 'open').sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)).slice(0, 10);
  return [...open, ...closed];
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
