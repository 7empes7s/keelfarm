// New floors and the Agency floor (#667): the CEO's create_floor (a private repo with a README on main, cloned, its
// floor opened with a use case, a charter stub and that use case's QA brief, and its team), the agency floors' daily
// scout through the Researcher, opportunities ranked and shortlisted to the manager, plans filed on approval, and
// external actions that wait for the manager's Approve. Rules pure in shared/agency.ts.
import { actionGate, actionMessage, addOpportunities, AGENCY_PLAYBOOK, AGENCY_QA_BRIEF, agencyView, decideAction, decideOpportunity, loadAgency, markDone, opportunityLine, proposeAction, ranked, SCOUT_QUESTIONS, SCOUT_TOPIC, shortlistMessage, toShortlist, type ActionInput, type AgencyView, type Opportunity, type OpportunityInput, type PlanRoute } from '../../shared/agency.ts';
import { dayKey } from '../../shared/journal.ts';
import { caseDef, isUseCase, qaBriefChecks } from '../../shared/useCases.ts';
import type { WorldSnapshot } from '../../shared/types.ts';
import { agencySample } from '../agencySample.ts';
import type { CreateFloorArgs } from '../ceoAgencyTools.ts';
import { HttpError } from '../httpError.ts';
import type { PersistedRepo } from './model.ts';
import { SwarmEarnings } from './earnings.ts';

const SCOUT_EVERY_MS = 60 * 60_000;
const SCOUT_FROM_HOUR = 8;
const REPO_SLUG = /^(?:([A-Za-z0-9][A-Za-z0-9-]{0,38})\/)?([A-Za-z0-9._-]{1,100})$/;

/** The plan issue's body: the sections plans/<slug>.md must have. */
function planBody(o: Opportunity, route: PlanRoute) {
  return [
    `Write plans/${o.slug}.md: the complete plan for opportunities/${o.slug}.md, which the manager approved.`,
    '',
    'Sections: Spec, Architecture, Pricing, Go-to-market, Launch checklist, Metrics.',
    route === 'build'
      ? 'Route: build. A new floor builds it; end with the first 3-8 issues for that floor, each with its acceptance.'
      : 'Route: ops. Agents action it (outreach, listings, gigs); list every external action as a draft. Nothing is posted, sent or signed up for until the manager approves it.',
    '',
    `Expected earnings: $${Math.round(o.revenueMonth - o.costMonth)} a month (${opportunityLine(o)}).`,
  ].join('\n');
}

export abstract class SwarmAgency extends SwarmEarnings {
  protected loadAgencyState(raw: unknown) {
    return loadAgency(raw);
  }

  private agencyNow(): AgencyView {
    return agencyView(this.state.agency, this.state.earnings, Date.now());
  }

  /** Left out until there's an opportunity or an action: every tab's snapshot pays for it (scale.test.ts). */
  override snapshot(): WorldSnapshot {
    const s = this.state.agency;
    return s.opportunities.length || s.actions.length ? { ...super.snapshot(), agency: this.agencyNow() } : super.snapshot();
  }

  private agencyChanged() {
    this.save();
    this.broadcast({ type: 'agency', agency: this.agencyNow() });
  }

  private agencyFloors() {
    return this.state.repos.filter((r) => r.setup?.useCase === 'agency');
  }

  /** The scout's check every hour; a fresh demo office's Agency floor (not in tests). */
  protected override async startUsage() {
    if (!process.env.VITEST) {
      setInterval(() => this.scoutTick(Date.now()), SCOUT_EVERY_MS).unref?.();
      setTimeout(() => void this.agencyDemo(), 5000).unref?.();
    }
    await super.startUsage();
  }

  /** Each agency floor asks the Researcher for its market scan once a day, from 8:00. Returns the floors asked. */
  protected scoutTick(now: number): number[] {
    if (new Date(now).getHours() < SCOUT_FROM_HOUR) return [];
    const day = dayKey(now);
    const asked: number[] = [];
    for (const r of this.agencyFloors()) {
      if (this.state.agency.scoutDay[r.id] === day) continue;
      this.state.agency.scoutDay[r.id] = day;
      this.requestResearch({ topic: SCOUT_TOPIC, floor: r.floor, questions: SCOUT_QUESTIONS });
      asked.push(r.floor);
    }
    if (asked.length) this.save();
    return asked;
  }

  // ---------- create_floor ----------

  /** The CEO's create_floor: only when the manager's message asks for it. */
  protected async createFloor(x: CreateFloorArgs): Promise<string> {
    this.checkAsked(x);
    const out = await this.openFloor(x);
    this.linkBuildFloor(x.opportunity, x.repo_slug);
    return out;
  }

