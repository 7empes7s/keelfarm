// The CEO's office tools (ceo.ts createOfficeTools): what each one reads and does.
import crypto from 'node:crypto';
import {
  checkCloseIssue,
  createOfficeTools,
  experimentInput,
  floorCapacity,
  issueRefusal,
  MANDATE_NOT_ASKED,
  planDependencies,
  prDiffText,
  agentLogText,
  qaReportText,
  AGENT_LOG_MAX as AGENT_LOG_MAX_LINES,
  type OfficeHandlers,
  type OfficeTools,
} from '../ceo.ts';
import { researchReadOnly } from '../research.ts';
import { anyMet, ASK_DEFAULT_MIN, ASK_MAX_MIN, waitLabel, waitMs, waitProblem, type WaitCondition, type WaitWorld } from '../ceoWaits.ts';
import type { Consult } from '../consult.ts';
import { nameList } from '../closeCleanup.ts';
import type { CharterProposalArgs } from '../charterTool.ts';
import { HttpError } from '../httpError.ts';
import { parsePreviewPatch } from '../previews.ts';
import { qaShotFile, qaShotsDir } from '../qaShots.ts';
import { answerPrompt, escalated, newQuestion, questionEvent, questionFromTurn, questionOf, waitingOn, type AgentQuestion } from '../../shared/questions.ts';
import { usageLine } from '../../shared/usageSources.ts';
import { checkBinding } from '../../shared/accounts.ts';
import { usageLabel } from '../pacing.ts';
import { ceoSpend, floorRoundsByCause, floorSpend } from '../costLedger.ts';
import { checkRestart, sessionKind } from '../health.ts';
import { labPattern } from '../testLab.ts';
import { resumesAfterRestart } from '../restartRecovery.ts';
import { blockers } from '../../shared/issues.ts';
import { redact as scrub } from '../../shared/journal.ts';
import { historyText } from '../../shared/history.ts';
import { mandateFor, MAX_MANDATES } from '../../shared/followups.ts';
import { charterOf, charterText, cleanCharter, CHARTER_PROMPT_MAX, objectiveRefusal, renderCharter } from '../../shared/charter.ts';
import { OFFICE_PLAYBOOK_MAX, PLAYBOOK_MAX } from '../../shared/types.ts';
import { modelAfterCliChange, modelProblem } from '../../shared/models.ts';
import { isCli } from '../clis.ts';
import type { AgentView, CeoVerdict, HireRequestView, PhoneMessage } from '../../shared/types.ts';
import { changesBlock, changesDue, markVerdict, reviewing, settle, stillOn, takeUntold } from '../../shared/managerChanges.ts';
import { type PersistedAgent, type PersistedRepo, CEO_MODEL, CEO_EFFORT, BUSY, QA_SHOTS_DIR } from './model.ts';
import { clip } from '../notify.ts';
import { SwarmTeam } from './team.ts';
import { decisionsForCeo, type DecisionAbout } from '../../shared/decisions.ts';
import { applyEdit } from '../../shared/messageEdits.ts';
import { excerpt } from '../../shared/chat.ts';
import { parseRefs } from '../../shared/chatRefs.ts';
import { telegramChat } from '../telegram.ts';
import { NEXT_FREE } from '../../shared/assignIssue.ts';

export abstract class SwarmCeoTools extends SwarmTeam {
  /**
   * The CEO's office tools. Every session gets its own server: one can only be connected to one session at a time, so
   * a shared one left the next session connected but without any tools while an earlier session still held it.
   */
  protected officeTools(): OfficeTools {
    const acts = this.spend.acts;
    // Every call is noted for a Stop's reply (ceoChat.ts).
    return createOfficeTools(this.ceoChat.track(researchReadOnly({
      companyStatus: () => this.companyStatus(),
      agentDetail: (a) => this.agentDetail(a),
      setFloorProfile: acts((a) => this.setFloorProfile(a)),
      setOfficePlaybook: acts((a) => `Saved the office playbook (${this.setOfficePlaybook(a.playbook).length} of ${OFFICE_PLAYBOOK_MAX} characters).`),
      scaleTeam: acts((a) => this.didFor(this.scaleTeam(a), a.floor, [], a.reason, `floor ${a.floor}'s team set to ${a.size}`)),
      configureAgent: acts((a) => this.didForAgent(this.configureAgent(a), a.agent_id)),
      fileIssue: (a) => this.fileIssue(a),
      setDependencies: acts((a) => this.setDependencies(a)),
      closeIssue: acts(async (a) => this.didFor(await this.closeIssue(a), a.floor, [Number(a.number)], a.reason, `closed #${a.number}`)),
      retryQa: acts((a) => this.triageRetryQa(a)),
      sendBack: acts((a) => this.triageSendBack(a)),
      rerunChecks: acts((a) => this.triageRerunChecks(a)),
      closePull: acts((a) => this.triageClosePull(a)),
      escalate: acts((a) => this.triageEscalate(a)),
      attachFile: (a) => this.ceoFiles.attach(a),
      keepFile: (a) => this.ceoFiles.keep(a),
      setMandate: acts((a) => this.setMandate(a)),
      proposeCharter: acts((a) => this.proposeCharter(a)),
      resolveDecision: acts((a) => this.resolveDecision(a)),
      proposeDesign: acts((a) => this.proposeDesign(a)),
      defineExperiment: acts((a) => this.lab.defineText(experimentInput(a, (n) => this.state.repos.find((r) => r.floor === n)?.id ?? null))),
      agentLog: (a) => this.agentLog(a),
      restartAgent: acts((a) => this.restartAgent(a)),
      stopAgent: acts((a) => this.ceoStopAgent(a)),
      messageAgent: acts((a) => this.messageAgent(a)),
      assignIssue: acts(async (a) => (await this.assignIssue(this.floorRepo(a.floor).id, Number(a.number), a.agent ?? NEXT_FREE, 'ceo')).text),
      answerAgent: acts((a) => this.answerAgent(a)),
      askManagerChoice: acts((a) => this.askManagerChoice(a)),
      qaReport: (a) => this.qaReport(a),
      worktreeFile: (a) => this.worktreeFile(a),
      prDiff: (a) => this.prDiff(a),
      sendTelegram: (a) => this.sendTelegram(a),
      editMessage: async (a) => this.editCeoMessage(a),
      waitFor: (a) => this.waitFor(a),
      askManager: (a) => this.askManager(a),
      consult: (a) => this.consult(a),
      sessionHistory: (a) => this.sessionHistory(a),
      react: (a) => this.ceoReact(a),
      reply: (a) => this.ceoReply(a),
    }, () => this.state.ceo.job?.kind === 'research')));
  }

