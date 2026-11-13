// Auto-merge, folder syncs after merges, and what the office does when issues and PRs close.
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  afterClose,
  ASK_AGAIN_MS,
  closedWhy,
  closuresHeld,
  forgettable,
  issueOpen,
  pullNow,
  stoppedMessage,
  toAsk,
  toHold,
  type Closure,
  type FloorState,
  type KnownPull,
  type LearnedPull,
} from '../closeCleanup.ts';
import { issuesResolvedBy } from '../issueClaims.ts';
import { CHECKS_ALERT_MS, failedRunIds, MAX_MERGE_FIXES, MERGE_RETRY_MS, mergeStep, NEVER_STARTED, OUTAGE_PROBE_MS, outageReason, outageRerun, parkedState, type ParkedPull } from '../mergeGate.ts';
import { PREVIEW_SLUG } from '../previewRunner.ts';
import { LAB_SLUG } from '../testLabRunner.ts';
import { rebaseHandOffs } from '../../shared/practices.ts';
import { clampStuckRecheckMin, stuckRecheck } from '../stuckRecheck.ts';
import { recordWait } from '../metrics.ts';
import { mergeOrder } from '../../shared/conflicts.ts';
import { spared } from '../../shared/managerChanges.ts';
import { qaShotsDir, removeQaShots } from '../qaShots.ts';
import { pullSkip } from '../../shared/officePulls.ts';
import type { LogLine, PullInfo } from '../../shared/types.ts';
import {
  type PersistedRepo,
  type PersistedAgent,
  type QaRecord,
  type RepoRuntime,
  BUSY,
  oneLine,
  QA_SHOTS_DIR,
} from './model.ts';
import { SwarmRepos } from './repos.ts';

export abstract class SwarmMerge extends SwarmRepos {
  // ---------- auto-merge ----------

  /**
   * Auto-merge (floors with it on): a PR the office owns (#632) merges itself once QA has signed off on its latest commit and GitHub's
   * checks are green. Failing checks and merge conflicts go back to a developer; new commits after QA's sign-off send
   * it back to QA. Merging deletes the remote branch, and the floor's folder then fast-forwards (syncRepo sees the merge).
   */
  protected async advanceMerges(repo: PersistedRepo) {
    const rt = this.repoRt.get(repo.id);
    if (!rt || !repo.autoMerge || rt.merging) return;
    rt.merging = true;
    let merged = false;
    try {
      await this.outageReruns(repo, rt);
      for (const rec of this.mergeQueue(repo, rt)) {
        if (merged && this.busyWanted(repo)) break; // #256: one merge per pass, so the sync that follows hands the PRs it conflicts with to a developer first
        const pr = rt.pulls.find((p) => p.number === rec.prNumber && p.state === 'OPEN');
        const skip = pr && pullSkip(pr, !!repo.leaveOwnPrs);
        if (!pr || (skip && skip !== 'draft')) continue; // outsiders' (#185), `manual` ones and, on request, the manager's own (#632); mergeStep waits out a draft
        // Only act on PR data fetched after the record last changed (a fix may have just pushed).
        if ((rt.fetchedAt ?? 0) < rec.updatedAt) continue;
        try {
          if (await this.advanceMerge(repo, rec, pr)) merged = true;
        } catch (err) {
          console.warn(`auto-merge of ${repo.fullName}#${pr.number} failed`, err);
          this.mergeNote(rec, `auto-merge hit a problem: ${oneLine(err)}`);
        }
      }
    } finally {
      rt.merging = false;
    }
    if (merged) {
      await this.syncRepo(repo.id);
      setTimeout(() => this.schedule(), 200);
    }
  }

  /** Whether any of the floor's work may run with conflict-aware scheduling (#256): the floor's switch, or a running experiment's variant. */
  protected busyWanted(r: PersistedRepo) {
    return this.practicesOf(r).busyFiles || this.lab.tries(r.id, 'busyFiles');
  }

  /**
   * The QA-passed PRs in the order they try to merge: as they come, unless conflict-aware scheduling (#256) is wanted on
   * the floor, when the one touching the most hot files goes first (shared/conflicts.ts mergeOrder).
   */
  protected mergeQueue(repo: PersistedRepo, rt: RepoRuntime) {
    const passed = this.state.qa.filter((q) => q.repoId === repo.id && q.status === 'passed' && q.ciOutage == null);
    if (passed.length < 2 || !this.busyWanted(repo)) return passed;
    const fp = this.floorPractice(repo.id);
    const files = (n: number) => fp.prFiles.get(n)?.files ?? [];
    const open = rt.pulls.filter((p) => p.state === 'OPEN' && p.headRefName.startsWith('swarm/')).map((p) => ({ number: p.number, files: files(p.number) }));
    const order = mergeOrder(passed.map((q) => ({ number: q.prNumber, files: files(q.prNumber) })), fp.hot.map((h) => h.path), open);
    return order.map((n) => passed.find((q) => q.prNumber === n)!);
  }

