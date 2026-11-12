// IT's continuous improvement (#543): every closed IT ticket (#542) becomes a record (its cause, the agent minutes it
// blocked, the QA rounds and session dollars wasted while it was open, the fix, whether it came back). Once a week (and
// on demand) the records are grouped by cause and ranked by time and money lost, in plain code; IT reads that brief in
// one session and proposes changes (a code fix on a floor, a line for a playbook or QA brief), each a card with
// Approve / Not now. The Improvements page shows the trends. Pure: server/swarm/itImprove.ts keeps the state.
import { wasteReason, type CostSession } from './costs.ts';
import { blockedMinutes, whatKey, type ItTicket } from './itTickets.ts';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
export const WEEK = 7 * DAY;
/** What an agent's blocked minute is worth next to session dollars, for one ranking of both. */
const MINUTE_USD = 0.05;
/** Sessions ending this long after a ticket closed still count against it (the one that hit it finishes later). */
const GRACE_MS = 30 * MIN;
const RECORDS_KEPT = 400;
const RECORDS_WEEKS = 26;
const CHANGES_KEPT = 30;
const CARDS_MAX = 5;
const WEEKS_SHOWN = 8;
const CAUSES_SHOWN = 8;
const AGENTS_KEPT = 10;

/** A closed ticket, kept for the reviews. */
export interface ItRecord {
  id: number; // the ticket's
  cause: string; // IT's cause on close, else the ticket's what
  key: string; // causeKey: what the reviews group by
  where: ItTicket['where'];
  at: number;
  closedAt: number;
  reports: number;
  agents: string[]; // the agents it hit (reporters, and the ones the office's evidence names)
  minutes: number; // agent minutes blocked on it
  qaRounds: number; // failed QA rounds of those agents while it was open
  usd: number; // their wasted sessions' dollars while it was open
  fix: string; // what was done
  recurOf?: number; // an earlier record of the same cause closed before this one opened: it came back
  change?: string; // the approved change for its cause (ItChange id)
  auto?: boolean;
}

/** An improvement card's id (`i-<time>-<n>`), also its Telegram buttons' id on IT's or the CEO's bot. */
export const IMPROVE_CARD_ID = /^i-[a-z0-9]+-\d+$/;
export const IMPROVE_KINDS = ['issue', 'office_playbook', 'floor_playbook', 'qa_brief'] as const;
type ImproveKind = (typeof IMPROVE_KINDS)[number];
export type CauseStatus = 'new' | 'recurring' | 'fixed';

/** One of IT's proposals from a review, on a card with Approve / Not now. */
export interface ItImproveCard {
  id: string;
  key: string; // the cause it answers
  cause: string;
  status: CauseStatus;
  kind: ImproveKind;
  title: string; // the issue's title, or what the line is for
  why: string; // the numbers behind it
  floor?: number; // issue, floor_playbook, qa_brief
  body?: string; // issue: what, where, acceptance
  line?: string; // the playbooks' and QA brief's added line
  at: number;
  by: string;
  /** Approve couldn't apply it (the text would go over its limit): said plainly on the card, with Ask the CEO to fit it. */
  full?: string;
}

/** An approved card: what changed, and where. */
export interface ItChange {
  id: string;
  key: string;
  cause: string;
  kind: ImproveKind;
  title: string;
  at: number;
  floor?: number;
  issue?: number;
  url?: string;
  line?: string;
}

export interface ItImproveState {
  records: ItRecord[]; // newest first
  cards: ItImproveCard[];
  changes: ItChange[]; // newest first
  reviewWeek: string; // the last weekly review's weekKey
  reviewedAt: number;
}

export const emptyImprove = (): ItImproveState => ({ records: [], cards: [], changes: [], reviewWeek: '', reviewedAt: 0 });

/** What the reviews group by: where it happened and the cause's words, case, punctuation and numbers aside. */
export const causeKey = (where: string, cause: string) => `${where}:${whatKey(cause)}`;

const reporterIds = (t: ItTicket) => t.by.map((b) => b.id).filter((id) => id !== 'office' && id !== 'ceo');

/** The agents a ticket hit: its reporting agents, and those the office's own evidence starts with ("Ada · job …"). */
function ticketAgents(t: ItTicket, agents: readonly { id: string; name: string }[]): string[] {
  const named = agents.filter((a) => t.evidence.some((e) => e.startsWith(`${a.name} · `) || e.startsWith(`${a.name}: `))).map((a) => a.id);
  return [...new Set([...reporterIds(t), ...named])].slice(0, AGENTS_KEPT);
}

