// The Agency floor (#667): a floor of use case `agency` scouts markets every day (through the Researcher), writes
// opportunities/<slug>.md, and the CEO registers each one's numbers here. The office scores and ranks them, the top
// ones go to the manager with Approve / Not now, an approved one gets a plan issue (plans/<slug>.md) that leads to a
// new build floor (create_floor) or an ops plan. Every external action (posting, sending, signing up, a gig proposal)
// waits for the manager's approval and is never done by the office itself. Pure: state, edits, scoring and the view.
import type { EarningsState } from './earnings.ts';

const DAY_MS = 86_400_000;
const SHORTLIST_SIZE = 3;
const MAX_OPPORTUNITIES = 200;
const MAX_ACTIONS = 200;
const TITLE_MAX = 100;
const DRAFT_MAX = 4000;

type OpportunityStatus = 'new' | 'shortlisted' | 'approved' | 'declined' | 'live';
export type PlanRoute = 'build' | 'ops';

export interface Opportunity {
  slug: string; // opportunities/<slug>.md on the agency floor
  title: string;
  repoId: string; // the agency floor
  revenueMonth: number; // expected $ a month once running
  costMonth: number; // expected $ a month to run it
  effortDays: number; // agent-days to build or set up
  daysToFirstDollar: number;
  confidence: number; // 0..1: how sure the numbers are
  status: OpportunityStatus;
  route?: PlanRoute;
  planIssue?: number; // the "Plan: …" issue on the agency floor
  buildRepoId?: string; // the floor create_floor made for it
  at: number;
  decidedAt?: number;
}

export type ActionKind = 'post' | 'send' | 'signup' | 'proposal' | 'listing';
export const ACTION_KINDS: readonly ActionKind[] = ['post', 'send', 'signup', 'proposal', 'listing'];
type ActionStatus = 'pending' | 'approved' | 'declined' | 'done';

/** Something that leaves the office (a post, an email, a sign-up, a gig proposal): drafted here, done only once approved. */
export interface AgencyAction {
  id: string; // ax-N
  repoId: string;
  opportunity?: string; // its slug
  kind: ActionKind;
  target: string; // where it goes: a site, a job link, an address
  summary: string;
  draft: string; // the exact text that would go out
  status: ActionStatus;
  at: number;
  decidedAt?: number;
  result?: string;
}

export interface AgencyState {
  seq: number;
  opportunities: Opportunity[];
  actions: AgencyAction[];
  scoutDay: Record<string, string>; // repoId → the last day (YYYY-MM-DD) its scout research was asked for
}

export const emptyAgency = (): AgencyState => ({ seq: 0, opportunities: [], actions: [], scoutDay: {} });

export function loadAgency(raw: unknown): AgencyState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<AgencyState>;
  return {
    seq: Number.isInteger(r.seq) ? r.seq! : 0,
    opportunities: Array.isArray(r.opportunities) ? r.opportunities : [],
    actions: Array.isArray(r.actions) ? r.actions : [],
    scoutDay: r.scoutDay && typeof r.scoutDay === 'object' ? r.scoutDay : {},
  };
}

// ---------- scoring ----------

/**
 * Expected monthly profit, weighed by confidence, per day until it pays: effort plus the wait for the first dollar.
 * A day of work is never under 1, so a "free" idea can't score infinite. Losing ideas score 0.
 */
export function scoreOpportunity(o: Pick<Opportunity, 'revenueMonth' | 'costMonth' | 'effortDays' | 'daysToFirstDollar' | 'confidence'>) {
  const profitMonth = Math.round((o.revenueMonth - o.costMonth) * 100) / 100;
  const days = Math.max(1, o.effortDays + o.daysToFirstDollar);
  const score = profitMonth > 0 ? Math.round(((profitMonth * o.confidence) / days) * 100) / 100 : 0;
  return { profitMonth, score };
}

