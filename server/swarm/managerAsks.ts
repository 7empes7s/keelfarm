// The CEO does what the manager tells it in chat (#403): the triage tools, and the console's own actions as CEO tools
// (server/ceoAskTools.ts), each refused unless the manager's message in this job asks for it (asked_in; rules in
// server/managerAsks.ts). Each call becomes an action card naming that message, with Undo where the console has one.
import type { CharterProposalArgs } from '../charterTool.ts';
import type { AskHandlers } from '../ceoAskTools.ts';
import { HttpError } from '../httpError.ts';
import { issuesResolvedBy } from '../issueClaims.ts';
import { askedInRefusal, liveStandardsRefusal, neverAllowed } from '../managerAsks.ts';
import { failedRunIds } from '../mergeGate.ts';
import { freshRetry } from '../qaOutcome.ts';
import { checkTriageTarget, triageStep } from '../triage.ts';
import { charterOf, cleanCharter, type Charter } from '../../shared/charter.ts';
import type { ActionUndo } from '../../shared/ceoActions.ts';
import { modelProblem } from '../../shared/models.ts';
import type { PracticeOverrides } from '../../shared/practices.ts';
import type { PersistedRepo } from './model.ts';
import { SwarmTeam } from './team.ts';

type Asked = { asked_in?: number };
type Args<K extends keyof AskHandlers> = Parameters<AskHandlers[K]>[0];

export abstract class SwarmManagerAsks extends SwarmTeam {
  /** A manager-only call: refused unless asked_in names the manager's recent message in this job, and never for what stays theirs. */
  protected checkAsked(a: Asked, scan: unknown = a) {
    const why = askedInRefusal({ askedIn: a.asked_in, heard: this.ceoHeard, messages: this.state.messages, now: Date.now() }) ?? neverAllowed(scan);
    if (why) throw new HttpError(403, why);
  }

  /** The card's Undo, and the open questions the call answered close (#208). */
  private askedDone(repoId: string | null, done: string, undo?: ActionUndo) {
    if (undo) this.ceoChat.noteUndo(undo);
    this.decisionActedOn({ repoId: repoId ?? '', about: [], text: done, done });
    return `${done[0].toUpperCase()}${done.slice(1)}.`;
  }

  /** POST /api/ceo/messages/:id/actions/:index/undo: a card's Undo, which puts back what the CEO's call changed. */
  undoCeoAction(messageId: number, index: number) {
    const m = this.state.messages.find((x) => x.id === messageId);
    const act = m?.actions?.[index];
    if (!m || !act?.undo) throw new HttpError(404, 'That action has nothing to undo.');
    if (act.undone) throw new HttpError(409, 'That action is undone already.');
    const u = act.undo;
    if (u.kind === 'floor') this.updateRepo(u.repoId, u.patch);
    else this.lab.act(u.id, u.action);
    act.undone = true;
    this.broadcast({ type: 'ceoChat', message: m });
    this.save();
    return { ok: true };
  }

  // ---------- the triage tools (in a triage job, or when the manager asks) ----------