/** A session the ticket cost: one of its agents', ended while it was open (or just after), wasted. */
const wasted = (s: CostSession) => s.outcome === 'error' || s.outcome === 'qa-fail' || wasteReason(s) !== null;

/** The wasted dollars and failed QA rounds of `agents` between `from` and `to` (+ the grace). */
export function lostIn(agents: readonly string[], from: number, to: number, sessions: readonly CostSession[]): { usd: number; qaRounds: number } {
  let usd = 0;
  let qaRounds = 0;
  for (const s of sessions) {
    if (!agents.includes(s.agentId) || s.at < from || s.at > to + GRACE_MS || !wasted(s)) continue;
    usd += s.usd;
    if (s.kind === 'qa' && s.outcome === 'qa-fail') qaRounds++;
  }
  return { usd: Math.round(usd * 100) / 100, qaRounds };
}

/** A closed ticket as a record; recurOf when the same cause was closed before this one opened. */
export function makeRecord(t: ItTicket, prior: readonly ItRecord[], agents: readonly { id: string; name: string }[], sessions: readonly CostSession[]): ItRecord {
  const closedAt = t.closedAt ?? t.lastAt;
  const cause = (t.cause ?? t.what).trim().slice(0, 120);
  const key = causeKey(t.where, cause);
  const hit = ticketAgents(t, agents);
  const before = prior.find((r) => r.key === key && r.id !== t.id && r.closedAt <= t.at);
  return {
    id: t.id, cause, key, where: t.where, at: t.at, closedAt, reports: t.count, agents: hit,
    minutes: t.lostMin ?? 0, ...lostIn(hit, t.at, closedAt, sessions), fix: (t.resolution ?? '').slice(0, 300),
    ...(before && { recurOf: before.id }), ...(t.auto && { auto: true }),
  };
}

/** A record joins the list (a ticket's one record, newest first), and the list keeps its last 26 weeks. */
export function addRecord(s: ItImproveState, r: ItRecord, now: number) {
  const change = s.changes.find((c) => c.key === r.key);
  const rec = change ? { ...r, change: change.id } : r;
  s.records = [rec, ...s.records.filter((x) => x.id !== r.id)].filter((x) => now - x.closedAt <= RECORDS_WEEKS * WEEK).slice(0, RECORDS_KEPT);
}

/** Records the cost ledger still covers get their dollars and QA rounds again (sessions that ended after the close). */
export function refreshCosts(records: ItRecord[], sessions: readonly CostSession[], now: number): ItRecord[] {
  const oldest = sessions[0]?.at ?? now;
  return records.map((r) => (r.at < oldest || !r.agents.length ? r : { ...r, ...lostIn(r.agents, r.at, r.closedAt, sessions) }));
}

/** An open ticket counted as if it closed now, so a review sees what's still going on. */
export function openRecord(t: ItTicket, prior: readonly ItRecord[], agents: readonly { id: string; name: string }[], sessions: readonly CostSession[], now: number): ItRecord {
  return makeRecord({ ...t, closedAt: now, lostMin: blockedMinutes(t, now), resolution: 'still open' }, prior, agents, sessions);
}

// ---------- the review ----------

/** One cause in a window: its tickets, what they cost, and whether it's new, coming back or fixed. */
export interface CauseRow {
  key: string;
  cause: string;
  where: ItTicket['where'];
  tickets: number;
  reports: number;
  minutes: number;
  usd: number;
  qaRounds: number;
  status: CauseStatus;
  ids: number[]; // newest first
  fix: string; // the latest fix
  change?: { id: string; title: string; at: number; issue?: number; url?: string; floor?: number };
}

const score = (c: Pick<CauseRow, 'minutes' | 'usd'>) => c.usd + c.minutes * MINUTE_USD;

/** A cause's status: fixed once a change for it has no ticket after it; recurring when it came back after a fix or a
 *  change; else new. */
function statusOf(key: string, inWindow: readonly ItRecord[], all: readonly ItRecord[], change: ItChange | undefined): CauseStatus {
  if (change) return all.some((r) => r.key === key && r.at > change.at) ? 'recurring' : 'fixed';
  return inWindow.some((r) => r.recurOf !== undefined) ? 'recurring' : 'new';
}