/** The top open ones, best first: new or shown and not decided, with a score above 0. */
export function ranked(s: AgencyState, repoId?: string) {
  return s.opportunities
    .filter((o) => (o.status === 'new' || o.status === 'shortlisted') && (!repoId || o.repoId === repoId))
    .map((o) => ({ o, ...scoreOpportunity(o) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.o.daysToFirstDollar - b.o.daysToFirstDollar);
}

/** The new ones that make the top SHORTLIST_SIZE: what the manager hasn't seen yet. */
export const toShortlist = (s: AgencyState, repoId: string) => ranked(s, repoId).slice(0, SHORTLIST_SIZE).filter((x) => x.o.status === 'new');

// ---------- edits ----------

const num = (v: unknown, name: string, min: number, max: number) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} must be a number from ${min} to ${max}.`);
  return n;
};

const SLUG = /^[a-z0-9][a-z0-9-]{0,60}$/;

export interface OpportunityInput {
  slug: string;
  title: string;
  revenue_month: number;
  cost_month?: number;
  effort_days: number;
  days_to_first_dollar: number;
  confidence?: number;
}

/** Adds or updates opportunities by slug (a decided one keeps its status). Throws a message the CEO can act on. */
export function addOpportunities(s: AgencyState, repoId: string, list: OpportunityInput[], now: number): Opportunity[] {
  const out: Opportunity[] = [];
  for (const x of list) {
    const slug = String(x.slug ?? '').trim().toLowerCase();
    if (!SLUG.test(slug)) throw new Error(`"${x.slug}" isn't a slug: lowercase letters, digits and "-", like its opportunities/<slug>.md.`);
    const title = String(x.title ?? '').trim().slice(0, TITLE_MAX);
    if (!title) throw new Error(`${slug} needs a title.`);
    const nums = {
      revenueMonth: num(x.revenue_month, 'revenue_month', 0, 10_000_000),
      costMonth: num(x.cost_month ?? 0, 'cost_month', 0, 10_000_000),
      effortDays: num(x.effort_days, 'effort_days', 0, 3650),
      daysToFirstDollar: num(x.days_to_first_dollar, 'days_to_first_dollar', 0, 3650),
      confidence: num(x.confidence ?? 0.5, 'confidence', 0, 1),
    };
    const had = s.opportunities.find((o) => o.slug === slug);
    if (had) Object.assign(had, { title, ...nums });
    else s.opportunities.push({ slug, title, repoId, ...nums, status: 'new', at: now });
    out.push(had ?? s.opportunities.at(-1)!);
  }
  s.opportunities = s.opportunities.slice(-MAX_OPPORTUNITIES);
  return out;
}

/** Approve (with its route) or Not now. Only an open one can be decided. */
export function decideOpportunity(s: AgencyState, slug: string, approve: boolean, route: PlanRoute | undefined, now: number): Opportunity {
  const o = s.opportunities.find((x) => x.slug === slug);
  if (!o) throw new Error(`No opportunity "${slug}": agency_opportunities lists them.`);
  if (o.status !== 'new' && o.status !== 'shortlisted' && !(o.status === 'declined' && approve)) throw new Error(`${o.title} is ${o.status} already.`);
  Object.assign(o, { status: approve ? 'approved' : 'declined', decidedAt: now }, approve ? { route: route ?? 'build' } : {});
  return o;
}

export interface ActionInput {
  opportunity?: string;
  kind: string;
  target: string;
  summary: string;
  draft: string;
}

/** A drafted external action, waiting for the manager. The same one twice is the same card. */
export function proposeAction(s: AgencyState, repoId: string, x: ActionInput, now: number): { action: AgencyAction; added: boolean } {
  if (!ACTION_KINDS.includes(x.kind as ActionKind)) throw new Error(`kind is one of ${ACTION_KINDS.join(', ')}.`);
  const target = String(x.target ?? '').trim().slice(0, 300);
  const summary = String(x.summary ?? '').trim().slice(0, 200);
  const draft = String(x.draft ?? '').trim().slice(0, DRAFT_MAX);
  if (!target || !summary || !draft) throw new Error('Give the target, a one-line summary and the exact draft that would go out.');
  const slug = x.opportunity?.trim().toLowerCase();
  if (slug && !s.opportunities.some((o) => o.slug === slug)) throw new Error(`No opportunity "${slug}".`);
  const same = s.actions.find((a) => a.status === 'pending' && a.kind === x.kind && a.target === target && a.draft === draft);
  if (same) return { action: same, added: false };
  const action: AgencyAction = { id: `ax-${++s.seq}`, repoId, ...(slug && { opportunity: slug }), kind: x.kind as ActionKind, target, summary, draft, status: 'pending', at: now };
  s.actions = [...s.actions, action].slice(-MAX_ACTIONS);
  return { action, added: true };
}

export function decideAction(s: AgencyState, id: string, approve: boolean, now: number): AgencyAction {
  const a = s.actions.find((x) => x.id === id);
  if (!a) throw new Error(`No action ${id}.`);
  if (a.status !== 'pending') throw new Error(`${id} is ${a.status} already.`);
  Object.assign(a, { status: approve ? 'approved' : 'declined', decidedAt: now });
  return a;
}

/** Why an external action may not go out now, or null: only the manager's approval lets it. */
export function actionGate(a: AgencyAction | undefined): string | null {
  if (!a) return 'No such action: draft it with agency_propose_action, and it waits for the manager.';
  if (a.status === 'pending') return `${a.id} waits for the manager's approval. Don't post, send or sign up until they approve it.`;
  if (a.status === 'declined') return `The manager said Not now to ${a.id}: it doesn't go out.`;
  if (a.status === 'done') return `${a.id} went out already.`;
  return null;
}

/** An approved action, done: marked so it never goes out twice. */
export function markDone(s: AgencyState, id: string, result: string, now: number): AgencyAction {
  const a = s.actions.find((x) => x.id === id);
  const why = actionGate(a);
  if (why) throw new Error(why);
  Object.assign(a!, { status: 'done', result: result.trim().slice(0, 300), decidedAt: now });
  return a!;
}

// ---------- earnings ----------

