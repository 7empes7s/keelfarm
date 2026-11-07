// Team changes: hire and let-go requests, approvals and the CEO's scale_team.
import crypto from 'node:crypto';
import { plannedSize, scalePlan, type TeamNow } from '../ceo.ts';
import { nameList } from '../closeCleanup.ts';
import { HttpError } from '../httpError.ts';
import { cliLabel, isCli } from '../clis.ts';
import { plainText } from '../notify.ts';
import type { AgentCli, EffortLevel, HireRequestView, MachineHost, NoticeAction, PhoneMessage, RepoView, WorldSnapshot } from '../../shared/types.ts';
import { closeDecision, digestDue, fromCeoMessage, onManagerMessage, shownDecisions, snoozeDecision, syncDecisions, type Decision, type DecisionAbout, type DecisionSeed } from '../../shared/decisions.ts';
import { type PersistedRepo, type PersistedAgent, EFFORTS, KEEP_DECIDED_REQUESTS, BUSY, oneLine } from './model.ts';
import { SHIRTS, HAIR, SKIN, lookFor, pick } from './flavour.ts';
import { SwarmUpkeep } from './upkeep.ts';
import { DEMO_DECISION_MESSAGES } from '../demoDecisions.ts';

export abstract class SwarmTeam extends SwarmUpkeep {
  // ---------- team changes ----------

  protected addRequest(req: HireRequestView) {
    this.state.requests.push(req);
    const decided = this.state.requests.filter((r) => r.status !== 'pending');
    if (decided.length > KEEP_DECIDED_REQUESTS) {
      const drop = new Set(decided.slice(0, decided.length - KEEP_DECIDED_REQUESTS));
      this.state.requests = this.state.requests.filter((r) => !drop.has(r));
    }
    this.broadcast({ type: 'request', request: req });
    this.save();
    this.syncDecisions();
  }

  protected decide(req: HireRequestView, patch: Pick<HireRequestView, 'status' | 'note' | 'decidedBy'>) {
    Object.assign(req, patch, { decidedAt: Date.now() });
    this.broadcast({ type: 'request', request: req });
    this.save();
    this.syncDecisions();
  }

  /** "Codex · gpt-6 · high": what an agent runs, where it isn't the office default ('' when it all is). */
  protected setupLabel(x: { cli: AgentCli | ''; model: string; effort: EffortLevel | ''; host?: MachineHost | '' }) {
    return [x.cli ? cliLabel(x.cli) : '', x.model, x.effort ? `${x.effort} effort` : '', x.host === 'box' ? 'in the cloud' : ''].filter(Boolean).join(' · ');
  }

  /** A team change goes through: the new agent joins as set up here (the manager's changes win), or an agent leaves. */
  approveRequest(id: string, overrides: { name?: string; cli?: string; model?: string; effort?: string; host?: string; note?: string } = {}, by: 'manager' | 'auto' = 'manager') {
    const req = this.state.requests.find((r) => r.id === id);
    if (!req) throw new HttpError(404, 'That team change no longer exists');
    if (req.status !== 'pending') throw new HttpError(409, `That team change was already ${req.status}`);
    const repo = this.repo(req.repoId);
    // The manager's note (from the lobby card) reaches the CEO as managerNote, as a decline's does.
    const note = (overrides.note ?? '').trim().slice(0, 400);
    const quoted = note ? ` Your note: "${note}"` : '';
    if (req.kind === 'hire') {
      const name = overrides.name?.trim() || req.name;
      const agent = this.hireAgent(repo.id, {
        name,
        cli: overrides.cli ?? req.cli,
        host: overrides.host ?? req.host ?? '',
        strict: true,
        model: overrides.model ?? req.model,
        effort: overrides.effort ?? req.effort,
        look: name === req.name ? req.look : undefined,
        appearance: { color: req.color, hair: req.hair, skin: req.skin },
        // the request's id: the candidate waiting in the lobby was drawn from it, so they look the same at their desk
        id: req.id,
      });
      Object.assign(req, { agentId: agent.id, name: agent.name, cli: agent.cli, host: agent.host ?? 'local', model: agent.model, effort: agent.effort });
      this.decide(req, { status: 'approved', note, decidedBy: by });
      const setup = this.setupLabel(req);
      this.postMessage('office', by === 'auto' ? `🤖 ${agent.name} joined floor ${repo.floor}${setup ? ` (${setup})` : ''}.` : `✅ You hired ${agent.name} for floor ${repo.floor}${setup ? ` (${setup})` : ''}.${quoted}`, req.id);
      this.toast('success', `${agent.name} joined floor ${repo.floor}`);
      return;
    }
    const a = req.agentId ? this.state.agents.find((x) => x.id === req.agentId) : undefined;
    this.decide(req, { status: 'approved', note: a ? note : 'They had already left.', decidedBy: by });
    if (a) {
      try {
        this.fireAgent(a.id);
      } catch (err) {
        this.decide(req, { status: 'pending', note: '', decidedBy: null });
        throw err;
      }
    }
    this.postMessage('office', `👋 ${req.name} left floor ${repo.floor}${by === 'auto' ? '' : ' (you agreed)'}.${a ? quoted : ''}`, req.id);
  }