  /** One step toward merging a QA-passed PR. Returns true when it merged. */
  protected async advanceMerge(repo: PersistedRepo, rec: QaRecord, pr: PullInfo): Promise<boolean> {
    const upToDate = this.practicesOf(repo, rec.issueNumber, rec.prNumber).upToDate; // #24: merge only what CI saw with the base in
    const opts = { base: repo.defaultBranch, upToDate };
    let step = mergeStep(pr, rec, Date.now(), opts);
    if (step.do === 'details') {
      // GitHub works mergeability out lazily and lists often say UNKNOWN; asking about the PR itself gets an answer.
      const d = await this.backend.prDetails(repo.fullName, pr.number);
      pr = { ...pr, headSha: d.headSha, mergeable: d.mergeable, mergeState: d.mergeState };
      step = mergeStep(pr, rec, Date.now(), { ...opts, detailed: true });
    }
    if (step.do === 'behind') {
      const behind = await this.backend.behindBy(repo.fullName, repo.defaultBranch, pr.headSha);
      step = mergeStep(pr, rec, Date.now(), { ...opts, detailed: true, behind });
    }
    if (step.do === 'send-back' && step.reason === 'checks') {
      // Before a fix is spent: GitHub may have said it wouldn't run the jobs at all (billing, spending limit, #191).
      const outage = outageReason(await this.backend.checkAnnotations(repo.fullName, pr.failedChecks.flatMap((c) => c.url ?? [])).catch(() => []));
      if (outage) step = mergeStep(pr, rec, Date.now(), { ...opts, detailed: true, outage });
    }
    Object.assign(rec, step.set);
    if (step.do === 'outage') return this.park(repo, rec, pr, step.reason);
    if (step.do === 'requeue') {
      // Commits arrived after QA's sign-off: they get tested too.
      this.setQa(rec, { status: 'queued', round: rec.round + 1, retests: rec.retests + 1, mergeNote: null, pendingSince: null });
      setTimeout(() => this.schedule(), 200);
      return false;
    }
    if (step.do === 'rerun') {
      // A red check may be a flake or an outage: re-run it once for this commit before a developer is sent to fix it.
      try {
        await this.backend.rerunFailedJobs(repo.fullName, step.runIds);
      } catch (err) {
        console.warn(`could not re-run the failed checks of ${repo.fullName}#${pr.number}`, err);
        return this.sendBack(repo, rec, step.reason, step.instructions, step.needsHuman);
      }
      this.setQa(rec, { rerunSha: pr.headSha, rerunAt: Date.now(), pendingSince: null, alerted: false, mergeNote: 're-running a failed check' });
      return false;
    }
    if (step.do === 'send-back') return this.sendBack(repo, rec, step.reason, step.instructions, step.needsHuman, step.counts);
    if (step.do === 'wait') {
      if (step.alert) {
        this.postMessage('office', `⏳ PR #${pr.number} on ${repo.fullName} passed QA, but its checks (${pr.pendingChecks.join(', ')}) have been running for over ${CHECKS_ALERT_MS / 60_000} minutes. It merges as soon as they finish.`);
      }
      return step.note === undefined ? false : this.mergeNote(rec, step.note);
    }
    if (step.do === 'update-branch') {
      // The repo only merges up-to-date branches (or the floor wants it, #24). GitHub merges the base in cleanly (or
      // refuses); CI checks the result, and that exact result is what merges.
      this.mergeNote(rec, `updating the branch with ${repo.defaultBranch}`);
      try {
        await this.backend.updateBranch(repo.fullName, pr.number);
      } catch (err) {
        if (!upToDate) throw err;
        return this.sendBack(repo, rec, 'conflict', `It conflicts with ${repo.defaultBranch}: GitHub couldn't merge ${repo.defaultBranch} into it (${oneLine(err)}).`, false);
      }
      const details = await this.backend.prDetails(repo.fullName, pr.number);
      this.setQa(rec, { passedSha: details.headSha, ...(upToDate ? { updatedSha: details.headSha, mergeNote: `brought up to date with ${repo.defaultBranch}: waiting for CI on the result` } : {}) });
      return false;
    }
    if (step.do !== 'merge') return false;
    this.mergeNote(rec, 'merging…');
    let error = '';
    for (const method of ['squash', 'merge', 'rebase'] as const) {
      try {
        await this.backend.mergePull(repo.fullName, pr.number, method, rec.passedSha ?? pr.headSha);
        error = '';
        break;
      } catch (err) {
        error = oneLine(err).replace(/^gh .*? failed: /, '');
        if (!/not allowed/i.test(error)) break; // only a merge method the repo turned off is worth another try
      }
    }
    if (error && /head (branch|commit)/i.test(error)) return this.mergeNote(rec, 'new commits arrived; QA checks them first'); // the next sync re-queues it
    if (error) {
      rec.mergeRetryAt = Date.now() + MERGE_RETRY_MS;
      if (!rec.alerted) {
        rec.alerted = true;
        this.postMessage('office', `⚠️ PR #${pr.number} on ${repo.fullName} passed QA and its checks, but GitHub won't merge it: ${error}. The office retries every ${MERGE_RETRY_MS / 60_000} minutes; merge it yourself, or change the repo's merge rules, if it keeps failing.`);
      }
      return this.mergeNote(rec, `merge blocked: ${error}`);
    }
    this.notifyMerge(repo, pr.number, pr.title);
    this.logMerge(repo, pr.number, pr.title);
    await this.closeResolvedIssues(repo, pr.number, pr);
    return true;
  }