/** The window's records by cause, the costliest first (dollars plus blocked minutes at MINUTE_USD), then the most tickets. */
export function groupCauses(records: readonly ItRecord[], from: number, to: number, changes: readonly ItChange[]): CauseRow[] {
  const by = new Map<string, ItRecord[]>();
  for (const r of records) if (r.at >= from && r.at < to) by.set(r.key, [...(by.get(r.key) ?? []), r]);
  const rows = [...by.entries()].map(([key, list]): CauseRow => {
    const sorted = [...list].sort((a, b) => b.at - a.at);
    const change = changes.find((c) => c.key === key);
    const sum = (f: (r: ItRecord) => number) => sorted.reduce((n, r) => n + f(r), 0);
    return {
      key, cause: sorted[0].cause, where: sorted[0].where, tickets: sorted.length, reports: sum((r) => r.reports), minutes: sum((r) => r.minutes), usd: Math.round(sum((r) => r.usd) * 100) / 100, qaRounds: sum((r) => r.qaRounds),
      status: statusOf(key, sorted, records, change), ids: sorted.map((r) => r.id), fix: sorted[0].fix,
      ...(change && { change: { id: change.id, title: change.title, at: change.at, ...(change.issue !== undefined && { issue: change.issue }), ...(change.url && { url: change.url }), ...(change.floor !== undefined && { floor: change.floor }) } }),
    };
  });
  return rows.sort((a, b) => score(b) - score(a) || b.tickets - a.tickets || a.key.localeCompare(b.key));
}

/** Monday 00:00 local of the week `ms` is in. */
export function weekStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** The weekly review's key: set from Monday 9:00, so the office runs it once a week. */
export function reviewWeek(now: number): string | null {
  const d = new Date(now);
  if (d.getDay() === 1 && d.getHours() < 9) return null;
  const w = new Date(weekStart(now));
  return `${w.getFullYear()}-${w.getMonth() + 1}-${w.getDate()}`;
}

const money = (usd: number) => `$${usd.toFixed(2)}`;
const STATUS_WORD: Record<CauseStatus, string> = { new: 'new', recurring: 'recurring', fixed: 'fixed' };

/** What IT reads for a review: the window's totals, the top causes with their numbers, and the floors to file on. */
export function reviewBrief(rows: readonly CauseRow[], o: { days: number; floors: readonly { floor: number; fullName: string }[] }): string {
  const total = (f: (r: CauseRow) => number) => rows.reduce((n, r) => n + f(r), 0);
  if (!rows.length) return `No IT tickets in the last ${o.days} days: nothing to improve.`;
  const head = `Review of the last ${o.days} days: ${total((r) => r.tickets)} tickets, ${total((r) => r.minutes)} agent-minutes blocked, ${money(total((r) => r.usd))} of wasted sessions, ${total((r) => r.qaRounds)} failed QA rounds.`;
  const lines = rows.slice(0, CARDS_MAX).map((r, i) => `${i + 1}. [${STATUS_WORD[r.status]}] cause "${r.key}" (${r.cause}): ${r.tickets} ticket${r.tickets === 1 ? '' : 's'} (#${r.ids.slice(0, 5).join(' #')}), ${r.minutes} min, ${money(r.usd)}, ${r.qaRounds} QA rounds. Last fix: ${r.fix || 'none'}${r.change ? `. Changed: ${r.change.title}` : ''}`);
  const floors = o.floors.map((f) => `${f.floor} ${f.fullName}`).join(', ');
  return [head, ...lines, `Floors: ${floors || 'none'}`].join('\n');
}

// ---------- the cards ----------

/** it_improve's proposal, as sent. */
export interface ImproveInput {
  cause: string;
  kind: ImproveKind;
  title: string;
  why: string;
  floor?: number;
  body?: string;
  line?: string;
}