  // ---------- the CEO's office tools ----------

  /** After a tool call that changed something on a floor: the open questions it answered (#208). Returns its output. */
  protected didFor(out: string, floor: number, issues: number[], text: string, done: string, link?: DecisionAbout): string {
    const repo = this.state.repos.find((r) => r.floor === Number(floor));
    if (repo) this.decisionActedOn({ repoId: repo.id, about: issues.map((number) => ({ kind: 'issue', repoId: repo.id, number })), text, done, ...(link && { link }) });
    return out;
  }

  private didForAgent(out: string, ref: string): string {
    const a = this.state.agents.find((x) => x.id === ref || x.name.toLowerCase() === String(ref).trim().toLowerCase());
    if (a?.repoId) this.decisionActedOn({ repoId: a.repoId, about: [{ kind: 'agent', agentId: a.id }], text: a.name, done: `changed ${a.name}'s setup` });
    return out;
  }

  /** A chat message's text replaced by its sender (#125): its old text kept as a version, its chips found again, every tab told. False when nothing changed. */
  protected replaceText(m: PhoneMessage, text: string, reason?: string): boolean {
    const edit = applyEdit(m, text, Date.now(), reason);
    if (!edit) return false;
    const refs = parseRefs(text, this.refContext());
    Object.assign(m, edit, { refs: refs.length ? refs : undefined });
    this.broadcast({ type: 'ceoChat', message: m });
    this.save();
    return true;
  }