  /**
   * After the office merges a PR: close the issues it resolves now rather than waiting for GitHub's "Closes #N" (which
   * lags, and never comes when the link wasn't recognised), so the scheduler doesn't hand them out again. Never throws.
   */
  protected async closeResolvedIssues(repo: PersistedRepo, prNumber: number, pr: Pick<PullInfo, 'headRefName' | 'closesIssues'>) {
    const numbers = issuesResolvedBy(pr);
    const rt = this.repoRt.get(repo.id);
    if (rt && rt.issues.some((i) => numbers.includes(i.number))) {
      rt.issues = rt.issues.filter((i) => !numbers.includes(i.number));
      this.emitRepo(repo);
    }
    // A merge is the normal end: whoever only remembers the PR or its issues is cleared, and nobody's session stops.
    if (rt) {
      for (const n of numbers) rt.closedIssues.set(n, Date.now());
      this.learnPull(repo, { number: prNumber, headRefName: pr.headRefName, closesIssues: pr.closesIssues }, 'MERGED');
    }
    for (const n of numbers) {
      try {
        if ((await this.backend.issueState(repo.fullName, n)) !== 'OPEN') continue;
        await this.backend.closeIssue(repo.fullName, n, `Shipped in #${prNumber}`);
      } catch (err) {
        console.warn(`could not close ${repo.fullName}#${n} after merging #${prNumber}`, err);
      }
    }
  }

  // ---------- CI outages (#191) ----------

  /** GitHub didn't run a QA-passed PR's checks: it waits for CI with the floor's other parked PRs, without a fix or the manager. */
  protected async park(repo: PersistedRepo, rec: QaRecord, pr: PullInfo, reason: string) {
    const now = Date.now();
    if (!repo.ciOutage) {
      if (reason === NEVER_STARTED) reason = outageReason(await this.backend.checkAnnotations(repo.fullName, pr.failedChecks.flatMap((c) => c.url ?? [])).catch(() => [])) ?? reason;
      repo.ciOutage = { reason, since: now, probeAt: now, back: null };
      this.autoTicket({ kind: 'ci', repo: repo.fullName, reason });
      this.postMessage('office', `🛑 CI can't run on ${repo.fullName}: ${reason}. PRs that passed QA wait for it instead of going back for fixes; the office re-runs one every ${OUTAGE_PROBE_MS / 60_000} minutes and merges them by itself once CI runs again. One question: is CI off on purpose? If not, fix it on GitHub (billing, spending limit or Actions settings); nothing else needs you.`);
    }
    rec.ciOutage = now;
    this.emitRepo(repo);
    this.save();
    return this.mergeNote(rec, `waiting for CI to run again: ${repo.ciOutage.reason}`);
  }