  /** The PR a triage tool names: the triage job's stuck PR, or with asked_in any open PR the manager's message asks about. */
  protected async triageTarget(x: { floor: number; pr: number; note?: string; comment?: string } & Asked) {
    if (x.asked_in !== undefined) this.checkAsked(x);
    const job = this.state.ceo.job;
    const jobFloor = x.asked_in !== undefined ? x.floor : job?.kind === 'triage' ? (this.state.repos.find((r) => r.id === job.repoId)?.floor ?? null) : null;
    const repo = this.state.repos.find((r) => r.floor === x.floor);
    const pr = Number(x.pr);
    const listed = repo ? this.repoRt.get(repo.id)?.pulls.find((p) => p.number === pr) : undefined;
    // The last sync may be a minute old and doesn't list closed PRs: ask GitHub about this one.
    const pull = repo && x.floor === jobFloor ? await this.backend.prDetails(repo.fullName, pr).catch(() => listed) : listed;
    const rec = repo ? this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === pr) : undefined;
    checkTriageTarget({ jobFloor, floor: x.floor, pr, pull, status: rec?.status, asked: x.asked_in !== undefined });
    return { repo: repo!, rec, listed };
  }

  protected async triageRetryQa(x: { floor: number; pr: number } & Asked) {
    const { repo, rec } = await this.triageTarget(x);
    const fresh = rec ? freshRetry(rec) : {}; // at the round cap: a full fresh test, a new session and a new report (#403)
    await this.sendToQa(repo.id, Number(x.pr), undefined, true);
    if (rec && Object.keys(fresh).length) this.setQa(rec, fresh);
    const now = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === Number(x.pr));
    return `PR #${x.pr} is queued for QA round ${now?.round ?? 1}.`;
  }

  protected async triageSendBack(x: { floor: number; pr: number; note: string } & Asked) {
    const { repo } = await this.triageTarget(x);
    const note = String(x.note ?? '').trim();
    if (!note) throw new HttpError(400, 'Say what the developer should do: the note goes with the fix.');
    await this.sendBackToDev(repo.id, Number(x.pr), note, `${this.ceo().name}, the CEO`);
    return `PR #${x.pr} goes back to a developer with QA's findings and your note.`;
  }

  protected async triageRerunChecks(x: { floor: number; pr: number } & Asked) {
    const { repo, rec, listed } = await this.triageTarget(x);
    const runIds = failedRunIds(listed?.failedChecks ?? []);
    if (!listed || !runIds.length) {
      const failed = listed?.failedChecks.map((c) => c.name) ?? [];
      throw new HttpError(409, `PR #${x.pr} has no failed GitHub Actions runs to re-run${failed.length ? ` (${failed.join(', ')} can't be re-run from here)` : ''}.`);
    }
    await this.backend.rerunFailedJobs(repo.fullName, runIds);
    const runs = `${runIds.length} failed run${runIds.length === 1 ? '' : 's'}`;
    if (rec?.passedSha && rec.passedSha === listed.headSha) {
      // QA signed off on this commit: the merge gate waits for the re-run and merges if it goes green.
      this.setQa(rec, { status: 'passed', rerunSha: listed.headSha, rerunAt: Date.now(), pendingSince: null, mergeNote: 're-running a failed check' });
      return `Re-running ${runs} on PR #${x.pr}. QA passed this commit, so it merges if they go green.`;
    }
    if (rec?.status === 'testing' || rec?.status === 'fixing') return `Re-running ${runs} on PR #${x.pr}; it is ${rec.status} already.`;
    await this.sendToQa(repo.id, Number(x.pr), undefined, true);
    return `Re-running ${runs} on PR #${x.pr}, and it is queued for QA round ${rec?.round ?? 1}.`;
  }

  protected async triageClosePull(x: { floor: number; pr: number; comment: string } & Asked) {
    const { repo, listed } = await this.triageTarget(x);
    const n = Number(x.pr);
    const comment = String(x.comment ?? '').trim();
    if (!comment) throw new HttpError(400, 'Say why the pull request is closing: the comment is posted on it.');
    const issues = listed ? issuesResolvedBy(listed) : [];
    const ceo = this.ceo().name;
    const why = x.asked_in !== undefined ? `as ${this.managerLabel()} asked` : 'after triage';
    await this.backend.commentPull(repo.fullName, n, `${comment}\n\n<sub>Closed by ${ceo}, the cubefarm CEO, ${why}.${issues.length ? ' Its issue stays open, so it is built again.' : ''}</sub>`);
    // Closing deletes no branch and leaves the issue open, so the scheduler hands it out again.
    await this.backend.closePull(repo.fullName, n);
    this.postMessage('office', `🗂️ ${ceo} closed PR #${n} on floor ${repo.floor}: ${comment.split('\n')[0].slice(0, 200)}`);
    this.dropRecord(repo, n);
    this.learnPull(repo, { number: n, headRefName: listed?.headRefName ?? '', closesIssues: listed?.closesIssues ?? [] }, 'CLOSED', true); // built again
    void this.syncRepo(repo.id);
    return `Closed PR #${n}.${issues.length ? ` ${issues.map((i) => `#${i}`).join(', ')} stay${issues.length === 1 ? 's' : ''} open, so a developer builds it again.` : ''}`;
  }

  protected async triageEscalate(x: { floor: number; pr: number; reason: string }) {
    const { rec } = await this.triageTarget(x);
    const step = triageStep({ kind: 'escalate', reason: String(x.reason ?? '').split('\n')[0].slice(0, 300) });
    if (rec && step.do === 'escalate') this.escalate(rec, step.note && `${this.ceo().name}: ${step.note}`);
    return `The manager has PR #${x.pr} now, with your diagnosis.`;
  }

  // ---------- the console's actions, when the manager asks ----------

  protected askRunExperiment(a: Args<'runExperiment'>) {
    this.checkAsked(a);
    const e = this.lab.byRef(a.experiment);
    this.lab.act(e.id, a.action, a.action === 'promote' ? (a.variant ?? null) : undefined);
    const undo: ActionUndo | undefined = a.action === 'promote' ? undefined : { kind: 'experiment', id: e.id, action: a.action === 'start' ? 'stop' : 'start' };
    const done = a.action === 'promote' ? (a.variant ? `promoted ${a.variant.toUpperCase()} of "${e.name}"` : `promoted no variant of "${e.name}"`) : `${a.action === 'start' ? 'started' : 'stopped'} "${e.name}"`;
    return this.askedDone(null, done, undo);
  }

  protected askFloorSwitches(a: Args<'setFloorSwitches'>) {
    this.checkAsked(a);
    const repo = this.floorRepo(a.floor);
    const practices = a.practices && Object.keys(a.practices).length ? a.practices : undefined;
    if (a.auto_assign === undefined && a.auto_merge === undefined && !practices) throw new HttpError(400, 'Nothing to change: pass auto_assign, auto_merge, practices or a mix.');
    const was: PracticeOverrides = repo.practices ?? {};
    const undo = {
      ...(a.auto_assign !== undefined && { autoAssign: repo.autoAssign }),
      ...(a.auto_merge !== undefined && { autoMerge: repo.autoMerge }),
      ...(practices && { practices: Object.fromEntries(Object.keys(practices).map((k) => [k, was[k as keyof PracticeOverrides] ?? null])) }),
    };
    this.updateRepo(repo.id, { ...(a.auto_assign !== undefined && { autoAssign: a.auto_assign }), ...(a.auto_merge !== undefined && { autoMerge: a.auto_merge }), ...(practices && { practices }) });
    const words = [a.auto_assign !== undefined && `auto-assign ${a.auto_assign ? 'on' : 'off'}`, a.auto_merge !== undefined && `auto-merge ${a.auto_merge ? 'on' : 'off'}`, ...Object.entries(practices ?? {}).map(([k, v]) => `${k} ${typeof v === 'boolean' ? (v ? 'on' : 'off') : JSON.stringify(v)}`)].filter(Boolean);
    return this.askedDone(repo.id, `set floor ${repo.floor}: ${words.join(', ')}`, { kind: 'floor', repoId: repo.id, patch: undo });
  }

  protected async askIssuePriority(a: Args<'setIssuePriority'>) {
    this.checkAsked(a);
    const repo = this.floorRepo(a.floor);
    const n = Number(a.number);
    if (a.priority === undefined && a.parked === undefined) throw new HttpError(400, 'Nothing to change: pass priority, parked or both.');
    if (!this.repoRt.get(repo.id)?.issues.some((i) => i.number === n)) throw new HttpError(404, `There is no open issue #${n} on floor ${repo.floor}.`);
    const add: string[] = [];
    const remove: string[] = [];
    if (a.priority !== undefined) (a.priority ? add : remove).push('priority');
    if (a.parked !== undefined) (a.parked ? add : remove).push('swarm:skip');
    await this.backend.editIssue(repo.fullName, n, { addLabels: add, removeLabels: remove });
    void this.syncRepo(repo.id);
    const words = [a.priority !== undefined && (a.priority ? 'a priority' : 'no longer a priority'), a.parked !== undefined && (a.parked ? 'parked' : 'unparked')].filter(Boolean);
    return this.askedDone(repo.id, `#${n} on floor ${repo.floor} is ${words.join(' and ')}`);
  }

  protected askCeoSetup(a: Args<'setCeoSetup'>) {
    this.checkAsked(a);
    if (a.account === undefined && a.model === undefined && a.effort === undefined) throw new HttpError(400, 'Nothing to change: pass account, model, effort or a mix.');
    const ceo = this.ceo();
    const bad = a.model ? modelProblem(a.model, this.ceoCliOf(ceo), this.models) : null;
    if (bad) throw new HttpError(400, bad);
    this.updateAgent(ceo.id, { ...(a.model !== undefined && { model: a.model }), ...(a.effort !== undefined && { effort: a.effort }), ...(a.account !== undefined && { account: a.account }) });
    const words = [a.model !== undefined && `model ${a.model || 'the default'}`, a.effort !== undefined && `effort ${a.effort || 'the default'}`, a.account !== undefined && `account ${ceo.account ?? 'the rotation'}`].filter(Boolean);
    return this.askedDone(null, `${ceo.name} runs on ${words.join(', ')} from the next job`);
  }

  /** A charter from propose_charter's or apply_charter's arguments: parts left out stay as they are. */
  protected charterFrom(repo: PersistedRepo, x: CharterProposalArgs): { now: Charter; charter: Charter } {
    const now = charterOf(repo.mission, repo.charter);
    const charter = cleanCharter({ mission: x.mission ?? now.mission, focus: x.focus ?? now.focus, objectives: x.objectives ?? now.objectives, standards: x.standards ?? now.standards, nonGoals: x.non_goals ?? now.nonGoals });
    return { now, charter };
  }

  protected askApplyCharter(a: Args<'applyCharter'>) {
    this.checkAsked(a, { reason: a.reason }); // its standards may quote the live office's: those must stay (liveStandardsRefusal)
    const repo = this.floorRepo(a.floor);
    const { now, charter } = this.charterFrom(repo, a);
    if (JSON.stringify(charter) === JSON.stringify(now)) throw new HttpError(409, `That is floor ${repo.floor}'s charter already: nothing to change.`);
    const kept = liveStandardsRefusal(now.standards, charter.standards);
    if (kept) throw new HttpError(403, kept);
    this.applyCharter(repo, charter, `${this.ceo().name}, as ${this.managerLabel()} asked`, String(a.reason ?? '').trim());
    this.save();
    this.emitRepo(repo);
    return this.askedDone(repo.id, `changed floor ${repo.floor}'s charter`);
  }

  protected async askMergePull(a: Args<'mergePull'>) {
    this.checkAsked(a);
    const repo = this.floorRepo(a.floor);
    const n = Number(a.pr);
    const rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === n);
    if (rec?.status !== 'passed') throw new HttpError(409, `PR #${n} hasn't passed QA (it is ${rec?.status ?? 'not in QA'}). Only the manager merges without QA, from its card.`);
    await this.mergePull(repo.id, n);
    return this.askedDone(repo.id, `merged PR #${n} on floor ${repo.floor}`);
  }

  /** apply_update (#600): the manager's Update now, through the drain and the launcher's preflight and probation. */
  protected askApplyUpdate(a: Args<'applyUpdate'>) {
    this.checkAsked(a);
    const v = this.updateOffice('now');
    const n = `${v.behind} commit${v.behind === 1 ? '' : 's'}`;
    return this.askedDone(null, `started the office's update (${n}): ${v.wait?.text ?? 'the preflight runs, then the office restarts for a few seconds and is watched on probation'}`);
  }
}
