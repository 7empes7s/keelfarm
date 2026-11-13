// IT tickets (#542): office problems (the test lab, previews, ports, disk, sign-in screens, CI) that agents report with
// it_report or the office files by itself, queued for the IT lead (#524). A repeat within the hour joins the open
// ticket; IT wakes only for a blocking ticket or a burst, at most once per ticket per 15 minutes; every ticket ends with
// what was done. Pure: server/swarm/itTickets.ts keeps them, Settings → The IT department lists them.

export const TICKET_WHERE = ['lab', 'preview', 'ports', 'disk', 'sign-in', 'ci', 'network', 'other'] as const;
type TicketWhere = (typeof TICKET_WHERE)[number];

/** One report: an agent's it_report, or the office's own (autoReport). */
export interface ItReport {
  what: string;
  where: TicketWhere;
  evidence: string; // error text, job id, command
  blocking: boolean; // the reporter can't go on without a fix
}

/** Who reported: an agent's id, 'ceo' or 'office'. */
interface TicketReporter {
  id: string;
  name: string;
  at: number;
}

export interface ItTicket {
  id: number;
  what: string;
  where: TicketWhere;
  evidence: string[]; // oldest first, the latest EVIDENCE_KEPT
  blocking: boolean;
  count: number; // reports joined into it
  by: TicketReporter[]; // each reporter once, first first (a tab's copy: the first BY_SHOWN)
  byMore?: number; // a tab's copy: reporters left out of by
  waiting: string[]; // agents blocked on it (their card says "Waiting on IT #id")
  at: number;
  lastAt: number;
  status: 'open' | 'closed';
  closedAt?: number;
  resolution?: string;
  wokeAt?: number; // when IT was last woken for it
  auto?: boolean; // the office filed it
  cause?: string; // IT's cause on close, for the weekly review (#543)
  lostMin?: number; // agent minutes blocked on it, set on close (#543)
}

export interface TicketsState {
  seq: number;
  list: ItTicket[]; // newest first
}

export const TICKET_DUP_MS = 60 * 60_000;
export const TICKET_WAKE_MS = 15 * 60_000;
export const TICKET_IDLE_MS = 24 * 60 * 60_000;
/** Reports of one non-blocking ticket that wake IT. */
const TICKET_BURST = 3;
const EVIDENCE_KEPT = 5;
const BY_SHOWN = 5;
const KEPT = 50;
const WHAT_MAX = 200;
const EVIDENCE_MAX = 2000;

export const emptyTickets = (): TicketsState => ({ seq: 0, list: [] });

/** it_report's input, checked; errors say what to fix. */
export function checkReport(raw: unknown): ItReport {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const what = typeof r.what === 'string' ? r.what.trim().slice(0, WHAT_MAX) : '';
  const evidence = typeof r.evidence === 'string' ? r.evidence.trim().slice(0, EVIDENCE_MAX) : '';
  if (!what) throw new Error('Say what is wrong in a line (what).');
  if (!TICKET_WHERE.includes(r.where as TicketWhere)) throw new Error(`where is one of ${TICKET_WHERE.join(', ')}.`);
  if (!evidence) throw new Error('Give the evidence: the error text, the job id or the command (evidence).');
  if (typeof r.blocking !== 'boolean') throw new Error('Say whether it blocks you (blocking: true or false).');
  return { what, where: r.where as TicketWhere, evidence, blocking: r.blocking };
}