  /** The repo (made when GitHub doesn't have it), its floor and its setup. A floor that exists already is left as it is. */
  protected async openFloor(x: CreateFloorArgs): Promise<string> {
    const slug = String(x.repo_slug ?? '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '');
    const m = REPO_SLUG.exec(slug);
    if (!m) throw new Error(`"${x.repo_slug}" isn't a repo: use "owner/repo" or "repo".`);
    if (!isUseCase(x.use_case)) throw new Error('Pick a use case from the list.');
    const [, owner, name] = m;
    const same = (r: PersistedRepo) => (owner ? r.id.toLowerCase() === slug.toLowerCase() : r.id.split('/')[1]?.toLowerCase() === name.toLowerCase());
    const had = this.state.repos.find(same);
    if (had) return `Floor ${had.floor} is ${had.fullName} already: nothing changed.`;
    const description = String(x.description ?? '').trim().slice(0, 300);
    // Owner-less: one of the office account's repos by that name (a half-done earlier call), else gh's own account.
    const mine = owner ? undefined : (await this.backend.listMyRepos().catch(() => [])).find((x) => x.nameWithOwner.split('/')[1]?.toLowerCase() === name.toLowerCase());
    const meta = await this.backend.repoMeta(mine?.nameWithOwner ?? slug).catch(() => null);
    const view = meta
      ? await this.connectRepo(meta.nameWithOwner, { mission: description })
      : await this.createRepo(name, { mission: description, description, visibility: x.private === false ? 'public' : 'private', ...(owner && { owner }) });
    const r = this.repo(view.id);
    this.registerFloor(r, x, description);
    const size = Math.max(1, Math.min(8, Math.round(Number(x.team_size ?? 1))));
    const team = size > 1 ? ` ${this.scaleTeam({ floor: r.floor, size, reason: `${x.name}: the team it opened with` })}` : '';
    return `${meta ? 'Connected' : 'Created'} ${r.fullName} (${x.private === false ? 'public' : 'private'}) as floor ${r.floor}, ${caseDef(x.use_case).label}, with its QA brief and charter.${team}`;
  }

  /** The new floor's use case, profile, QA brief and charter stub. */
  private registerFloor(r: PersistedRepo, x: CreateFloorArgs, description: string) {
    const def = caseDef(x.use_case);
    const agency = x.use_case === 'agency';
    this.setFloorUseCase(r.id, x.use_case);
    this.updateRepo(r.id, { summary: `${String(x.name).trim().slice(0, 60)}: ${description}`.slice(0, 400), qaBrief: agency ? AGENCY_QA_BRIEF : qaBriefChecks(def), ...(agency && { playbook: AGENCY_PLAYBOOK }) });
    this.setCharter(r.id, {
      mission: description,
      objectives: agency ? [{ id: 'O1', outcome: 'A pipeline of paid services and products, each with a complete plan', measure: 'Approved plans a month, and their expected revenue' }] : [],
      standards: def.qaChecks.map((c) => c.label),
      nonGoals: agency ? ['Posting, sending or signing up anywhere without the manager’s approval'] : [],
      focus: '',
    });
    this.closeFloorReview(r.id); // set up as recommended already: its gaps still come as notices
  }

  // ---------- opportunities ----------

  private agencyRepo(floor: number) {
    const r = this.floorRepo(floor);
    if (r.setup?.useCase !== 'agency') throw new Error(`Floor ${floor} isn't an agency floor: ${this.agencyFloors().map((f) => `floor ${f.floor}`).join(', ') || 'there is none yet (create_floor with use_case agency, when the manager asks)'}.`);
    return r;
  }

  /** agency_opportunities: register numbers, rank, and show the manager the new top ones. */
  protected agencyOpportunities(x: { floor: number; opportunities?: OpportunityInput[] }): string {
    const r = this.agencyRepo(x.floor);
    const s = this.state.agency;
    let shown = '';
    if (x.opportunities?.length) {
      addOpportunities(s, r.id, x.opportunities, Date.now());
      const top = toShortlist(s, r.id).map((t) => t.o);
      for (const o of top) o.status = 'shortlisted';
      if (top.length) {
        this.postMessage('ceo', shortlistMessage(r.floor, top));
        shown = ` Sent ${top.length} to the manager with Approve / Not now.`;
      }
      this.agencyChanged();
    }
    const list = ranked(s, r.id);
    return `${list.length ? list.map((t, i) => `${i + 1}. ${opportunityLine(t.o)} [${t.o.status}]`).join('\n') : 'No open opportunities.'}${shown}`;
  }

  /** agency_decide: the manager's answer, from their message. */
  protected async agencyDecide(x: { id: string; approve: boolean; route?: PlanRoute; asked_in?: number }): Promise<string> {
    this.checkAsked(x);
    return this.agencyDecision(String(x.id ?? '').trim().toLowerCase(), !!x.approve, x.route);
  }

  private async agencyDecision(id: string, approve: boolean, route: PlanRoute | undefined): Promise<string> {
    const s = this.state.agency;
    if (/^ax-\d+$/.test(id)) {
      const a = decideAction(s, id, approve, Date.now());
      this.agencyChanged();
      return approve ? `Approved ${a.id}: do it now (${a.kind} to ${a.target}), then agency_action_done.` : `Not now: ${a.id} won't go out.`;
    }
    const o = decideOpportunity(s, id, approve, route, Date.now());
    this.agencyChanged();
    if (!approve) return `Not now: ${o.title}.`;
    const n = await this.createIssue(o.repoId, `Plan: ${o.title}`, planBody(o, o.route!));
    o.planIssue = n;
    this.agencyChanged();
    const next = o.route === 'build' ? 'Once it merges, create_floor (opportunity: its slug) and file its issues from the plan.' : 'Once it merges, draft each external action with agency_propose_action.';
    return `Approved ${o.title}: filed #${n} for plans/${o.slug}.md. ${next}`;
  }

  /** agency_propose_action: a draft on a card, never done by the office. */
  protected agencyProposeAction(x: ActionInput & { floor: number }): string {
    const r = this.agencyRepo(x.floor);
    const { action, added } = proposeAction(this.state.agency, r.id, x, Date.now());
    if (added) {
      this.postMessage('ceo', actionMessage(action));
      this.agencyChanged();
    }
    return `${added ? 'Queued' : 'Already waiting'}: ${action.id} waits for the manager's Approve. Don't do it until agency_decide approves it.`;
  }

  /** agency_action_done: an approved action went out; refused otherwise. Its opportunity is live from then on. */
  protected agencyActionDone(x: { id: string; result: string }): string {
    const s = this.state.agency;
    const a = markDone(s, String(x.id ?? '').trim().toLowerCase(), String(x.result ?? ''), Date.now());
    const o = a.opportunity ? s.opportunities.find((y) => y.slug === a.opportunity) : undefined;
    if (o && o.status === 'approved') o.status = 'live';
    this.agencyChanged();
    return `${a.id} marked done.`;
  }

  /** create_floor for an approved opportunity links its new floor: its earnings count for it. */
  protected linkBuildFloor(slug: string | undefined, repoSlug: string) {
    const o = slug ? this.state.agency.opportunities.find((y) => y.slug === slug.toLowerCase()) : undefined;
    const r = this.state.repos.find((y) => y.id.toLowerCase() === repoSlug.toLowerCase() || y.id.split('/')[1]?.toLowerCase() === repoSlug.toLowerCase());
    if (!o || !r || o.status !== 'approved') return;
    Object.assign(o, { buildRepoId: r.id, status: 'live' });
    this.agencyChanged();
  }

  // ---------- the manager's taps (the Company page's card) ----------

  /** POST /api/agency/opportunities/:slug: Approve (route build or ops) or Not now. */
  async decideOpportunityByManager(slug: string, body: { approve?: unknown; route?: unknown }) {
    const route = body.route === 'ops' ? 'ops' : 'build';
    if (/^ax-/i.test(slug)) throw new HttpError(400, 'That is an action: use /api/agency/actions.');
    try {
      return { text: await this.agencyDecision(slug.toLowerCase(), body.approve === true, route) };
    } catch (e) {
      throw e instanceof HttpError ? e : new HttpError(400, (e as Error).message);
    }
  }

  /** POST /api/agency/actions/:id: Approve or Not now; an approved one goes to the CEO to do. */
  decideActionByManager(id: string, body: { approve?: unknown }) {
    const approve = body.approve === true;
    let a;
    try {
      a = decideAction(this.state.agency, id.toLowerCase(), approve, Date.now());
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    this.agencyChanged();
    if (approve && !actionGate(a)) this.enqueueCeo({ kind: 'chat', text: `The manager approved ${a.id} on the Company page: ${a.kind} to ${a.target} (${a.summary}). Do it now with the draft as written, then agency_action_done.`, messageIds: [], at: Date.now() });
    return { ok: true };
  }

  // ---------- the demo ----------

  /** A fresh demo office opens an Agency floor through create_floor's own path, with an opportunity, a plan and a draft. */
  private async agencyDemo() {
    const s = this.state.agency;
    if (!this.backend.demo || s.seq || s.opportunities.length || this.state.repos.length > 3 || this.agencyFloors().length) return;
    await this.openFloor({ name: 'Agency', repo_slug: 'agency', use_case: 'agency', description: 'Market research: services and products we can sell, each with a complete plan' }).catch(() => undefined);
    const r = this.agencyFloors()[0];
    if (!r) return;
    const sample = agencySample(Date.now());
    const opp = await this.createIssue(r.id, sample.opportunityIssue.title, sample.opportunityIssue.body).catch(() => undefined);
    addOpportunities(s, r.id, sample.opportunities, Date.now());
    const approved = s.opportunities.find((o) => o.slug === sample.approved)!;
    Object.assign(approved, { status: 'approved', route: 'ops', decidedAt: Date.now() });
    approved.planIssue = await this.createIssue(r.id, `Plan: ${approved.title}`, planBody(approved, 'ops')).catch(() => undefined);
    const top = toShortlist(s, r.id).map((t) => t.o);
    for (const o of top) o.status = 'shortlisted';
    if (top.length) this.postMessage('ceo', shortlistMessage(r.floor, top));
    const { action } = proposeAction(s, r.id, sample.action, Date.now());
    this.postMessage('ceo', actionMessage(action));
    s.scoutDay[r.id] = dayKey(Date.now());
    if (opp) this.toast('info', `Floor ${r.floor}: the Agency's first opportunity is #${opp}.`);
    this.agencyChanged();
  }
}