  rejectRequest(id: string, note = '') {
    const req = this.state.requests.find((r) => r.id === id);
    if (!req) throw new HttpError(404, 'That team change no longer exists');
    if (req.status !== 'pending') throw new HttpError(409, `That team change was already ${req.status}`);
    this.decide(req, { status: 'rejected', note: note.trim().slice(0, 400), decidedBy: 'manager' });
    const floor = this.state.repos.find((r) => r.id === req.repoId)?.floor;
    const what = req.kind === 'hire' ? `adding ${req.name} to floor ${floor ?? '?'}` : `letting ${req.name} go`;
    this.postMessage('office', `✋ You declined ${what}${req.note ? `: "${req.note}"` : '.'}`, req.id);
  }

  /**
   * With team changes applied straight away: new agents waiting in the lobby join (a floor that's full keeps them
   * waiting), and agents let go leave as soon as they aren't preparing or working. A floor's last agent never leaves.
   */
  protected applyTeamChanges() {
    if (this.state.settings.scaling !== 'auto') return;
    for (const req of this.state.requests.filter((r) => r.status === 'pending')) {
      const a = req.agentId ? this.state.agents.find((x) => x.id === req.agentId) : undefined;
      if (req.kind === 'let-go' && a && BUSY.includes(a.status)) continue;
      if (req.kind === 'let-go' && a && this.state.agents.filter((x) => x.repoId === a.repoId).length <= 1) {
        this.decide(req, { status: 'rejected', note: `${a.name} is the floor's last agent.`, decidedBy: 'auto' });
        continue;
      }
      try {
        this.approveRequest(req.id, {}, 'auto');
      } catch (err) {
        console.warn(`team change for ${req.name} waits: ${oneLine(err)}`);
      }
    }
  }

  /** A floor's team as scale_team sees it: who's there, and the team changes waiting for the manager. */
  protected teamNow(repo: PersistedRepo): TeamNow {
    const pending = this.state.requests.filter((q) => q.repoId === repo.id && q.status === 'pending');
    return {
      agents: this.state.agents.filter((a) => a.repoId === repo.id).map((a) => ({ id: a.id, desk: a.desk, free: this.isFree(a) })),
      pendingHires: pending.filter((q) => q.kind === 'hire').sort((x, y) => x.createdAt - y.createdAt).map((q) => q.id),
      pendingLetGos: pending.filter((q) => q.kind === 'let-go' && q.agentId).map((q) => ({ id: q.id, agentId: q.agentId! })),
    };
  }

  protected newHire(repo: PersistedRepo, reason: string, setup: Pick<HireRequestView, 'cli' | 'model' | 'effort'>): HireRequestView {
    const name = this.freeName();
    const req: HireRequestView = {
      id: crypto.randomUUID(),
      kind: 'hire',
      repoId: repo.id,
      agentId: null,
      name,
      reason,
      ...setup,
      look: lookFor(name),
      color: pick(SHIRTS),
      hair: pick(HAIR),
      skin: pick(SKIN),
      status: 'pending',
      note: '',
      createdAt: Date.now(),
      decidedAt: null,
      decidedBy: null,
    };
    this.addRequest(req);
    return req;
  }