/** A proposal checked into a card; errors say what to fix. `rows` is the review it answers (status and label). */
export function makeCard(p: ImproveInput, o: { id: string; at: number; by: string; rows: readonly CauseRow[]; floors: readonly number[] }): ItImproveCard {
  const t = (x: unknown, n: number) => String(x ?? '').trim().slice(0, n);
  const row = o.rows.find((r) => r.key === p.cause);
  if (!row) throw new Error(`No cause "${p.cause}" in the review: use a cause key it_review lists.`);
  if (!IMPROVE_KINDS.includes(p.kind)) throw new Error(`kind is one of ${IMPROVE_KINDS.join(', ')}.`);
  const title = t(p.title, 120);
  if (!title) throw new Error('Give a title.');
  const needsFloor = p.kind !== 'office_playbook';
  if (needsFloor && !o.floors.includes(Number(p.floor))) throw new Error(`floor is one of ${o.floors.join(', ') || '(no floors)'} for ${p.kind}.`);
  const body = t(p.body, 4000);
  const line = t(p.line, 400);
  if (p.kind === 'issue' && !body) throw new Error('An issue needs a body: what, where, and the acceptance criteria.');
  if (p.kind !== 'issue' && !line) throw new Error(`${p.kind} needs the line to add (line).`);
  return {
    id: o.id, key: row.key, cause: row.cause, status: row.status, kind: p.kind, title, why: t(p.why, 300), at: o.at, by: o.by,
    ...(needsFloor && { floor: Number(p.floor) }), ...(p.kind === 'issue' ? { body } : { line }),
  };
}

/** New cards replace the open ones for the same cause and kind; at most CARDS_MAX, newest first. */
export function addCards(s: ItImproveState, cards: readonly ItImproveCard[]) {
  const same = (a: ItImproveCard, b: ItImproveCard) => a.key === b.key && a.kind === b.kind;
  s.cards = [...cards, ...s.cards.filter((c) => !cards.some((n) => same(c, n)))].slice(0, CARDS_MAX * 2);
}

/** An existing text with a line added, as a bullet; null when it's there already. */
export function withLine(text: string, line: string): string | null {
  const bullet = line.startsWith('- ') ? line : `- ${line}`;
  if (text.includes(line.replace(/^- /, ''))) return null;
  return text.trim() ? `${text.trimEnd()}\n${bullet}` : bullet;
}

/** Where a line card adds its line, in words: "the office playbook", "floor 3's QA brief". */
export const cardPlace = (c: Pick<ItImproveCard, 'kind' | 'floor'>) => (c.kind === 'office_playbook' ? 'the office playbook' : `floor ${c.floor}'s ${c.kind === 'qa_brief' ? 'QA brief' : 'playbook'}`);

/** A card's line added to a text of at most `max` characters: the next text (null: it's there already), or the card's plain words when it won't fit. */
export function fitLine(c: Pick<ItImproveCard, 'kind' | 'floor' | 'line'>, text: string, max: number): { next: string | null } | { full: string } {
  const next = withLine(text, c.line ?? '');
  if (next === null || next.length <= max) return { next };
  const place = cardPlace(c);
  return { full: `${place[0].toUpperCase()}${place.slice(1)} is full: with this line it would be ${next.length} characters, over its ${max}. Ask the CEO to make room for it.` };
}

/** The manager's message to the CEO from Ask the CEO to fit it: shorten the text, then add the line. */
export function fitAsk(c: Pick<ItImproveCard, 'kind' | 'floor' | 'line' | 'by'>, length: number, max: number): string {
  const place = cardPlace(c);
  const tool = c.kind === 'office_playbook' ? 'set_office_playbook' : `set_floor_profile (${c.kind === 'qa_brief' ? 'qa_brief' : 'playbook'})`;
  return `${c.by} (IT) proposed adding this line to ${place}, but it's full (${length} of ${max} characters). Please shorten ${place} so it fits, keeping what matters, then add the line with ${tool}:\n${c.line}`;
}

/** An approved card: off the list, into the changes, and its cause's records link to it. */
export function approveCard(s: ItImproveState, card: ItImproveCard, at: number, ref: { issue?: number; url?: string }): ItChange {
  const change: ItChange = { id: card.id, key: card.key, cause: card.cause, kind: card.kind, title: card.title, at, ...(card.floor !== undefined && { floor: card.floor }), ...(card.line && { line: card.line }), ...ref };
  s.cards = s.cards.filter((c) => c.id !== card.id);
  s.changes = [change, ...s.changes.filter((c) => c.key !== card.key || c.kind !== card.kind)].slice(0, CHANGES_KEPT);
  s.records = s.records.map((r) => (r.key === card.key ? { ...r, change: change.id } : r));
  return change;
}