/** Two reports are the same problem when their what matches, case, punctuation and numbers aside. */
export const whatKey = (what: string) => what.toLowerCase().replace(/\d+/g, '#').replace(/[^a-z#]+/g, ' ').trim();

/** Files a report: into the open ticket for the same what and where within the hour, else a new one. */
export function fileTicket(s: TicketsState, r: ItReport, who: { id: string; name: string }, now: number, auto = false): { ticket: ItTicket; joined: boolean } {
  const blocks = r.blocking && who.id !== 'office' && who.id !== 'ceo';
  const open = s.list.find((t) => t.status === 'open' && t.where === r.where && whatKey(t.what) === whatKey(r.what) && now - t.lastAt < TICKET_DUP_MS);
  if (open) {
    open.count++;
    open.lastAt = now;
    open.blocking ||= r.blocking;
    if (!open.evidence.includes(r.evidence)) open.evidence = [...open.evidence, r.evidence].slice(-EVIDENCE_KEPT);
    if (!open.by.some((b) => b.id === who.id)) open.by.push({ ...who, at: now });
    if (blocks && !open.waiting.includes(who.id)) open.waiting.push(who.id);
    return { ticket: open, joined: true };
  }
  const ticket: ItTicket = { id: ++s.seq, what: r.what, where: r.where, evidence: [r.evidence], blocking: r.blocking, count: 1, by: [{ ...who, at: now }], waiting: blocks ? [who.id] : [], at: now, lastAt: now, status: 'open', ...(auto && { auto: true }) };
  s.list.unshift(ticket);
  return { ticket, joined: false };
}

/** What tabs get: the first BY_SHOWN reporters and a count of the rest, as an outage's reporters grow with the company
 *  (scale.test.ts). The office keeps them all, to tell each one. */
export function ticketsView(list: ItTicket[]): ItTicket[] {
  return list.map((t) => (t.by.length > BY_SHOWN ? { ...t, by: t.by.slice(0, BY_SHOWN), byMore: t.by.length - BY_SHOWN } : t));
}

/** Does this ticket wake IT now? A blocking one or a burst, at most once per TICKET_WAKE_MS. */
export function wakeFor(t: ItTicket, now: number): boolean {
  if (t.status !== 'open' || (!t.blocking && t.count < TICKET_BURST)) return false;
  return t.wokeAt === undefined || now - t.wokeAt >= TICKET_WAKE_MS;
}

/** Ends a ticket with what was done. */
export function closeTicket(s: TicketsState, id: number, resolution: string, now: number): ItTicket {
  const t = s.list.find((x) => x.id === id);
  if (!t) throw new Error(`No open ticket #${id}.`);
  if (t.status === 'closed') throw new Error(`Ticket #${id} is closed already: ${t.resolution ?? ''}`.trim());
  const done = resolution.trim().slice(0, 600);
  if (!done) throw new Error('Say what was done (close).');
  Object.assign(t, { status: 'closed', resolution: done, closedAt: now, lostMin: blockedMinutes(t, now), waiting: [] });
  return t;
}

/** Minutes the agents waiting on it were blocked, up to `end` (#543). */
export const blockedMinutes = (t: Pick<ItTicket, 'by' | 'waiting'>, end: number) => Math.round(t.waiting.reduce((n, id) => n + Math.max(0, end - (t.by.find((b) => b.id === id)?.at ?? end)), 0) / 60_000);

/** The open ticket this agent waits on, or null. */
export function waitingOn(list: readonly ItTicket[], agentId: string): number | null {
  return list.find((t) => t.status === 'open' && t.waiting.includes(agentId))?.id ?? null;
}

/** Closes tickets nobody touched for a day and keeps the newest KEPT. Returns the ones it closed. */
export function pruneTickets(s: TicketsState, now: number): ItTicket[] {
  const idle = s.list.filter((t) => t.status === 'open' && now - t.lastAt >= TICKET_IDLE_MS);
  for (const t of idle) closeTicket(s, t.id, 'No answer from IT in a day: closed by the office.', now);
  const open = s.list.filter((t) => t.status === 'open');
  const closed = s.list.filter((t) => t.status === 'closed').sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)); // the latest closed stay
  s.list = [...open, ...closed.slice(0, Math.max(0, KEPT - open.length))].sort((a, b) => b.id - a.id);
  return idle;
}

/** What the office sees by itself, as a report. */
export type OfficeTrouble =
  | { kind: 'lab'; agent: string; job: string; problem: string; detail: string }
  | { kind: 'blocked'; agent: string; state: string; reason: string }
  | { kind: 'stalled'; agent: string; work: string; minutes: number }
  | { kind: 'preview'; floor: number; error: string }
  | { kind: 'ci'; repo: string; reason: string }
  | { kind: 'disk'; title: string; body: string }
  | { kind: 'voice'; problem: string };

/** The office's own reports never block anyone: they wake IT when they repeat. */
export function autoReport(e: OfficeTrouble): ItReport {
  const r = (what: string, where: TicketWhere, evidence: string): ItReport => ({ what, where, evidence: evidence.slice(0, EVIDENCE_MAX), blocking: false });
  switch (e.kind) {
    case 'lab':
      return r(`Test lab: ${e.problem}`, 'lab', `${e.agent} · job ${e.job} · ${e.detail}`);
    case 'blocked':
      return e.state === 'sign-in' ? r('A session is held on its sign-in screen', 'sign-in', `${e.agent}: ${e.reason}`) : r(`The watchdog found a stuck agent (${e.state})`, 'other', `${e.agent}: ${e.reason}`);
    case 'stalled':
      return r('The watchdog put stalled work back in line', 'other', `${e.agent} · ${e.work} · quiet ${e.minutes} min`);
    case 'preview':
      return r(`Floor ${e.floor}'s preview won't start`, 'preview', e.error);
    case 'ci':
      return r("CI can't run", 'ci', `${e.repo}: ${e.reason}`);
    case 'disk':
      return r('The disk is nearly full', 'disk', `${e.title}: ${e.body}`);
    case 'voice':
      return r("A call can't hear the manager", 'other', e.problem);
  }
}

/** A ticket as IT reads it in its job. */
export function ticketBrief(t: ItTicket): string {
  return [`Ticket #${t.id} (${t.where}${t.blocking ? ', blocking' : ''}, ${t.count} report${t.count === 1 ? '' : 's'} from ${t.by.map((b) => b.name).join(', ')}): ${t.what}`, 'Evidence:', ...t.evidence.map((e) => `- ${e}`)].join('\n');
}

const isTicket = (t: unknown): t is ItTicket => {
  const x = t as ItTicket | null;
  return !!x && typeof x === 'object' && Number.isInteger(x.id) && typeof x.what === 'string' && TICKET_WHERE.includes(x.where) && Array.isArray(x.evidence) && Array.isArray(x.by) && Array.isArray(x.waiting) && (x.status === 'open' || x.status === 'closed');
};

/** The state file's tickets, keeping only well-formed ones. */
export function loadTickets(raw: unknown): TicketsState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<TicketsState>;
  const list = (Array.isArray(r.list) ? r.list : []).filter(isTicket).slice(0, KEPT);
  return { seq: Math.max(Number.isInteger(r.seq) ? r.seq! : 0, ...list.map((t) => t.id)), list };
}