  protected newLetGo(a: PersistedAgent, reason: string): HireRequestView {
    const req: HireRequestView = {
      id: crypto.randomUUID(),
      kind: 'let-go',
      repoId: a.repoId,
      agentId: a.id,
      name: a.name,
      reason,
      cli: a.cli,
      model: a.model,
      effort: a.effort,
      look: a.look,
      color: a.color,
      hair: a.hair,
      skin: a.skin,
      status: 'pending',
      note: '',
      createdAt: Date.now(),
      decidedAt: null,
      decidedBy: null,
    };
    this.addRequest(req);
    return req;
  }

  /**
   * The CEO's scale_team (scalePlan does the arithmetic). With scaling on approve, new agents wait in the lobby and
   * let-gos are envelopes on desks until the manager decides; on auto, they go through at once, bar busy agents, who
   * leave when their task is over (leaveIfDue).
   */
  protected scaleTeam(x: { floor: number; size: number; reason: string; cli?: string; model?: string; effort?: string }) {
    const repo = this.floorRepo(x.floor);
    const reason = String(x.reason ?? '').trim().slice(0, 600);
    if (!reason) throw new Error('Say why: the manager reads the reason.');
    const cli: AgentCli | '' = isCli(x.cli) ? x.cli : '';
    if (cli && !this.cliReady(cli)) throw new Error(`${cliLabel(cli)} isn't installed here. Installed: ${this.clis.filter((c) => c.installed).map((c) => c.id).join(', ') || 'none'}.`);
    const max = this.state.settings.maxAgents;
    const team = this.teamNow(repo);
    const before = plannedSize(team);
    const plan = scalePlan(team, Number(x.size), max);
    const counting = team.pendingHires.length + team.pendingLetGos.length ? ', counting the team changes waiting for the manager' : '';
    if (plan.size === before) return `Floor ${repo.floor} already has ${before} agent${before === 1 ? '' : 's'}${counting}${Number(x.size) > max ? ` (its most: ${max})` : ''}. Nothing changed.`;
    for (const id of [...plan.cancelHires, ...plan.cancelLetGos]) {
      const req = this.state.requests.find((r) => r.id === id);
      if (req) this.decide(req, { status: 'rejected', note: `${this.ceo().name} changed the plan.`, decidedBy: 'auto' });
    }
    const setup = { cli, model: String(x.model ?? '').trim(), effort: EFFORTS.includes(x.effort as EffortLevel) ? (x.effort as EffortLevel) : ('' as const) };
    const made = [...Array.from({ length: plan.hire }, () => this.newHire(repo, reason, setup)), ...plan.letGo.map((id) => this.newLetGo(this.agent(id), reason))];
    const capped = Number(x.size) > max ? ` (you asked for ${x.size}; its most is ${max})` : '';
    const names = (reqs: HireRequestView[]) => nameList(reqs.map((r) => r.name));
    if (this.state.settings.scaling === 'auto') {
      const now = made.filter((r) => r.kind === 'hire' || !BUSY.includes(this.agent(r.agentId!).status));
      this.applyTeamChanges();
      const joined = now.filter((r) => r.kind === 'hire');
      const left = now.filter((r) => r.kind === 'let-go');
      const later = made.filter((r) => !now.includes(r));
      const parts = [joined.length ? `${names(joined)} joined` : '', left.length ? `${names(left)} left` : '', later.length ? `${names(later)} will leave after their current task` : ''].filter(Boolean);
      return `Floor ${repo.floor} goes from ${before} to ${plan.size} agents${capped}: ${parts.join('; ') || 'withdrew the waiting changes'}.`;
    }
    const hires = made.filter((r) => r.kind === 'hire');
    const leaves = made.filter((r) => r.kind === 'let-go');
    const asks = [hires.length ? `add ${names(hires)}` : '', leaves.length ? `let ${names(leaves)} go` : ''].filter(Boolean).join(' and ');
    if (made.length) {
      const text = `📈 Floor ${repo.floor}: from ${before} to ${plan.size} agents? I'd ${asks}. ${reason}`;
      const changes = made.map((r) => ({ id: r.id, name: r.name, kind: r.kind }));
      this.postMessage('ceo', hires.length ? `${text} ${hires.length === 1 ? `${hires[0].name} waits` : 'They wait'} in the lobby, where you can set them up before hiring.` : text, made.length === 1 ? made[0].id : undefined, { changes });
      const body = `${this.ceo().name} would ${asks}. ${plainText(reason)}`;
      const one = made.length === 1 ? { requestId: made[0].id, actions: ['approve', 'approvals'] as NoticeAction[] } : { actions: ['approvals'] as NoticeAction[] };
      this.notice({ kind: 'approval', title: `Floor ${repo.floor}: ${before} → ${plan.size} agents?`, text: body, target: { kind: 'floor', repoId: repo.id }, ...one }, { event: 'hire', line: `floor ${repo.floor} team change`, changes });
    }
    return `Floor ${repo.floor} goes from ${before} to ${plan.size} agents${capped} once the manager agrees: ${asks || 'withdrew the waiting changes'}.`;
  }