  /**
   * A floor's CI outage, each merge pass: parked PRs whose checks really started go back to the merge gate; one of the
   * rest is re-run when due (outageRerun); the banner goes once none is parked.
   */
  protected async outageReruns(repo: PersistedRepo, rt: RepoRuntime) {
    const out = repo.ciOutage;
    if (!out) return;
    const now = Date.now();
    const before = JSON.stringify(out);
    let changed = false;
    const parked: ParkedPull[] = [];
    for (const q of this.state.qa.filter((x) => x.repoId === repo.id && x.ciOutage != null)) {
      const pr = rt.pulls.find((p) => p.number === q.prNumber && p.state === 'OPEN');
      const state = pr && q.status === 'passed' ? parkedState(pr, q, now) : 'gone';
      if (state === 'down' || state === 'rerunning') {
        parked.push({ prNumber: q.prNumber, parkedAt: q.ciOutage!, rerunAt: q.rerunAt, state });
        continue;
      }
      if (state === 'started') out.back = now; // CI runs again: the next re-run needn't wait for a probe
      q.ciOutage = null;
      changed = true;
      this.mergeNote(q, null);
    }
    if (!parked.length) {
      repo.ciOutage = null;
      changed = true;
      if (out.back != null) this.toast('success', `✅ CI runs again on ${repo.fullName}`);
    } else {
      const { rerun, back } = outageRerun(parked, out, now);
      out.back = back;
      const rec = rerun == null ? undefined : this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === rerun);
      const pr = rt.pulls.find((p) => p.number === rerun);
      if (rec && pr) {
        out.probeAt = now;
        try {
          await this.backend.rerunFailedJobs(repo.fullName, failedRunIds(pr.failedChecks));
        } catch (err) {
          console.warn(`could not re-run the checks of ${repo.fullName}#${pr.number} in a CI outage`, err);
        }
        Object.assign(rec, { rerunSha: pr.headSha, rerunAt: now });
        this.mergeNote(rec, back == null ? 're-running its checks: is CI back?' : 'CI is back: re-running its checks');
      }
    }
    if (changed) this.emitRepo(repo);
    if (changed || JSON.stringify(out) !== before) this.save();
  }

  /** Show where auto-merge stands on a PR's card. Doesn't count as a change to the record. */
  protected mergeNote(rec: QaRecord, text: string | null) {
    if (rec.mergeNote !== text) {
      rec.mergeNote = text;
      this.broadcast({ type: 'qa', qa: this.qaView(rec) });
    }
    return false;
  }

  /**
   * QA passed, but the PR can't merge as it is: a developer fixes it, and QA re-tests if the code changed. counts: it
   * uses one of MAX_MERGE_FIXES (bringing finished work up to date with the base doesn't, #275).
   */
  protected sendBack(repo: PersistedRepo, rec: QaRecord, reason: 'checks' | 'conflict', fixInstructions: string, needsHuman: boolean, counts = reason === 'checks') {
    if (needsHuman) {
      this.stuck(rec, { mergeNote: null }, `it still fails its checks${reason === 'conflict' ? ` with ${repo.defaultBranch} merged in` : ''} after ${MAX_MERGE_FIXES} fixes`);
      return false;
    }
    this.setQa(rec, { status: 'failed', fixReason: reason, fixInstructions, mergeFixes: rec.mergeFixes + (counts ? 1 : 0), mergeNote: null, pendingSince: null });
    setTimeout(() => this.schedule(), 200);
    return false;
  }

  /**
   * Auto-rebase (#24, floors or variants with it on): after a sync, a swarm PR waiting for QA or its merge that
   * conflicts with the base now goes to its developer (or the next free one) to bring it up to date, before a tester
   * or the merge gate spends anything on it.
   */
  protected rebaseConflicting(repo: PersistedRepo) {
    const rt = this.repoRt.get(repo.id);
    if (!rt) return;
    const records = this.state.qa.filter((q) => {
      if (q.repoId !== repo.id || (rt.fetchedAt ?? 0) < q.updatedAt) return false;
      const p = this.practicesOf(repo, q.issueNumber, q.prNumber);
      return p.autoRebase || p.busyFiles; // conflict-aware scheduling refreshes them too (#256)
    });
    for (const n of rebaseHandOffs(rt.pulls, records, true)) {
      const rec = records.find((q) => q.prNumber === n)!;
      const pr = rt.pulls.find((p) => p.number === n)!;
      const why = `${repo.defaultBranch} moved and PR #${n} conflicts with it now: bring it up to date (git fetch origin && git merge origin/${repo.defaultBranch}), resolve the conflicts so both changes keep working, and push.`;
      this.toast('info', `🔁 PR #${n} conflicts with ${repo.defaultBranch}: a developer brings it up to date${rec.status === 'queued' ? ' before QA' : ''}`);
      if (rec.status === 'passed') {
        this.sendBack(repo, rec, 'conflict', why, false);
        continue;
      }
      // Waiting for QA: as when a tester finds the conflict (qaGate), QA's last findings stay for the test that follows.
      this.setQa(rec, { status: 'failed', qaAgentId: null, fixReason: 'conflict', preQa: { sha: pr.headSha, fixReason: rec.fixReason }, mergeNote: null });
      setTimeout(() => this.schedule(), 200);
    }
  }

  // ---------- needs-human re-checks (#275) ----------

  /**
   * After a sync: a PR in needs-human longer than Settings' re-check time (minAge) goes back into the flow if only a
   * conflict or a CI outage holds it, else the CEO triages it again (at most every RETRIAGE_MS). Returns the PRs released.
   */
  protected recheckStuck(repo: PersistedRepo, minAge = clampStuckRecheckMin(this.state.settings.stuckRecheckMin) * 60_000, retriage = true): number[] {
    const rt = this.repoRt.get(repo.id);
    if (!rt?.lastSync) return [];
    const now = Date.now();
    const released: number[] = [];
    for (const rec of this.state.qa.filter((q) => q.repoId === repo.id && q.status === 'needs-human')) {
      const step = stuckRecheck(rec, rt.pulls.find((p) => p.number === rec.prNumber), now, minAge);
      if (step === 'conflict') {
        const why = `It conflicts with ${repo.defaultBranch}: bring it up to date (git fetch origin && git merge origin/${repo.defaultBranch}), resolve the conflicts so both changes keep working, and push.`;
        this.setQa(rec, { status: 'failed', qaAgentId: null, fixReason: 'conflict', fixInstructions: why, sessionFailures: 0, stuckWhy: null, mergeNote: null, pendingSince: null });
        released.push(rec.prNumber);
      } else if (step === 'merge-gate') {
        this.setQa(rec, { status: 'passed', rerunSha: null, rerunAt: null, stuckWhy: null, mergeNote: null, pendingSince: null, mergeRetryAt: null, alerted: false });
        released.push(rec.prNumber);
      } else if (step === 'retriage' && retriage && !this.triageJob(rec)) {
        // Escalated before: the manager hears again only if the CEO escalates it again.
        Object.assign(rec, { recheckAt: now, escalated: false });
        this.enqueueCeo({ kind: 'triage', repoId: rec.repoId, prNumber: rec.prNumber, at: now });
        this.setQa(rec, {}); // the card shows the CEO looking
      }
    }
    if (released.length) {
      this.toast('info', `↩️ ${released.map((n) => `#${n}`).join(', ')} on ${repo.fullName} only waited on a conflict or CI: back into the flow`);
      setTimeout(() => this.schedule(), 200);
    }
    return released;
  }

  /** A PR leaving needs-human: how long it waited goes into mission control's trend (#275). */
  protected override setQa(rec: QaRecord, patch: Partial<QaRecord>) {
    const from = rec.status === 'needs-human' ? rec.stuckAt : null;
    super.setQa(rec, patch);
    if (from && rec.status !== 'needs-human' && this.state.qa.includes(rec)) recordWait(this.state.ops, rec.repoId, Date.now() - from, Date.now());
  }

  /** One-off (#275): every needs-human PR only a conflict or a CI outage holds goes back into the flow, whatever its age. */
  protected releaseStuck() {
    const back = this.state.repos.flatMap((r) => this.recheckStuck(r, 0, false).map((n) => `#${n} on ${r.fullName}`));
    this.state.stuckReleased = true;
    this.save();
    if (back.length) this.postMessage('office', `↩️ ${back.join(', ')} only waited on a conflict or CI, not on you: they're back with a developer or the merge gate, no need to look at them.`);
  }

  /** What leases read (#24): the files open swarm PRs change and the floor's hot files, when anything on the floor uses them. */
  protected async refreshPractices(repo: PersistedRepo) {
    const rt = this.repoRt.get(repo.id);
    if (!rt || !this.leasesWanted(repo)) return;
    const fp = this.floorPractice(repo.id);
    const files = await fp.refreshPrFiles(rt.pulls, (n) => this.backend.prDiff(repo.fullName, n, false).then((d) => d.files.map((f) => f.path)));
    const hot = await fp.refreshHot(() => this.backend.fileHistory(repo.fullName), Date.now());
    if ((files || hot) && this.repoRt.has(repo.id)) this.emitRepo(repo);
  }

  /** Fast-forward the floor's main checkout (usually your own project folder) and report how it stands. */
  protected async syncFolder(repo: PersistedRepo) {
    const rt = this.repoRt.get(repo.id);
    if (!rt || rt.cloneStatus !== 'ready') return rt?.folderSync ?? null;
    const own = this.backend.office.isOwnFolder(this.backend.mainDir(repo.fullName)); // updating the running office restarts it mid-work
    const sync = await this.backend.syncMain(repo.fullName, repo.defaultBranch, { touch: !own }).catch((err) => ({ status: `sync failed: ${oneLine(err)}`, behind: 0, updatable: false }));
    const status = sync?.status ?? null;
    if (own && sync) this.setOfficeBehind(sync.updatable ? sync.behind : 0);
    if (!this.repoRt.has(repo.id)) return null;
    const before = rt.folderSync;
    rt.folderSync = status;
    this.emitRepo(repo);
    if (status?.startsWith('updated')) void this.checkAudit(repo);
    if (status && status !== before) {
      const name = repo.localPath ? path.basename(repo.localPath) : repo.fullName;
      if (status.startsWith('updated')) this.toast('success', `📁 ${name}: ${status}`);
      else if (/behind|diverged|failed/.test(status)) this.toast('info', `📁 ${name} wasn't updated: ${status}`);
    }
    return status;
  }

  protected audits = new Map<string, number>(); // repo id -> docs/code-health.md's mtime when last seen

  /** A fast-forward brought a new code-health audit (docs/code-health.md): the CEO follows up on it. Never throws. */
  protected async checkAudit(repo: PersistedRepo) {
    const file = path.join(this.backend.mainDir(repo.fullName), 'docs', 'code-health.md');
    const mtime = await fs.stat(file).then((st) => st.mtimeMs, () => null);
    const seen = this.audits.get(repo.id);
    if (mtime === null) return;
    this.audits.set(repo.id, mtime);
    if (seen === mtime || (seen === undefined && Date.now() - mtime > 10 * 60_000)) return; // the update didn't bring it
    this.followup({ kind: 'audit', key: `audit:${repo.id}`, label: `floor ${repo.floor}'s audit`, text: `A code-health audit landed on ${this.floorName(repo)}: ${file}. Read it and decide what is worth acting on.`, repoId: repo.id });
  }

  /** The manager's "Sync now". */
  async syncFolderNow(repoId: string) {
    return { folderSync: await this.syncFolder(this.repo(repoId)) };
  }

  /** Remove the floor's desks, desk folders and swarm/qa branches nobody uses any more; say so when something went. */
  protected async sweepFloor(repoId: string) {
    const repo = this.state.repos.find((r) => r.id === repoId);
    const rt = this.repoRt.get(repoId);
    if (!repo || !rt || rt.cloneStatus !== 'ready') return;
    try {
      const pulls = rt.lastSync ? rt.pulls : await this.backend.listPulls(repo.fullName);
      const agents = this.state.agents.filter((a) => a.repoId === repo.id);
      const keep = {
        // Floor desks: the previews', and those of agents not on a machine yet. Old desks go once their agents moved.
        desks: [...agents.filter((a) => !a.machine).map((a) => this.agentSlug(a)), PREVIEW_SLUG, LAB_SLUG, ...this.previews.prSlugs(repo)],
        branches: [...agents.flatMap((a) => (a.branch ? [a.branch] : [])), ...pulls.filter((p) => p.state === 'OPEN').map((p) => p.headRefName)],
      };
      const r = await this.backend.sweepDesks(repo.fullName, keep);
      for (const a of agents) if (a.machine) r.branches += await this.machinesFor(a).sweep(a.machine, repo.fullName, keep.branches).catch(() => 0);
      const desks = r.desks + r.folders;
      const saved = r.patches.length ? ` (${r.patches.length} patch${r.patches.length === 1 ? '' : 'es'} saved to ${path.dirname(r.patches[0])})` : '';
      console.log(`desk sweep ${repo.fullName}: ${desks} desks, ${r.branches} branches removed${saved}${r.skipped.length ? `, ${r.skipped.length} still in use` : ''}`);
      if (!desks && !r.branches) return;
      const removed = [desks && `${desks} old desk${desks === 1 ? '' : 's'}`, r.branches && `${r.branches} finished branch${r.branches === 1 ? '' : 'es'}`].filter(Boolean).join(' and ');
      const text = `🧹 ${repo.fullName.split('/')[1]}: removed ${removed}${saved}`;
      this.toast('info', text);
      this.postMessage('office', text);
    } catch (err) {
      console.warn(`desk sweep ${repo.fullName} failed: ${oneLine(err)}`);
    }
  }

  // ---------- closed issues and PRs ----------

  /** The floor's issues and PRs as the office knows them now (closeCleanup.ts). */
  protected floorState(rt: RepoRuntime): FloorState {
    return { fetchedAt: rt.fetchedAt ?? 0, openIssues: rt.issues.map((i) => i.number), pulls: rt.pulls, closedIssues: rt.closedIssues, closedPulls: rt.closedPulls };
  }

  /** The floor's agents whose work a closure can end. One whose stopped session is still ending is left to finish. */
  protected holders(repo: PersistedRepo) {
    return this.state.agents.filter((a) => a.repoId === repo.id && !this.dropping.has(a.id));
  }

  /** Ask GitHub about the issues and PRs agents, QA records or holds hold that the last sync doesn't list. */
  protected async askGitHub(repo: PersistedRepo, rt: RepoRuntime) {
    const held = this.state.held.filter((h) => h.repoId === repo.id).map((h) => h.issue);
    const ask = toAsk(this.holders(repo), this.state.qa.filter((q) => q.repoId === repo.id), held, this.floorState(rt), rt.openAt, Date.now());
    await Promise.all([
      ...ask.issues.map(async (n) => {
        const state = await this.backend.issueState(repo.fullName, n).catch(() => null);
        if (state === 'CLOSED') rt.closedIssues.set(n, Date.now());
        else if (state === 'OPEN') rt.openAt.set(`issue#${n}`, Date.now());
      }),
      ...ask.pulls.map(async (n) => {
        const pr = await this.backend.prDetails(repo.fullName, n).catch(() => null);
        if (pr?.state === 'OPEN') rt.openAt.set(`pr#${n}`, Date.now());
        else if (pr) {
          rt.closedPulls.set(n, { number: n, state: pr.state, headRefName: pr.headRefName, closesIssues: pr.closesIssues, at: Date.now() });
          this.holdIssues(repo, rt.closedPulls.get(n)!);
        }
      }),
    ]);
  }

  /** After a sync: forget closures it shows reopened, and keep what it lists in step with closures learned since it started. */
  protected settleLearned(rt: RepoRuntime) {
    const gone = forgettable(this.floorState(rt), Date.now());
    for (const n of gone.issues) rt.closedIssues.delete(n);
    for (const n of gone.pulls) rt.closedPulls.delete(n);
    for (const [key, at] of rt.openAt) if (Date.now() - at > ASK_AGAIN_MS) rt.openAt.delete(key);
    const f = this.floorState(rt);
    rt.issues = rt.issues.filter((i) => issueOpen(i.number, f) !== false);
    rt.pulls = rt.pulls.map((p) => (p.state === 'OPEN' && pullNow(p.number, f)?.state === 'CLOSED' ? { ...p, state: 'CLOSED' as const } : p));
  }

  /** Stop and clear the work on the floor's closed issues and PRs (closeCleanup.ts). Returns the names of those it stopped. */
  protected cleanUpClosed(repo: PersistedRepo): string[] {
    const rt = this.repoRt.get(repo.id);
    if (!rt) return [];
    const f = this.floorState(rt);
    const gone = this.state.held.filter((h) => h.repoId === repo.id && issueOpen(h.issue, f) === false);
    if (gone.length) {
      this.state.held = this.state.held.filter((h) => !gone.includes(h));
      this.emitRepo(repo);
    }
    const closures = closuresHeld(this.holders(repo), this.state.qa.filter((q) => q.repoId === repo.id), f);
    // PR previews of PRs that merged or closed stop too, held by anyone or not; what the office learned first counts.
    // Not before the first sync: an empty list would read as every PR gone.
    if (rt.lastSync) this.previews.pullsChanged(repo, [...rt.pulls.filter((p) => !rt.closedPulls.has(p.number)), ...rt.closedPulls.values()]);
    return closures.flatMap((c) => this.applyClosure(repo, c));
  }

  protected applyClosure(repo: PersistedRepo, c: Closure): string[] {
    const plan = afterClose(c, this.holders(repo), this.state.qa.filter((q) => q.repoId === repo.id), BUSY, spared(this.state.ceo.changes.list, repo.id, c));
    const agent = (id: string) => this.state.agents.find((a) => a.id === id)!;
    const why = closedWhy(c);
    const stopped = plan.stop.map(agent);
    for (const a of stopped) this.stopForClosure(a, why);
    for (const a of plan.clear.map(agent)) {
      const merged = c.kind === 'pr' && c.merged;
      if (a.task === 'qa') this.dropTask(a, null); // they only tested it
      else this.dropTask(a, merged ? `🎉 PR #${c.number} was merged. Ready for the next issue.` : `↺ ${why[0].toUpperCase()}${why.slice(1)}. Cleared desk.`, merged ? 'done' : 'system');
    }
    if (plan.dropQa) this.dropRecord(repo, c.number);
    if (stopped.length) this.postMessage('office', stoppedMessage(stopped.map((a) => a.name), c, repo.fullName));
    if (stopped.length || plan.clear.length || plan.dropQa) {
      this.save();
      setTimeout(() => this.schedule(), 200);
    }
    return stopped.map((a) => a.name);
  }

  /** End a session whose issue or PR closed, as ■ Stop does. Its desk is cleared once the session has ended. */
  protected stopForClosure(a: PersistedAgent, why: string) {
    a.status = 'stopped';
    a.lastError = `Stopped: ${why}`;
    this.dropping.set(a.id, why);
    this.appendLog(a, [{ kind: 'system', text: `■ Stopped: ${why}.` }]);
    this.emitAgent(a);
    this.agentRt.get(a.id)?.session?.stop(); // no session yet (preparing): prepare() gives up and clears it
    const sign = this.signIns.get(a.id);
    if (sign?.held) {
      // Waiting for their sign-in: there's nothing to give up, so the desk is cleared now.
      sign.held = null;
      this.abandoned(a);
    }
  }

  /** Clear the desk of an agent whose work closed, as ↺ Clear desk does. */
  protected dropTask(a: PersistedAgent, text: string | null, kind: LogLine['kind'] = 'system') {
    this.dropping.delete(a.id);
    this.agentRt.get(a.id)?.terminal?.releaseIdle?.();
    this.clearTask(a);
    if (text) this.appendLog(a, [{ kind, text }]);
  }

  /** A task given up before its session started: one stopped because its issue or PR closed clears the desk now. */
  protected abandoned(a: PersistedAgent): null {
    if (this.dropping.has(a.id)) this.dropTask(a, '↺ Cleared desk. Ready for new work.');
    return null;
  }

  /** A closed or merged PR leaves QA, so its QA or fix is never handed out again. */
  protected dropRecord(repo: PersistedRepo, prNumber: number) {
    const rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === prNumber);
    if (!rec) return;
    this.state.qa = this.state.qa.filter((q) => q !== rec);
    this.broadcast({ type: 'qaRemoved', repoId: repo.id, prNumber });
    void removeQaShots(qaShotsDir(QA_SHOTS_DIR, repo.id, prNumber)).catch(() => undefined);
    this.clearPrepStrikes(repo.id, prNumber);
    this.fixNudged.delete(`${repo.id}#${prNumber}`);
    this.save();
  }

  /** The office closed an issue, or found it closed: off the board, and its work cleaned up now. Returns who it stopped. */
  protected learnIssueClosed(repo: PersistedRepo, n: number): string[] {
    const rt = this.repoRt.get(repo.id);
    if (!rt) return [];
    rt.closedIssues.set(n, Date.now());
    if (rt.issues.some((i) => i.number === n)) {
      rt.issues = rt.issues.filter((i) => i.number !== n);
      this.emitRepo(repo);
    }
    return this.cleanUpClosed(repo);
  }

  /**
   * The office closed or merged a PR, or found it so: its work is cleaned up now, not at the next sync. A closed PR's
   * issues wait for the manager, unless it was closed to be built again (rebuild). Returns who it stopped.
   */
  protected learnPull(repo: PersistedRepo, pr: Omit<KnownPull, 'state'>, state: 'CLOSED' | 'MERGED', rebuild = false): string[] {
    const rt = this.repoRt.get(repo.id);
    if (!rt) return [];
    const known: LearnedPull = { number: pr.number, headRefName: pr.headRefName, closesIssues: pr.closesIssues, state, at: Date.now() };
    rt.closedPulls.set(pr.number, known);
    if (!rebuild) this.holdIssues(repo, known);
    if (state === 'CLOSED' && rt.pulls.some((p) => p.number === pr.number && p.state === 'OPEN')) {
      rt.pulls = rt.pulls.map((p) => (p.number === pr.number ? { ...p, state } : p));
      this.emitRepo(repo);
    }
    return this.cleanUpClosed(repo);
  }

  /** A closed PR's open issues wait for the manager instead of going back to auto-assign (toHold). */
  protected holdIssues(repo: PersistedRepo, pr: KnownPull) {
    const rt = this.repoRt.get(repo.id);
    const add = rt ? toHold(pr, this.floorState(rt)).filter((n) => !this.isHeld(repo.id, n)) : [];
    if (!add.length) return;
    this.state.held.push(...add.map((issue) => ({ repoId: repo.id, issue, pr: pr.number })));
    this.emitRepo(repo);
    this.save();
  }

  protected isHeld(repoId: string, n: number) {
    return this.state.held.some((h) => h.repoId === repoId && h.issue === n);
  }
  protected fixNudged = new Set<string>(); // `${repoId}#${pr}`: its fix session was asked once to push or say why not
}