/** Telegram's text for a card. */
export function cardText(c: ItImproveCard): string {
  const what = c.kind === 'issue' ? `File an issue on floor ${c.floor}: ${c.title}` : c.kind === 'office_playbook' ? `Add to the office playbook: ${c.line}` : `Add to floor ${c.floor}'s ${c.kind === 'qa_brief' ? 'QA brief' : 'playbook'}: ${c.line}`;
  return `🔁 ${c.by} · weekly review · ${c.cause} (${c.status})\n${what}\n${c.why}`;
}

// ---------- the trends ----------

interface ImproveWeek {
  start: number;
  problems: number;
  minutes: number;
  usd: number;
  recurring: number; // tickets that came back after a fix
  resolved: number; // tickets closed with a fix that held (no repeat yet)
}

interface ImproveChangeView extends ItChange {
  before: number; // its cause's tickets a week, in the 4 weeks before
  after: number; // … since (counted over at least a week)
}

/** The Improvements page: problems per week, the costliest causes, what changed with its before/after, the open cards. */
export interface ItImproveView {
  weeks: ImproveWeek[]; // oldest first
  causes: CauseRow[];
  changes: ImproveChangeView[];
  cards: ItImproveCard[];
  reviewedAt: number;
}

const perWeek = (n: number, ms: number) => Math.round((n / Math.max(1, ms / WEEK)) * 10) / 10;

export function improveView(s: ItImproveState, open: readonly ItRecord[], now: number): ItImproveView {
  const all = [...open, ...s.records];
  const first = weekStart(now) - (WEEKS_SHOWN - 1) * WEEK;
  const weeks = Array.from({ length: WEEKS_SHOWN }, (_, i): ImproveWeek => {
    const start = first + i * WEEK;
    const end = start + WEEK;
    const list = all.filter((r) => r.at >= start && r.at < end);
    return {
      start, problems: list.length, minutes: list.reduce((n, r) => n + r.minutes, 0), usd: Math.round(list.reduce((n, r) => n + r.usd, 0) * 100) / 100,
      recurring: list.filter((r) => r.recurOf !== undefined).length,
      resolved: list.filter((r) => r.fix !== 'still open' && !all.some((x) => x.recurOf === r.id)).length,
    };
  });
  const changes = s.changes.slice(0, 10).map((c): ImproveChangeView => {
    const count = (from: number, to: number) => all.filter((r) => r.key === c.key && r.at >= from && r.at < to).length;
    return { ...c, before: perWeek(count(c.at - 4 * WEEK, c.at), 4 * WEEK), after: perWeek(count(c.at, now + 1), now - c.at) };
  });
  return { weeks, causes: groupCauses(all, first, now + 1, s.changes).slice(0, CAUSES_SHOWN), changes, cards: s.cards, reviewedAt: s.reviewedAt };
}

const isRecord = (r: unknown): r is ItRecord => {
  const x = r as ItRecord | null;
  return !!x && typeof x === 'object' && Number.isInteger(x.id) && typeof x.key === 'string' && typeof x.cause === 'string' && typeof x.at === 'number' && typeof x.closedAt === 'number' && Array.isArray(x.agents);
};
const isCard = (c: unknown): c is ItImproveCard => {
  const x = c as ItImproveCard | null;
  return !!x && typeof x === 'object' && typeof x.id === 'string' && typeof x.key === 'string' && IMPROVE_KINDS.includes(x.kind);
};
const isChange = (c: unknown): c is ItChange => {
  const x = c as ItChange | null;
  return !!x && typeof x === 'object' && typeof x.id === 'string' && typeof x.key === 'string' && typeof x.at === 'number';
};

/** The state file's improvement records and cards, keeping only well-formed ones. */
export function loadImprove(raw: unknown): ItImproveState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ItImproveState>;
  const list = <T>(x: unknown, ok: (v: unknown) => v is T, max: number) => (Array.isArray(x) ? x.filter(ok).slice(0, max) : []);
  return {
    records: list(r.records, isRecord, RECORDS_KEPT),
    cards: list(r.cards, isCard, CARDS_MAX * 2),
    changes: list(r.changes, isChange, CHANGES_KEPT),
    reviewWeek: typeof r.reviewWeek === 'string' ? r.reviewWeek : '',
    reviewedAt: Number(r.reviewedAt) || 0,
  };
}