  /**
   * Demo only: the CEO grows or shrinks a floor by one right now (the demo office's Team tab on the phone and
   * __swarmHiring). It goes through scale_team: same checks, phone message and auto mode.
   */
  demoPropose(kind: unknown, floor?: unknown) {
    if (!this.backend.demo) throw new HttpError(404, 'Only the demo office makes up team changes');
    if (kind !== 'hire' && kind !== 'let-go') throw new HttpError(400, 'kind must be "hire" or "let-go"');
    const floors = [...this.state.repos].sort((x, y) => x.floor - y.floor).filter((r) => floor === undefined || floor === null || r.floor === Number(floor));
    if (!floors.length) throw new HttpError(404, floor === undefined || floor === null ? 'There are no floors yet' : `There is no floor ${floor}`);
    for (const r of floors) {
      const size = plannedSize(this.teamNow(r));
      const ready = this.repoRt.get(r.id)?.lastSync ? this.readyIssues(r).length : 0;
      if (kind === 'hire' ? size >= this.state.settings.maxAgents : size <= 1 || !this.available(r).length) continue;
      const reason =
        kind === 'hire'
          ? `${ready} issue${ready === 1 ? '' : 's'} could start, and ${this.available(r).length} of ${size} agents are free.`
          : `${this.available(r).length} of ${size} agents have nothing to do, and ${ready} issue${ready === 1 ? '' : 's'} could start.`;
      try {
        return { text: this.scaleTeam({ floor: r.floor, size: kind === 'hire' ? size + 1 : size - 1, reason }) };
      } catch (err) {
        throw new HttpError(409, (err as Error).message);
      }
    }
    throw new HttpError(409, kind === 'hire' ? 'Every floor already has its most agents' : 'No floor has an idle agent to let go');
  }

  // ---------- open decisions (#114, shared/decisions.ts) ----------

  override snapshot(): WorldSnapshot {
    return { ...super.snapshot(), decisions: shownDecisions(this.state.decisions.list) };
  }

  protected setDecisions(list: Decision[]) {
    if (list === this.state.decisions.list) return;
    this.state.decisions.list = list;
    this.broadcast({ type: 'decisions', decisions: shownDecisions(list) });
    this.save();
  }

  /** Every chat message: a CEO question with suggestions opens a decision, the manager's answer closes it. */
  protected override postMessage(...a: Parameters<SwarmUpkeep['postMessage']>): PhoneMessage {
    const m = super.postMessage(...a);
    const list = this.state.decisions.list;
    this.setDecisions(m.from === 'manager' ? onManagerMessage(list, m, m.at) : fromCeoMessage(list, m, m.at));
    return m;
  }

  override decideCharter(id: string, approve: boolean, edited?: unknown): RepoView {
    const view = super.decideCharter(id, approve, edited);
    this.syncDecisions();
    return view;
  }