  /** edit_message: one of the CEO's own messages (default its latest), shown with its old words struck through; its Telegram copy follows. */
  protected editCeoMessage(a: { id?: number; text: string; reason?: string }): string {
    const mine = this.state.messages.filter((m) => m.from === 'ceo');
    const m = a.id === undefined ? mine.at(-1) : mine.find((x) => x.id === a.id);
    if (!m) throw new Error(mine.length ? `#${a.id} isn't one of your messages here. Your latest: ${mine.slice(-3).map((x) => `#${x.id} "${excerpt(x.text, 40)}"`).join(', ')}.` : "You haven't sent the manager a message in this conversation yet.");
    const text = String(a.text ?? '').trim().slice(0, 6000);
    if (!text) throw new Error('Write the whole corrected message.');
    if (!this.replaceText(m, text, a.reason?.trim() || undefined)) return `#${m.id} already says that.`;
    if (m.telegram === 'out') void this.telegram.editSent(m.id, telegramChat(this.ceo().name, m.text)).then((why) => why && console.warn(`telegram: an edit didn't go out: ${why}`));
    return `Edited #${m.id}: the manager sees your old words struck through next to the new ones.`;
  }

  protected floorRepo(floor: number) {
    const r = this.state.repos.find((x) => x.floor === Number(floor));
    if (!r) throw new Error(`There is no floor ${floor}. Floors: ${this.state.repos.map((x) => `${x.floor} (${x.fullName})`).join(', ') || 'none'}.`);
    return r;
  }

  protected agentByRef(ref: string) {
    const r = String(ref ?? '').trim().toLowerCase();
    const a = this.state.agents.find((x) => x.id === ref || x.name.toLowerCase() === r);
    if (!a) throw new Error(`No agent "${ref}". Use the ids from company_status.`);
    return a;
  }

  protected agentDoing(a: PersistedAgent) {
    return !BUSY.includes(a.status) ? null : a.task === 'qa' ? `testing PR #${a.prNumber}` : a.task === 'fix' ? `fixing PR #${a.prNumber}` : `issue #${a.issueNumber}`;
  }

  /** What an agent runs, defaults resolved, for the CEO. */
  protected agentSetup(a: PersistedAgent) {
    const ceo = a.role === 'ceo';
    const cli = ceo ? 'claude' : a.cli || this.state.settings.defaultCli;
    return {
      codingAgent: cli,
      model: ceo ? a.model || CEO_MODEL : this.modelFor(a, cli) || 'the coding agent default',
      effort: a.effort || (ceo ? CEO_EFFORT : this.state.settings.defaultEffort),
    };
  }

  protected companyStatus() {
    const s = this.state.settings;
    const ops = this.opsNow();
    const pending = this.state.requests.filter((r) => r.status === 'pending');
    const floors = [...this.state.repos]
      .sort((x, y) => x.floor - y.floor)
      .map((r) => {
        const rt = this.repoRt.get(r.id)!;
        const open = new Set(rt.issues.map((i) => i.number));
        const team = this.teamNow(r);
        const nums = ops.floors.find((f) => f.repoId === r.id);
        return {
          floor: r.floor,
          repo: r.fullName,
          description: r.description,
          clone: rt.cloneStatus === 'ready' ? this.backend.mainDir(r.fullName) : `(not available: clone ${rt.cloneStatus})`,
          charter: renderCharter(charterOf(r.mission, r.charter)) || null,
          charterProposalWaiting: !!r.charter.proposal,
          profile: r.summary || null,
          qaBrief: r.qaBrief || null,
          playbook: r.playbook || null,
          preview: { command: r.preview.command, env: r.preview.env, status: this.previews.view(r).status },
          autoAssign: r.autoAssign,
          autoMerge: r.autoMerge,
          folderSync: rt.folderSync,
          team: { size: team.agents.length, max: s.maxAgents, free: this.available(r).length, pendingHires: team.pendingHires.length, pendingLetGos: team.pendingLetGos.length },
          throughput: {
            mergedLastHour: nums?.mergedHour ?? 0,
            mergedToday: nums?.mergedToday ?? 0,
            medianLeadMinutes: nums?.leadMs != null ? Math.round(nums.leadMs / 60_000) : null,
            qaPassRate: nums?.qaPass ?? null,
            qaFirstRoundPassRate: nums?.qaFirstPass ?? null,
            qaRoundsPerMerge: nums?.qaRoundsPerMerge != null ? Math.round(nums.qaRoundsPerMerge * 100) / 100 : null,
            roundsByCause: floorRoundsByCause(this.spend.ledger.all(), r.id, Date.now()), // failed rounds, 7 days; outage and lab-error aren't in qaRoundsPerMerge
            qaLabErrors: nums?.qaLabErrors ?? 0,
          },
          spend: floorSpend(this.spend.ledger.all(), r.id, Date.now()),
          capacity: {
            issuesReadyToStart: this.readyIssues(r).length,
            ...floorCapacity({
              issues: rt.issues,
              inProgress: (n) => this.issueTaken(r, n),
              openPrs: rt.pulls.filter((p) => p.state === 'OPEN').map((p) => p.number),
              qa: this.state.qa.filter((q) => q.repoId === r.id),
            }),
          },
          agents: this.state.agents
            .filter((a) => a.repoId === r.id)
            .map((a) => ({ id: a.id, name: a.name, status: a.status, doing: this.agentDoing(a), ...this.agentSetup(a) })),
          backlog: rt.issues.map((i) => ({
            number: i.number,
            title: i.title,
            waitsFor: blockers(i.body, open),
            inProgress: this.issueTaken(r, i.number),
            ...(this.isHeld(r.id, i.number) ? { waitsForManager: 'its PR was closed; only the manager hands it out again' } : {}),
            ...(i.untrusted ? { waitsForManager: `untrusted author @${i.author ?? 'ghost'}; never built until the manager trusts it` } : {}),
          })),
          pullRequests: rt.pulls
            .filter((p) => p.state === 'OPEN')
            .map((p) => {
              const q = this.state.qa.find((x) => x.repoId === r.id && x.prNumber === p.number);
              return { number: p.number, title: p.title, qa: p.untrusted ? 'from outside: the manager reviews it on GitHub' : q ? `${q.status}${q.round > 1 ? ` (round ${q.round})` : ''}` : 'not tested', merge: q?.mergeNote ?? null, checks: p.checks };
            }),
          mergedRecently: rt.pulls.filter((p) => p.state === 'MERGED').map((p) => `#${p.number} ${p.title}`),
          questions: this.state.questions.filter((q) => q.repoId === r.id).map((q) => ({ agent: q.agentId, name: q.agentName, issue: q.issue, pr: q.pr, question: q.text, options: q.options, waitingFor: q.to === 'ceo' ? 'you' : 'the manager' })),
        };
      });
    const req = (r: HireRequestView) => ({
      id: r.id,
      kind: r.kind,
      floor: this.state.repos.find((x) => x.id === r.repoId)?.floor ?? null,
      name: r.name,
      reason: r.reason,
      status: r.status,
      managerNote: r.note || null,
    });
    return JSON.stringify(
      {
        company: {
          ceo: this.ceo().name,
          ceoSpend: ceoSpend(this.spend.ledger.all(), Date.now()), // the CEO's own jobs, kept out of each floor's spend (#254)
          scaling: s.scaling === 'auto' ? 'team changes apply straight away' : 'the manager approves every team change',
          maxAgentsPerFloor: s.maxAgents,
          sessionLimit: s.sessionLimit || 'none',
          sessionsRunning: this.running(),
          usage: `${usageLabel(this.usageNow(), Date.now())} · ${usageLine(this.usageSources())}`, // every account and provider (#361); pacing follows the agents' Claude login
          experiments: this.lab.summary(), // only the manager starts, stops and promotes them
          providers: this.providersLine(), // every connection on Settings → Providers (#362)
          accounts: this.accounts.view().accounts.map((x) => `${x.id} (${x.cli}, ${x.kind}${x.tags.length ? `, tags ${x.tags.join('/')}` : ''}): ${x.status}`),
          officePlaybook: s.officePlaybook || null,
        },
        floors,
        pendingChanges: pending.map(req),
        recentDecisions: this.state.requests.filter((r) => r.status !== 'pending').slice(-10).map(req),
        openDecisions: decisionsForCeo(this.state.decisions.list, Date.now(), (id) => this.state.repos.find((r) => r.id === id)?.floor ?? null),
      },
      null,
      1,
    );
  }

  protected agentDetail(x: { agent_id: string }) {
    const a = this.agentByRef(x.agent_id);
    const repo = this.state.repos.find((r) => r.id === a.repoId);
    return JSON.stringify(
      {
        id: a.id,
        name: a.name,
        floor: repo?.floor ?? null,
        ...(a.role === 'ceo' ? { role: 'CEO' } : {}),
        status: a.status,
        doing: this.agentDoing(a),
        issue: a.issueNumber ? { number: a.issueNumber, title: a.issueTitle } : null,
        pullRequest: a.prNumber ? { number: a.prNumber, url: a.prUrl } : null,
        ...this.agentSetup(a),
      },
      null,
      1,
    );
  }

  protected setFloorProfile(x: { floor: number; summary?: string; qa_brief?: string; playbook?: string; preview_command?: string; preview_env?: Record<string, string>; lab_commands?: string[] }) {
    const r = this.floorRepo(x.floor);
    const preview = parsePreviewPatch(x.preview_command, x.preview_env);
    const lab = x.lab_commands?.map(labPattern);
    if (x.summary !== undefined) r.summary = String(x.summary).trim().slice(0, 140);
    if (x.qa_brief !== undefined) r.qaBrief = String(x.qa_brief).trim().slice(0, 2500);
    if (x.playbook !== undefined) r.playbook = String(x.playbook).trim().slice(0, PLAYBOOK_MAX);
    if (lab) r.labCommands = lab;
    r.preview = { ...r.preview, ...preview };
    if (preview.command === null) void this.previews.refreshDefault(r);
    this.emitRepo(r);
    this.save();
    return `Saved floor ${r.floor}'s profile.`;
  }

  /** The office-wide playbook (#50), from Settings or set_office_playbook; over its cap it's refused, not cut. */
  setOfficePlaybook(text: unknown): string {
    const t = typeof text === 'string' ? text.trim() : '';
    if (t.length > OFFICE_PLAYBOOK_MAX) throw new HttpError(400, `The office playbook is ${t.length} characters: keep it to ${OFFICE_PLAYBOOK_MAX}, it is in every session's prompt.`);
    this.state.settings.officePlaybook = t;
    this.save();
    this.broadcast({ type: 'settings', settings: this.state.settings });
    return t;
  }

  /** configure_agent: an agent's coding agent, model or effort, from their next task. */
  protected configureAgent(x: { agent_id: string; account?: string; cli?: string; model?: string; effort?: string; tools_off?: string[]; tools_on?: string[]; tools_reset?: string[] }) {
    const a = this.agentByRef(x.agent_id);
    if (a.role === 'ceo') throw new Error("That's you: the manager sets the CEO up.");
    const switches = [...(x.tools_off ?? []).map((r) => [r, false] as const), ...(x.tools_on ?? []).map((r) => [r, true] as const), ...(x.tools_reset ?? []).map((r) => [r, null] as const)];
    if (x.account === undefined && x.cli === undefined && x.model === undefined && x.effort === undefined && !switches.length) throw new Error('Nothing to change: pass account, cli, model, effort, tools_off, tools_on, tools_reset or a mix.');
    const account = x.account === undefined ? undefined : checkBinding(this.accounts.list(), x.account); // checked before anything changes
    // Switching off only takes away. Turning on, or undoing a switch, can undo the manager's own: only when they asked.
    if (!this.ceoAsked && switches.some(([, on]) => on !== false)) throw new Error('tools_on and tools_reset only when the manager asks for it in their message; tools_off is always allowed.');
    // Every name is checked before anything changes.
    const items = this.tooling.items;
    const picked = switches.map(([ref, on]) => {
      const item = items.find((i) => i.id === ref) ?? items.find((i) => i.name.toLowerCase() === ref.toLowerCase());
      if (!item) throw new Error(`No tool, plugin, skill or MCP server called "${ref}". Some there are: ${items.filter((i) => !i.locks).slice(0, 15).map((i) => i.name).join(', ')}.`);
      if (item.locks?.agent) throw new Error(`${item.name} can't be switched for agents: ${item.locks.agent.why}.`);
      return { item, on };
    });
    // A model must be one of their coding agent's (#198); one the new coding agent doesn't have goes back to the default.
    const cli = this.state.settings.runtime === 'terminal' ? (x.cli === undefined ? a.cli : isCli(x.cli) ? x.cli : '') || this.state.settings.defaultCli : 'claude';
    const bad = modelProblem(x.model, cli, this.models);
    if (bad) throw new Error(bad);
    const model = x.model ?? (x.cli !== undefined ? modelAfterCliChange(a.model, cli, this.models) : undefined);
    if (x.cli !== undefined || model !== undefined || x.effort !== undefined) this.updateAgent(a.id, { cli: x.cli, model, effort: x.effort });
    for (const { item, on } of picked) this.setToolSwitch(a.id, item.id, on);
    if (x.account !== undefined) this.updateAgent(a.id, { account: account ?? '' });
    const setup = [this.setupLabel(a) || 'the office defaults', x.account !== undefined ? `on ${account ?? 'the rotation'}` : ''].filter(Boolean).join(' ');
    const tools = picked.map(({ item, on }) => `${item.name} ${on === null ? 'as the office has it' : on ? 'on' : 'off'}`).join(', ');
    this.appendLog(a, [{ kind: 'system', text: `⚙️ ${this.ceo().name} set ${a.name} up with ${setup}${tools ? `; ${tools}` : ''}.` }]);
    return `${a.name} runs ${setup}${tools ? ` with ${tools}` : ''} from their next task.`;
  }

  protected async fileIssue(x: { floor: number; title: string; body: string }) {
    const repo = this.floorRepo(x.floor);
    const refused = issueRefusal({ kind: this.state.ceo.job?.kind ?? null, asked: this.ceoAsked, floor: repo.floor, mandate: mandateFor(this.state.settings.ceoMandates, repo.floor, Date.now()) });
    if (refused) throw new Error(refused);
    this.ceoIssues.check();
    const title = String(x.title ?? '').trim().slice(0, 120);
    if (!title) throw new Error('An issue needs a title.');
    const untagged = objectiveRefusal(String(x.body ?? ''), repo.charter);
    if (untagged) throw new Error(untagged);
    const body = `${String(x.body ?? '').trim()}\n\n---\n_Filed by ${this.ceo().name}, the cubefarm CEO._`;
    const n = await this.backend.createIssue(repo.fullName, title, body);
    this.ceoIssues.record(repo.id);
    this.didFor('', repo.floor, [], title, `filed #${n}`, { kind: 'issue', repoId: repo.id, number: n });
    return `Filed #${n} on floor ${repo.floor}: ${title}.`;
  }

  /** Rewrite an open issue's "Depends on #N" line (see planDependencies for what is refused). */
  protected async setDependencies(x: { floor: number; number: number; depends_on: number[] }) {
    const repo = this.floorRepo(x.floor);
    const issues = this.repoRt.get(repo.id)?.issues ?? [];
    const deps = (x.depends_on ?? []).map(Number);
    const asked = [Number(x.number), ...deps].filter((n) => !issues.some((i) => i.number === n));
    const states = new Map(await Promise.all([...new Set(asked)].map(async (n) => [n, await this.backend.issueState(repo.fullName, n).catch(() => null)] as const)));
    const plan = planDependencies({
      floor: repo.floor,
      number: Number(x.number),
      dependsOn: deps,
      issues,
      closed: (n) => states.get(n) === 'CLOSED',
      inProgress: this.issueTaken(repo, Number(x.number)),
    });
    if (plan.body !== null) {
      await this.backend.editIssue(repo.fullName, Number(x.number), { body: plan.body });
      await this.syncRepo(repo.id); // the scheduler sees the new order right away
    }
    return plan.summary;
  }

  /** Close an open issue as not planned, with the CEO's reason as its comment (see checkCloseIssue for what is refused). */
  protected async closeIssue(x: { floor: number; number: number; reason: string }) {
    const repo = this.floorRepo(x.floor);
    const n = Number(x.number);
    const rt = this.repoRt.get(repo.id);
    const reason = String(x.reason ?? '').trim().slice(0, 1000);
    if (!reason) throw new HttpError(400, 'Say why the issue is closing: the reason is posted on it as a comment.');
    const state = rt?.issues.some((i) => i.number === n) ? 'OPEN' : await this.backend.issueState(repo.fullName, n).catch(() => null);
    checkCloseIssue({ floor: repo.floor, number: n, state, pulls: rt?.pulls ?? [] });
    await this.backend.closeIssue(repo.fullName, n, reason, 'not planned');
    this.postMessage('office', `🗂️ ${this.ceo().name} closed #${n} on floor ${repo.floor}: ${reason.split('\n')[0].slice(0, 200)}`);
    const stopped = this.learnIssueClosed(repo, n); // off the Kanban, out of the scheduler's queue, and whoever was on it stops
    await this.syncRepo(repo.id);
    return `Closed #${n} on floor ${repo.floor} as not planned.${stopped.length ? ` ${nameList(stopped)} stopped working on it.` : ''}`;
  }

  // ---------- the CEO's mandates and read-only tools (#27) ----------

  /** set_mandate: the manager's "keep working on X until it's perfected", for follow-ups to file issues under. */
  protected setMandate(x: { text: string; floors?: number[]; expires_in_hours?: number }) {
    if (!this.ceoAsked) throw new Error(MANDATE_NOT_ASKED);
    const text = String(x.text ?? '').trim();
    if (!text) throw new Error('Say what the mandate is, in the manager\'s words.');
    const floors = [...new Set((x.floors ?? []).map(Number))].map((f) => this.floorRepo(f).floor);
    const hours = Number(x.expires_in_hours);
    const now = Date.now();
    const kept = this.state.settings.ceoMandates.filter((m) => m.text.toLowerCase() !== text.toLowerCase());
    const mandate = { id: `m-${now.toString(36)}`, text, floors, expiresAt: Number.isFinite(hours) && hours > 0 ? now + hours * 3_600_000 : null, at: now };
    this.updateSettings({ ceoMandates: [...kept, mandate] });
    const saved = this.state.settings.ceoMandates.find((m) => m.id === mandate.id)!;
    const dropped = kept.length + 1 > MAX_MANDATES ? ` The oldest went: at most ${MAX_MANDATES} are kept.` : '';
    return `Recorded: "${saved.text}" for ${saved.floors.length ? `floor${saved.floors.length === 1 ? '' : 's'} ${saved.floors.join(', ')}` : 'every floor'}${saved.expiresAt ? ` until ${new Date(saved.expiresAt).toISOString().slice(0, 16)} UTC` : ''}. Follow-ups may file issues there.${dropped}`;
  }

  /** propose_charter: a charter for the manager to approve or edit, never applied here (decideCharter applies it). */
  protected proposeCharter(x: CharterProposalArgs) {
    const repo = this.floorRepo(x.floor);
    const now = charterOf(repo.mission, repo.charter);
    const charter = cleanCharter({
      mission: x.mission ?? now.mission,
      focus: x.focus ?? now.focus,
      objectives: x.objectives ?? now.objectives,
      standards: x.standards ?? now.standards,
      nonGoals: x.non_goals ?? now.nonGoals,
    });
    if (JSON.stringify(charter) === JSON.stringify(now)) throw new Error(`That is floor ${repo.floor}'s charter already: nothing to propose.`);
    const replaced = repo.charter.proposal ? ' It replaces your earlier proposal.' : '';
    const ceo = this.ceo().name;
    repo.charter.proposal = { at: Date.now(), by: ceo, reason: String(x.reason ?? '').trim().slice(0, 600), charter };
    this.save();
    this.emitRepo(repo);
    this.syncDecisions();
    this.toast('info', `${ceo} proposed a charter for floor ${repo.floor}: approve or edit it in the console's Charter tab.`);
    const size = charterText(charter).length;
    const long = size > CHARTER_PROMPT_MAX ? ` It is ${size} characters: agents get only the first ${CHARTER_PROMPT_MAX}, so tighten it.` : '';
    return `Proposed for floor ${repo.floor}. Nothing changes until the manager approves or edits it.${replaced}${long}`;
  }

  /** agent_log: an agent's last terminal lines and their session, secrets masked as for the journal. */
  protected agentLog(x: { agent_id: string; lines?: number }) {
    const a = this.agentByRef(x.agent_id);
    const rt = this.agentRt.get(a.id);
    const secrets = this.secrets();
    const lines = rt?.terminal ? rt.terminal.tail(AGENT_LOG_MAX_LINES) : (rt?.log ?? a.logTail).map((l) => l.text);
    const floor = this.state.repos.find((r) => r.id === a.repoId)?.floor ?? null;
    return agentLogText(a, { floor, doing: this.agentDoing(a), lines, wanted: x.lines, mask: (t) => scrub(t, secrets) });
  }

  /** session_history: past sessions from the history (#49), filtered, newest first, a page at a time. */
  protected sessionHistory(x: Parameters<OfficeHandlers['sessionHistory']>[0]) {
    const per = 20;
    const page = Math.max(1, Math.floor(x.page ?? 1));
    const repoId = x.floor === undefined ? undefined : this.floorRepo(x.floor).id;
    const since = Date.now() - (x.days ?? 7) * 86_400_000;
    return historyText(this.history.page({ repoId, agent: x.agent, kind: x.kind, outcome: x.outcome, issue: x.issue, pr: x.pr, q: x.query, since, offset: (page - 1) * per, limit: per }), page, per);
  }

  /** The CEO still chats while the office drains for its update (#46), but starts no agent's session until the restart. */
  protected refuseWhileUpdating() {
    if (this.updateRun.holding) throw new Error('The office is updating itself: no agent session starts until it restarts. Tell the manager, and try again after the update.');
  }

  protected restartAgent(x: { agent_id: string }) {
    const a = checkRestart(this.agentByRef(x.agent_id));
    const resumes = resumesAfterRestart(a, false, this.backend.demo);
    if (resumes) {
      this.refuseWhileUpdating();
      this.ensureSlot(sessionKind(a), a); // refused with the reason: memory, or the session limit
    }
    this.recover([a], new Set(), new Set(resumes ? [] : [a]), undefined, 'The CEO restarted your task');
    return resumes ? `${a.name} picks their session back up.` : `${a.name}'s task went back to the queue; they are free for the next one.`;
  }

  // ---------- the manager's changes (#207, shared/managerChanges.ts) ----------

  /** stop_agent: the CEO ends a running session, e.g. on an issue or PR the manager closed. */
  protected ceoStopAgent(x: { agent_id: string; reason: string }) {
    const a = this.agentByRef(x.agent_id);
    if (a.role === 'ceo') throw new Error('That is you: end your job instead.');
    if (!BUSY.includes(a.status)) throw new Error(`${a.name} isn't running a session (${a.status}): nothing to stop.`);
    this.stopAgent(a.id, `${this.ceo().name} (CEO): ${clip(x.reason, 200)}`);
    this.verdict(a, 'stopped');
    return `Stopped ${a.name}. Their desk is cleared if their issue or PR is closed.`;
  }

  /** What the CEO did about an agent a manager's change touched, for their card and Mission control. */
  protected verdict(a: PersistedAgent, v: CeoVerdict) {
    if (!markVerdict(this.state.ceo.changes, a.id, v)) return;
    this.emitChanges([a.id]);
    this.save();
  }

  /** Wake the CEO once a burst of changes that touched running work has settled. */
  protected maybeChanges() {
    if (changesDue(this.state.ceo.changes, Date.now())) {
      this.state.ceo.changes.wakeAt = null;
      this.enqueueCeo({ kind: 'changes', at: Date.now() });
    }
  }

  protected ceoChanges: string[] = []; // the changes in the running CEO job's prompt

  /** The changes the CEO hasn't heard of, as a block for the job starting now (shared/managerChanges.ts takeUntold). */
  protected takeChanges(job: { kind: string }): string {
    const changes = takeUntold(this.state.ceo.changes, job.kind === 'changes');
    this.ceoChanges = changes.map((c) => c.id);
    if (changes.length) this.emitChanges();
    return changesBlock(changes, (c, id) => {
      const a = this.state.agents.find((x) => x.id === id);
      return !a ? id : BUSY.includes(a.status) && stillOn(c, a) ? `${a.name} (${a.id}, ${this.agentDoing(a)})` : `${a.name} (${a.id}, finished it already)`;
    });
  }

  /** The CEO's job ended: what it didn't act on was let finish. A preempted job hears its changes again. Returns `preempted`. */
  protected settleChanges(preempted: boolean): boolean {
    const ids = this.ceoChanges.splice(0);
    const list = this.state.ceo.changes.list.filter((c) => ids.includes(c.id));
    if (preempted) for (const c of list) c.told = false;
    else if (!settle(this.state.ceo.changes, ids)) return preempted;
    this.emitChanges(list.flatMap((c) => c.affects));
    return preempted;
  }

  // ---------- agents' questions (#36, shared/questions.ts) ----------

  /** An agent waiting on an answer shows who they wait for (their card, badge and ❓ sign); one a manager's change touched, that the CEO decides. */
  protected agentView(a: PersistedAgent, withLog: boolean): AgentView {
    const v = super.agentView(a, withLog);
    const waiting = waitingOn(this.state.questions, a.id);
    const reviewedBy = BUSY.includes(a.status) && reviewing(this.state.ceo.changes, a) ? this.ceo().name : null;
    return { ...v, waiting, reviewedBy, ...(waiting && v.status !== 'working' && { activity: { kind: 'waiting' as const, detail: waiting === 'ceo' ? 'the CEO' : 'you' } }) };
  }

  protected clearTask(a: PersistedAgent) {
    this.dropQuestion(a.id); // their task is gone: so is what they asked about it
    super.clearTask(a);
  }

  protected setQuestions(list: AgentQuestion[]) {
    const touched = new Set([...this.state.questions, ...list].map((q) => q.agentId));
    this.state.questions = list.filter((q) => this.state.agents.some((a) => a.id === q.agentId));
    this.emitCeo();
    for (const a of this.state.agents) if (touched.has(a.id)) this.emitAgent(a);
    this.save();
    this.syncDecisions();
  }

  /** The agent moved on (a new session, or their task cleared): their open question closes. */
  protected dropQuestion(agentId: string) {
    if (questionOf(this.state.questions, agentId)) this.setQuestions(this.state.questions.filter((q) => q.agentId !== agentId));
  }

  /** A session that ended asking something: the agent waits, and a follow-up wakes the CEO (else the manager is asked). */
  protected ask(a: PersistedAgent, repo: PersistedRepo, text: string): boolean {
    const asked = questionFromTurn(scrub(text, this.secrets())); // it goes to the CEO, the chat and notifications
    if (!asked) return false;
    const q = newQuestion(`q-${crypto.randomUUID().slice(0, 8)}`, asked, { agentId: a.id, agentName: a.name, repoId: repo.id, floor: repo.floor, issue: a.issueNumber, pr: a.prNumber }, Date.now());
    this.setQuestions([...this.state.questions.filter((x) => x.agentId !== a.id), q]);
    this.appendLog(a, [{ kind: 'system', text: `❓ Waiting for an answer: ${clip(q.text, 160)}` }]);
    if (!this.followup(questionEvent(q, this.floorName(repo)))) this.escalateQuestion(q, { question: q.text, options: q.options, recommendation: '' }, 'office');
    return true;
  }

  /** The question goes to the manager: a chat message with one-tap options, and a notification. */
  protected escalateQuestion(q: AgentQuestion, x: { question: string; options: string[]; recommendation: string }, from: 'ceo' | 'office') {
    const mask = (t: string) => scrub(t, this.secrets());
    const e = escalated(q, { question: mask(x.question), options: x.options.map(mask), recommendation: mask(x.recommendation) }, Date.now());
    const work = e.issue ? `, #${e.issue}` : e.pr ? `, PR #${e.pr}` : '';
    const m = this.postMessage(from, `❓ ${e.agentName} asks (floor ${e.floor}${work}): ${e.text}${e.recommendation ? `\nMy pick: ${e.recommendation}` : ''}`, undefined, { question: e.id });
    this.setQuestions(this.state.questions.map((y) => (y.id === q.id ? { ...e, messageId: m.id } : y)));
    this.notifyQuestion(e, false);
  }

  protected notifyQuestion(q: AgentQuestion, again: boolean) {
    const title = `${q.agentName} ${again ? 'still waits for your answer' : 'asks you'}`;
    const text = `${q.text}${q.recommendation ? ` (CEO's pick: ${q.recommendation})` : ''}`;
    this.notice({ kind: 'needsYou', title, text, target: { kind: 'agent', agentId: q.agentId }, actions: ['reply'] }, { event: 'question', line: `${q.agentName} (floor ${q.floor}): ${clip(q.text, 120)}` });
  }

  /** An answer typed into the agent's session as their next message; the question closes first. */
  protected async answerQuestion(q: AgentQuestion, text: string, who: string) {
    this.setQuestions(this.state.questions.filter((x) => x.id !== q.id));
    try {
      await this.message(q.agentId, answerPrompt(q, text, who), false, who);
    } catch (err) {
      if (this.state.agents.some((a) => a.id === q.agentId)) this.setQuestions([...this.state.questions, q]);
      throw err;
    }
  }

  /** The manager answered a question (tapped an option, or replied to its message): to the agent, and the CEO hears. */
  protected async managerAnswer(q: AgentQuestion, text: string, replyTo: number, via?: 'telegram') {
    const m = this.postMessage('manager', text, undefined, { replyTo, delivery: 'read', ...(via && { telegram: 'in' as const }) });
    try {
      await this.answerQuestion(q, text, this.state.settings.managerName || 'the manager');
      this.ceoTold.push(`The manager answered ${q.agentName}'s question "${clip(q.text, 120)}": ${clip(text, 200)}`);
      this.postMessage('office', `↪ Sent to ${q.agentName}: they carry on with your answer.`);
    } catch (err) {
      this.postMessage('office', `That answer didn't reach ${q.agentName}: ${(err as Error).message}`);
    }
    return { id: m.id };
  }

  protected async answerAgent(x: { agent_id: string; text: string }) {
    const a = this.agentByRef(x.agent_id);
    const q = questionOf(this.state.questions, a.id);
    if (!q) throw new Error(`${a.name} has no open question. Use message_agent to guide them.`);
    if (q.to === 'manager') throw new Error(`${a.name}'s question is with the manager already; their answer goes straight to ${a.name}.`);
    await this.answerQuestion(q, x.text, `${this.ceo().name} (CEO)`);
    return `Sent: ${a.name} carries on with your answer.`;
  }

  protected askManagerChoice(x: { agent_id: string; question: string; options: string[]; recommendation: string }) {
    const a = this.agentByRef(x.agent_id);
    const q = questionOf(this.state.questions, a.id);
    if (!q) throw new Error(`${a.name} has no open question to bring to the manager.`);
    if (q.to === 'manager') throw new Error(`${a.name}'s question is with the manager already.`);
    this.escalateQuestion(q, x, 'ceo');
    return `Asked the manager with your recommendation; their answer goes straight to ${a.name}.`;
  }

  protected async messageAgent(x: { floor: number; agent_id: string; text: string }) {
    const a = this.agentByRef(x.agent_id);
    if (a.repoId !== this.floorRepo(x.floor).id) throw new Error(`${a.name} is not on floor ${x.floor}: check their floor in company_status.`);
    const running = !!this.agentRt.get(a.id)?.session;
    if (!running) this.refuseWhileUpdating();
    await this.message(a.id, x.text, false, `${this.ceo().name} (CEO)`);
    this.verdict(a, 'redirected');
    return running ? `Sent: ${a.name} reads it after their current step.` : `${a.name} picked their session back up with your message.`;
  }

  /** qa_report: a PR's latest QA verdict, report and screenshots (as files the CEO can Read). */
  protected qaReport(x: { floor: number; pr: number }) {
    const repo = this.floorRepo(x.floor);
    const pr = Number(x.pr);
    const rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === pr);
    if (!rec) throw new Error(`PR #${pr} on floor ${repo.floor} has no QA record: it hasn't been tested yet, or it has closed.`);
    const secrets = this.secrets();
    const dir = qaShotsDir(QA_SHOTS_DIR, repo.id, pr);
    return qaReportText(rec, repo.floor, (t) => scrub(t, secrets), (i, mime) => qaShotFile(dir, i, mime));
  }

  /** worktree_file: a file or diff from an agent's worktree, or their branch in the floor's clone once it's gone. */
  protected async worktreeFile(x: { agent_id: string; mode: 'file' | 'diff_stat' | 'diff'; path?: string }) {
    const a = this.agentByRef(x.agent_id);
    if (a.role === 'ceo') throw new Error('You have no worktree. Read the clones directly.');
    const repo = this.state.repos.find((r) => r.id === a.repoId);
    if (!repo) throw new Error(`${a.name} isn't on a floor.`);
    if (a.host === 'box') throw new Error(`${a.name} works in a cloud machine, which the office can't read from here. pr_diff shows their pull request.`);
    if (!['file', 'diff_stat', 'diff'].includes(x.mode)) throw new Error('mode is file, diff_stat or diff.');
    const base = `origin/${repo.defaultBranch}`;
    const dir = this.deskOf(a, repo);
    if (this.backend.deskExists(dir)) {
      const out = await this.backend.readWorktree({ dir, ref: null, base, mode: x.mode, path: x.path });
      return `${a.name}'s worktree${a.branch ? ` (${a.branch})` : ''}:\n${scrub(out, this.secrets())}`;
    }
    if (!a.branch) throw new Error(`${a.name} has no worktree or branch right now: they aren't working on anything.`);
    const out = await this.backend.readWorktree({ dir: this.backend.mainDir(repo.fullName), ref: `origin/${a.branch}`, base, mode: x.mode, path: x.path });
    return `${a.name}'s branch ${a.branch} (their worktree is gone; pushed commits only):\n${scrub(out, this.secrets())}`;
  }

  /** pr_diff: a PR's changed files, and its diff when asked, through gh. */
  protected async prDiff(x: { floor: number; pr: number; patch?: boolean }) {
    const repo = this.floorRepo(x.floor);
    const d = await this.backend.prDiff(repo.fullName, Number(x.pr), !!x.patch);
    return prDiffText({ files: d.files, diff: d.diff === null ? null : scrub(d.diff, this.secrets()) });
  }

  // ---------- the CEO's waits, questions and consults (#28) ----------

  /** The office as wait_for sees it. */
  protected waitWorld(): WaitWorld {
    const rt = (floor: number) => {
      const repo = this.state.repos.find((r) => r.floor === floor);
      return repo ? { repo, rt: this.repoRt.get(repo.id) } : null;
    };
    return {
      floors: this.state.repos.map((r) => r.floor),
      qa: (floor, pr) => {
        const f = rt(floor);
        const q = f && this.state.qa.find((x) => x.repoId === f.repo.id && x.prNumber === pr);
        return q ? { status: q.status, summary: q.summary } : null;
      },
      pr: (floor, pr) => {
        const f = rt(floor);
        return f?.rt?.pulls.find((p) => p.number === pr)?.state ?? f?.rt?.closedPulls.get(pr)?.state ?? null;
      },
      issue: (floor, n) => {
        const f = rt(floor);
        return f?.rt?.issues.some((i) => i.number === n) ? 'OPEN' : f?.rt?.closedIssues.has(n) ? 'CLOSED' : null;
      },
      agent: (id) => {
        const a = this.state.agents.find((x) => x.id === id || x.name.toLowerCase() === id.toLowerCase());
        return a ? { name: a.name, status: this.consulting(a) ? 'working' : a.status } : null;
      },
      preview: (floor) => {
        const f = rt(floor);
        return f ? this.previews.view(f.repo).status : null;
      },
      usage: () => this.usageNow().state,
    };
  }

  /** wait_for: hold the CEO's job until any condition holds, or the timeout. An issue that leaves the open list has closed. */
  protected waitFor(x: { conditions: WaitCondition[]; timeout_min?: number }) {
    const w = this.waitWorld();
    for (const c of x.conditions) {
      const problem = waitProblem(c, w);
      if (problem) throw new Error(problem);
    }
    this.ceoWaited = true;
    const live = (): WaitWorld => {
      const now = this.waitWorld();
      return { ...now, issue: (f, n) => now.issue(f, n) ?? 'CLOSED' };
    };
    return this.holds.wait(x.conditions.map(waitLabel).join(' or '), () => anyMet(x.conditions, live()), waitMs(x.timeout_min, this.state.settings.ceoAwake.maxWaitMin));
  }

  /** ask_manager: the question on the manager's phone (with suggestion chips), held until they answer. */
  protected askManager(x: { question: string; suggestions?: string[]; timeout_min?: number }) {
    const chips = x.suggestions?.length ? `\n\`\`\`suggestions\n${x.suggestions.join('\n')}\n\`\`\`` : '';
    const m = this.postMessage('ceo', `${x.question}${chips}`);
    this.markDelivery('all', 'replied');
    this.ceoWaited = true;
    const min = Math.max(1, Math.min(ASK_MAX_MIN, x.timeout_min ?? ASK_DEFAULT_MIN));
    return this.holds.ask({ id: `q${m.id}`, messageId: m.id, text: x.question, at: Date.now(), waiting: true }, min * 60_000);
  }

  /** consult: a question for an agent on a floor, queued for a free one (or the one named) and waited for. */
  protected consult(x: { floor: number; agent_id?: string; question: string; hint?: string }) {
    const repo = this.floorRepo(x.floor);
    const named = x.agent_id ? this.agentByRef(x.agent_id) : null;
    if (named && (named.repoId !== repo.id || named.role === 'ceo')) throw new Error(`${named.name} doesn't work on floor ${repo.floor}.`);
    if (named?.host === 'box') throw new Error(`${named.name} works in a cloud machine: consult a local agent on floor ${repo.floor}.`);
    if (!named && !this.state.agents.some((a) => a.repoId === repo.id && a.role !== 'ceo' && a.host !== 'box')) throw new Error(`Floor ${repo.floor} has no local agents to consult.`);
    const awake = this.state.settings.ceoAwake;
    const c: Consult = { id: crypto.randomUUID(), repoId: repo.id, floor: repo.floor, agentId: named?.id ?? null, question: x.question, hint: x.hint?.trim() || null, at: Date.now(), runningOn: null, startedAt: null, dir: null };
    this.consults.push(c);
    this.consultAnswers.set(c.id, null);
    this.appendLog(this.ceo(), [{ kind: 'system', text: `🔎 Consult queued: ${named ? named.name : `any free agent on floor ${repo.floor}`}` }]);
    setTimeout(() => this.schedule(), 100);
    // Queued behind QA and fixes, then its own time cap: the wait allows for both.
    return this.holds
      .wait(`${named ? named.name : `floor ${repo.floor}`}'s answer`, () => this.consultAnswers.get(c.id) ?? null, (awake.consultMin + 15) * 60_000)
      .finally(() => {
        this.consultAnswers.delete(c.id); // no one waits on it any more
        if (!c.runningOn) this.consults = this.consults.filter((q) => q !== c);
      });
  }
}