/** A live opportunity's earnings in the last 30 days: its build floor's feed and entries, else entries naming it. */
export function earnedLast30(o: Opportunity, e: Pick<EarningsState, 'entries' | 'feeds'>, now: number): number {
  const from = new Date(now - 30 * DAY_MS).toISOString().slice(0, 10);
  const named = (src: string) => src.toLowerCase().includes(o.slug) || src.toLowerCase().includes(o.title.toLowerCase());
  const entries = e.entries.filter((x) => x.date >= from && (o.buildRepoId ? x.repoId === o.buildRepoId : named(`${x.source} ${x.note ?? ''}`)));
  const feed = o.buildRepoId ? e.feeds.find((f) => f.repoId === o.buildRepoId) : undefined;
  const fed = feed ? Object.entries(feed.days).filter(([d]) => d >= from).reduce((t, [, v]) => t + v, 0) : 0;
  return Math.round((entries.reduce((t, x) => t + x.usd, 0) + fed) * 100) / 100;
}

// ---------- the view ----------

export interface OpportunityView extends Opportunity {
  profitMonth: number;
  score: number;
  earned30: number | null; // live ones only
}

export interface AgencyView {
  opportunities: OpportunityView[]; // open ones ranked first, then the rest newest first, at most 20
  actions: AgencyAction[]; // pending first, then the latest decided, at most 10
}

export function agencyView(s: AgencyState, e: Pick<EarningsState, 'entries' | 'feeds'>, now: number): AgencyView {
  const open = ranked(s).map((x) => x.o);
  const rest = s.opportunities.filter((o) => !open.includes(o)).sort((a, b) => (b.decidedAt ?? b.at) - (a.decidedAt ?? a.at));
  const opportunities = [...open, ...rest].slice(0, 20).map((o) => ({ ...o, ...scoreOpportunity(o), earned30: o.status === 'live' ? earnedLast30(o, e, now) : null }));
  const pending = s.actions.filter((a) => a.status === 'pending');
  const decided = s.actions.filter((a) => a.status !== 'pending').sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0));
  return { opportunities, actions: [...pending, ...decided].slice(0, 10) };
}

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** One line per opportunity for the CEO and the card's text. */
export const opportunityLine = (o: Opportunity) => {
  const { profitMonth, score } = scoreOpportunity(o);
  return `${o.title} (${o.slug}): ${usd(profitMonth)}/mo profit, ${o.effortDays} d effort, first $ in ${o.daysToFirstDollar} d, score ${score}`;
};

/** The shortlist's chat message: a line each, and one-tap answers the CEO acts on (agency_decide). */
export function shortlistMessage(floor: number, list: Opportunity[]): string {
  const opts = [...list.map((o) => `Approve ${o.slug}`.slice(0, 60)), 'Not now'];
  return [`💼 Floor ${floor}'s agency shortlist: approve one and it gets a full plan.`, '', ...list.map((o, i) => `${i + 1}. ${opportunityLine(o)}`), '', '```suggestions', ...opts, '```'].join('\n');
}

/** An external action's chat message, with its draft and one-tap answers. */
export function actionMessage(a: AgencyAction): string {
  return [`✋ Needs your OK before it goes out (${a.id}): ${a.kind} to ${a.target}`, a.summary, '', '> ' + a.draft.slice(0, 600).split('\n').join('\n> '), '', '```suggestions', `Approve ${a.id}`, `Not now ${a.id}`, '```'].join('\n');
}

// ---------- the floor's words ----------

/** The agency floor's playbook: what its agents write, and what they never do. */
export const AGENCY_PLAYBOOK = [
  'This floor writes documents, not an app. No code, no deploys.',
  '- Opportunity issues: write opportunities/<slug>.md with: Problem, Who pays, Market size, Competitors and prices, What we offer, Our edge (with the agents we have), Effort (agent-days), Risks, Expected revenue per month with its assumptions, Sources (links for every claim).',
  '- Plan issues: write plans/<slug>.md with: Spec, Architecture, Pricing, Go-to-market, Launch checklist, Metrics, and Route: build (a new floor) or ops (outreach, listings, gigs).',
  '- Freelance gigs: draft the proposal in proposals/<slug>.md. Never post, send, sign up or apply anywhere yourself: the manager approves every external action.',
].join('\n');

/** The agency use case's QA brief. */
export const AGENCY_QA_BRIEF = [
  'Agency floor: QA reads documents, not code. Check that:',
  '- every section the playbook names is there and filled in, with no placeholders',
  '- each claim and price has a source link that opens',
  '- the revenue estimate shows its numbers and assumptions, and the sums add up',
  '- nothing was posted, sent or signed up for: external actions only as drafts awaiting approval',
].join('\n');

/** The daily scout's research request. */
export const SCOUT_TOPIC = 'Daily market scan for paid services and products our coding agents can build or deliver';
export const SCOUT_QUESTIONS = [
  'What are clients paying for on Upwork, Fiverr and Contra this week that agents could deliver? With prices.',
  'Which new Product Hunt launches and Reddit/HN "I\'d pay for" posts show unmet demand?',
  'What do competitors charge for the 3 most promising ideas, and what is the market size?',
  'For each idea: effort in agent-days, days to the first dollar, and expected revenue per month with assumptions.',
];