  /** What the office itself waits on the manager for: team changes, charter proposals, agents' questions. */
  private decisionSeeds(): DecisionSeed[] {
    const floor = (repoId: string) => this.state.repos.find((r) => r.id === repoId)?.floor ?? '?';
    const asked = (requestId: string) => this.state.messages.find((m) => m.requestId === requestId)?.id ?? null;
    return [
      ...this.state.requests
        .filter((r) => r.status === 'pending')
        .map((r): DecisionSeed => ({ id: `team:${r.id}`, kind: 'team', question: r.kind === 'hire' ? `Hire ${r.name} on floor ${floor(r.repoId)}?` : `Let ${r.name} go from floor ${floor(r.repoId)}?`, options: [], repoIds: [r.repoId], messageId: asked(r.id), at: r.createdAt })),
      ...this.state.repos.flatMap((r) => {
        const p = r.charter.proposal;
        return p ? [{ id: `charter:${r.id}:${p.at}`, kind: 'charter' as const, question: `Floor ${r.floor}'s charter change: ${plainText(p.reason, 100) || 'approve it?'}`, options: [], repoIds: [r.id], messageId: null, at: p.at }] : [];
      }),
      ...this.state.questions
        .filter((q) => q.to === 'manager')
        .map((q): DecisionSeed => ({ id: `ask:${q.id}`, kind: 'question', question: `${q.agentName}: ${plainText(q.text, 120)}`, options: q.options, repoIds: [q.repoId], messageId: q.messageId, at: q.notifiedAt ?? q.at })),
    ];
  }

  private decisionGone(x: DecisionAbout) {
    if (x.kind === 'agent') return !this.state.agents.some((a) => a.id === x.agentId);
    const rt = this.repoRt.get(x.repoId);
    if (!rt) return !this.state.repos.some((r) => r.id === x.repoId);
    return rt.closedIssues.has(x.number) || rt.closedPulls.has(x.number);
  }

  /** Brings the decisions up to date with the office, and sends the daily digest when the manager turned it on. */
  protected syncDecisions() {
    const now = Date.now();
    this.setDecisions(syncDecisions(this.state.decisions.list, { seeds: this.decisionSeeds(), gone: (x) => this.decisionGone(x) }, now));
    const n = this.state.settings.notify.events.decisions ? digestDue(this.state.decisions, now) : 0;
    if (!n) return;
    this.state.decisions.digestAt = now;
    this.notice({ kind: 'approval', title: `🧭 ${n} decision${n === 1 ? '' : 's'} waiting`, text: 'Questions you have not answered yet wait in the chat and in Approvals.', actions: ['approvals'] }, { event: 'decisions' });
  }

  /** The manager's ⋯ on a decision: Not now (24 hours) or Drop it (never raised again). */
  decideOpen(id: string, action: unknown) {
    const d = this.state.decisions.list.find((x) => x.id === id);
    if (!d || d.status !== 'open') throw new HttpError(404, 'That decision is no longer open');
    if (action !== 'snooze' && action !== 'drop') throw new HttpError(400, 'action must be "snooze" or "drop"');
    const now = Date.now(), list = this.state.decisions.list;
    this.setDecisions(action === 'snooze' ? snoozeDecision(list, id, now) : closeDecision(list, id, 'dropped', 'dropped by the manager', now));
    return { ok: true };
  }

  /** Demo only: a fresh demo office opens with a CEO question left unanswered and a team change waiting. */
  protected seedDemoDecisions() {
    for (const text of DEMO_DECISION_MESSAGES) this.postMessage('ceo', text);
    for (const kind of ['hire', 'let-go']) {
      try {
        return void this.demoPropose(kind);
      } catch {
        // no floor has room for this one: try the other
      }
    }
  }

  /** resolve_decision: the CEO closes one the manager answered in words, or one a newer question replaced. */
  protected resolveDecision(x: { id: string; outcome: string; superseded?: boolean }) {
    const d = this.state.decisions.list.find((y) => y.id === x.id);
    if (!d) throw new Error(`No decision "${x.id}". Use an id from company_status's openDecisions.`);
    if (d.status !== 'open') return `"${d.question}" was already ${d.status}.`;
    this.setDecisions(closeDecision(this.state.decisions.list, d.id, x.superseded ? 'superseded' : 'resolved', x.outcome, Date.now()));
    return `${x.superseded ? 'Superseded' : 'Closed'} "${d.question}": ${plainText(x.outcome, 120)}.`;
  }
}
