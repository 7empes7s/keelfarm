// The QA → fix loop: queueing PRs for QA, QA and fix sessions and their outcomes.
import type { SessionResult } from '../agentRunner.ts';
import type { PrDetails } from '../github.ts';
import { stillOpen } from '../closeCleanup.ts';
import { depsPromptLine, type DepsOutcome } from '../deps.ts';
import { fixOutcome, MAX_FIX_FAILURES } from '../fixOutcome.ts';
import { HttpError } from '../httpError.ts';
import { MAX_MERGE_FIXES } from '../mergeGate.ts';
import { failedRunId, logTail, noChangeReason, QA_STOPPED, unpushedFix } from '../prOwnership.ts';
import { conflictFixInstructions, MAX_QA_ROUNDS, qaGate, qaOutcome, type QaNext } from '../qaOutcome.ts';
import { qaInstructions } from '../qaPrompt.ts';
import { sendBackPatch } from '../sendBack.ts';
import { qaShotsDir, saveQaShots } from '../qaShots.ts';
import { failedLogLines, noPushNudge, ownPrLine, qaBranch, qaSystemPrompt } from '../prompts.ts';
import { QA_RESUME_PROMPT, qaRetry } from '../qaRetry.ts';
import { recordQa } from '../metrics.ts';
import { clip } from '../notify.ts';
import { followupEvents } from '../../shared/followups.ts';
import { parseReport, QA_SCHEMA, type QaReport } from '../qaReport.ts';
import {
  type PersistedRepo,
  type PersistedAgent,
  type QaRecord,
  type Shot,
  BUSY,
  MAX_QA_FAILURES,
  oneLine,
  QA_SHOTS_DIR,
  cell,
  ICON,
} from './model.ts';
import { slugify } from './flavour.ts';
import { MIME_EXT } from './screens.ts';
import { SwarmSessions } from './sessions.ts';

export abstract class SwarmQa extends SwarmSessions {
  // ---------- QA ----------

  protected queueQa(repo: PersistedRepo, prNumber: number, dev: PersistedAgent | null, issueNumber: number | null) {
    const rt = this.repoRt.get(repo.id);
    if (rt && !stillOpen({ kind: 'pr', number: prNumber }, this.floorState(rt))) return; // it closed: QA has nothing to test
    let rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === prNumber);
    if (rec) {
      if (rec.status === 'testing') return;
      this.setQa(rec, { status: 'queued', devAgentId: dev?.id ?? rec.devAgentId, devSessionId: dev?.sessionId ?? rec.devSessionId });
    } else {
      rec = {
        repoId: repo.id,
        prNumber,
        status: 'queued',
        round: 1,
        devAgentId: dev?.id ?? null,
        qaAgentId: null,
        summary: null,
        checks: [],
        commentUrl: null,
        updatedAt: Date.now(),
        issueNumber,
        devSessionId: dev && dev.prNumber === prNumber ? dev.sessionId : null,
        fixInstructions: null,
        sessionFailures: 0,
        mergeNote: null,
        testedSha: null,
        passedSha: null,
        fixReason: null,
        mergeFixes: 0,
        retests: 0,
        pendingSince: null,
        mergeRetryAt: null,
        alerted: false,
        preQa: null,
        noChangeSha: null,
        rerunSha: null,
        rerunAt: null,
        qaChecks: null,
        stuckWhy: null,
        triages: 0,
        escalated: false,
      };
      this.state.qa.push(rec);
      this.setQa(rec, {});
    }
    setTimeout(() => this.schedule(), 200);
  }

  /** Manager's "send to QA" for any open PR (including ones opened by people); with `agentId`, that free agent tests it now. */
  async sendToQa(repoId: string, prNumber: number, agentId?: string) {
    const repo = this.repo(repoId);
    const pr = this.repoRt.get(repo.id)?.pulls.find((p) => p.number === prNumber && p.state === 'OPEN');
    if (!pr) throw new HttpError(404, `PR #${prNumber} is not open on ${repo.fullName}`);
    const rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === prNumber);
    if (rec?.status === 'testing' || rec?.status === 'fixing') throw new HttpError(409, `PR #${prNumber} is already ${rec.status}`);
    if (rec && (rec.status === 'needs-human' || rec.status === 'passed' || rec.status === 'failed')) {
      // a fresh start: the manager decided it deserves another round
      rec.round += 1;
      rec.sessionFailures = 0;
      rec.mergeNote = null;
      if (rec.preQa) Object.assign(rec, { fixReason: rec.preQa.fixReason, preQa: null }); // QA gets the test it was queued for
    }
    const dev = this.state.agents.find((a) => a.repoId === repo.id && a.role !== 'ceo' && a.task !== 'qa' && (a.prNumber === prNumber || a.branch === pr.headRefName));
    const tester = agentId ? this.agent(agentId) : null;
    if (tester && (tester.repoId !== repo.id || tester.role === 'ceo')) throw new HttpError(400, `${tester.name} doesn't work on ${repo.fullName}`);
    if (tester && BUSY.includes(tester.status)) throw new HttpError(409, `${tester.name} is busy: ${this.agentDoing(tester)}`);
    if (tester) this.ensureSlot('qa');
    this.clearPrepStrikes(repo.id, prNumber);
    this.queueQa(repo, prNumber, dev ?? null, pr.closesIssues[0] ?? null);
    const queued = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === prNumber && q.status === 'queued');
    if (tester && queued) {
      void this.runQa(tester, repo, queued); // marks it testing at once, before the scheduler's next pass
      this.toast('info', `${tester.name} is testing PR #${prNumber}`);
    } else this.toast('info', `PR #${prNumber} is queued for QA`);
  }

  /** Manager's "send back to dev" for a PR that needs a human or failed QA: a developer fixes it, with the note. */
  async sendBackToDev(repoId: string, prNumber: number, note?: string, from?: string) {
    const repo = this.repo(repoId);
    const find = () => this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === prNumber);
    const listed = this.repoRt.get(repo.id)?.pulls.find((p) => p.number === prNumber);
    sendBackPatch(prNumber, listed, find(), repo.defaultBranch, note, from); // refuse before asking GitHub
    // The last sync's mergeability may be stale or UNKNOWN: ask about the PR itself whether it conflicts now.
    const details = await this.backend.prDetails(repo.fullName, prNumber).catch(() => null);
    const pr = details && listed ? { ...listed, state: details.state, mergeable: details.mergeable, mergeState: details.mergeState } : listed;
    const rec = find();
    const patch = sendBackPatch(prNumber, pr, rec, repo.defaultBranch, note, from);
    this.clearPrepStrikes(repo.id, prNumber);
    this.setQa(rec!, { ...patch, preQa: null });
    setTimeout(() => this.schedule(), 200);
    this.toast('info', `PR #${prNumber} goes back to a developer${patch.fixReason === 'conflict' ? ' to resolve its conflicts' : ''}`);
  }

  protected buildQaSystemAppend(a: PersistedAgent, repo: PersistedRepo, cwd: string, branch: string, pr: PrDetails, testStep: string, deps?: DepsOutcome) {
    return qaSystemPrompt({ agent: a, repo, port: this.port(a), cwd, branch, pr, testStep, depsLine: depsPromptLine(deps), officePlaybook: this.state.settings.officePlaybook });
  }

  protected async runQa(a: PersistedAgent, repo: PersistedRepo, rec: QaRecord) {
    const branch = qaBranch(rec.prNumber, slugify(a.name));
    this.qaWaits.set(`${repo.id}#${rec.prNumber}`, Date.now() - rec.updatedAt); // queued since its last change
    this.setQa(rec, { status: 'testing', qaAgentId: a.id });
    this.beginTask(
      a,
      { task: 'qa', issueNumber: rec.issueNumber, issueTitle: `PR #${rec.prNumber}`, branch, prNumber: rec.prNumber, prUrl: null, sessionId: null },
      `QA · PR #${rec.prNumber} · round ${rec.round}`,
      `Checking out PR #${rec.prNumber}…`,
    );

    let pr: PrDetails;
    let issue: { title: string; body: string } | null = null;
    const lastTestedSha = rec.testedSha;
    // Stopped meanwhile, by the manager or because the PR closed (then its record has left QA already).
    const stopped = () => {
      if (this.state.qa.includes(rec) && rec.status === 'testing') this.setQa(rec, { status: 'queued', qaAgentId: null });
      return void this.abandoned(a);
    };
    try {
      pr = await this.backend.prDetails(repo.fullName, rec.prNumber);
      const issueNumber = rec.issueNumber ?? pr.closesIssues[0] ?? null;
      if (issueNumber) issue = await this.backend.issueDetails(repo.fullName, issueNumber).catch(() => null);
      Object.assign(a, { issueTitle: pr.title, prUrl: pr.url });
      this.emitAgent(a);
    } catch (err) {
      if (a.status !== 'preparing') return stopped();
      a.status = 'error';
      a.endedAt = Date.now();
      a.lastError = (err as Error).message;
      this.appendLog(a, [{ kind: 'error', text: `✗ ${a.lastError}` }]);
      this.setQa(rec, { status: 'queued', qaAgentId: null });
      this.emitAgent(a);
      return;
    }
    if (a.status !== 'preparing') return stopped();
    if (pr.state !== 'OPEN') {
      this.appendLog(a, [{ kind: 'system', text: `PR #${pr.number} is ${pr.state.toLowerCase()}; nothing to test.` }]);
      this.clearTask(a);
      this.dropRecord(repo, rec.prNumber);
      this.learnPull(repo, pr, pr.state);
      return;
    }
    // QA never spends a session on a stale branch: a conflict goes to the developer first, a branch behind is updated.
    const gate = qaGate(pr, rec, repo.autoMerge);
    if (gate.do === 'send-back') {
      this.appendLog(a, [{ kind: 'system', text: `PR #${pr.number} conflicts with ${repo.defaultBranch}; it goes back to its developer before QA.` }]);
      this.clearTask(a);
      if (gate.needsHuman) {
        this.sendBack(repo, rec, 'conflict', rec.fixInstructions ?? '', true);
        return;
      }
      // QA's last findings stay on the record for the test QA was queued for, which follows the merge.
      this.setQa(rec, { status: 'failed', qaAgentId: null, fixReason: 'conflict', preQa: { sha: pr.headSha, fixReason: rec.fixReason }, mergeFixes: rec.mergeFixes + 1, mergeNote: null });
      setTimeout(() => this.schedule(), 200);
      return;
    }
    if (gate.do === 'update-branch') {
      this.appendLog(a, [{ kind: 'system', text: `Updating PR #${pr.number}'s branch with ${repo.defaultBranch} first…` }]);
      try {
        await this.backend.updateBranch(repo.fullName, pr.number);
        pr = await this.backend.prDetails(repo.fullName, pr.number);
      } catch (err) {
        this.appendLog(a, [{ kind: 'system', text: `  ⎿ GitHub couldn't update it (${oneLine(err)}); testing it as it is.` }]);
      }
    }
    rec.testedSha = pr.headSha;

    const desk = await this.prepare(a, repo, { pr: rec.prNumber }, branch, { rec, task: 'qa' });
    if (!desk) {
      if (this.state.qa.includes(rec) && rec.status === 'testing') this.setQa(rec, { status: 'queued', qaAgentId: null });
      return;
    }
    const { cwd } = desk;

    const dev = rec.devAgentId ? this.state.agents.find((x) => x.id === rec.devAgentId) : null;
    // A last-round fail sent back for a merge fix (QA never passed it): QA's findings first, then a full re-check.
    const failedConflict = rec.fixReason === 'conflict' && !rec.passedSha;
    const qa = qaInstructions({
      ...pr,
      round: rec.round,
      fixReason: failedConflict ? 'qa' : rec.fixReason,
      lastTestedSha: failedConflict ? null : lastTestedSha,
      summary: rec.summary,
      fixInstructions: rec.fixInstructions,
      defaultBranch: repo.defaultBranch,
    });
    const prompt = [
      `Please QA pull request #${pr.number}: ${pr.title}`,
      `URL: ${pr.url}`,
      `Author: ${dev ? (dev.id === a.id ? `you, in an earlier session` : dev.name) : 'a teammate'} · QA round ${rec.round}`,
      qa.checks,
      qa.retest,
      '',
      'PR description:',
      pr.body.trim() || '(empty)',
      issue ? `\nLinked issue: ${issue.title}\n${issue.body.trim() || '(no description)'}` : '',
      this.ceoFiles.issueLines(`${pr.body}\n${issue?.body ?? ''}`),
    ]
      .filter((l) => l !== '')
      .join('\n');

    const systemAppend = this.buildQaSystemAppend(a, repo, cwd, branch, pr, qa.testStep, desk.deps);
    const rt = this.agentRt.get(a.id);
    if (!rt) return; // let go meanwhile
    rt.qaResume = { cwd, systemAppend };
    this.startAgentSession(a, repo, cwd, prompt, systemAppend, undefined, QA_SCHEMA);
  }

  protected async onQaFinished(a: PersistedAgent, repo: PersistedRepo, result: SessionResult) {
    const rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === a.prNumber);
    const rt = this.agentRt.get(a.id)!;
    const report = result.ok ? parseReport(result) : null;
    const resume = rt.qaResume;
    const next = qaRetry({ stopped: a.status === 'stopped', limited: this.limited(), ok: result.ok, report: !!report, canResume: !!resume && !!a.sessionId });
    if (next === 'resume' && resume && a.sessionId) {
      // Same session, context and screenshots: they likely ended a turn to wait on something that never woke them.
      rt.qaResume = null;
      a.endedAt = null;
      this.appendLog(a, [{ kind: 'system', text: '↻ The session ended without a QA report. Resuming it once to finish.' }]);
      this.startAgentSession(a, repo, resume.cwd, QA_RESUME_PROMPT, resume.systemAppend, a.sessionId, QA_SCHEMA);
      return;
    }

    if (next === 'give-up' || !report) {
      if (a.status !== 'stopped') this.fail(a, { ...result, errors: result.errors.length ? result.errors : ['QA finished without a usable report'] }, `QA of PR #${a.prNumber}`);
      if (rec) {
        const failures = rec.sessionFailures + (this.limited() ? 0 : 1); // the usage limit isn't the PR's fault
        const patch = { qaAgentId: null, sessionFailures: failures, summary: a.status === 'stopped' ? QA_STOPPED : rec.summary };
        if (a.status === 'stopped') this.setQa(rec, { ...patch, status: 'needs-human', escalated: true }); // the manager stopped it: theirs to decide
        else if (failures >= MAX_QA_FAILURES) this.stuck(rec, patch, `QA ended without a usable report ${failures} times in a row`);
        else this.setQa(rec, { ...patch, status: 'queued' });
      }
      return;
    }

    a.status = 'done';
    const pass = report.verdict === 'pass';
    this.spend.outcome(a.id, pass ? 'qa-pass' : 'qa-fail');
    if (rec) this.ledger({ kind: 'qa', repoId: repo.id, pr: rec.prNumber, round: rec.round, pass, tester: a.id, author: rec.devAgentId, at: Date.now() });
    this.appendLog(a, [{ kind: pass ? 'done' : 'error', text: `${pass ? '✅ QA passed' : '❌ QA failed'} PR #${a.prNumber} · ${report.checks.length} checks · ${rt.shots.length} screenshots` }]);

    // Evidence + comment on the PR
    let commentUrl: string | null = null;
    if (rec) {
      const shots = await saveQaShots(
        qaShotsDir(QA_SHOTS_DIR, repo.id, rec.prNumber),
        rt.shots.map((s, i) => ({ data: s.data, mime: s.mime, page: s.url, caption: report.screenshots[i] ?? `Screenshot ${i + 1}` })),
      ).catch((err) => {
        console.warn(`could not keep QA's screenshots of PR #${rec.prNumber}: ${oneLine(err)}`);
        return [];
      });
      const key = `${repo.id}#${rec.prNumber}`;
      recordQa(this.state.ops, repo.id, pass, this.qaWaits.get(key) ?? null, Date.now(), rec.prNumber, rec.round);
      this.qaWaits.delete(key);
      // On a fail: a conflict with the default branch is the merge gate's job, not the manager's (on QA's last round),
      // and the checks are recorded so a re-run of a red one can count as the fix.
      const pull = !pass ? await this.backend.prDetails(repo.fullName, rec.prNumber).catch(() => null) : null;
      const next = qaOutcome(pass, rec, pull);
      try {
        this.appendLog(a, [{ kind: 'system', text: '📎 Uploading evidence and posting the QA report on the PR…' }]);
        const body = await this.renderQaComment(a, repo, rec, report, rt.shots, next);
        commentUrl = (await this.backend.commentPull(repo.fullName, rec.prNumber, body)) || null;
        this.appendLog(a, [{ kind: 'system', text: `  ⎿ ${commentUrl ?? 'comment posted'}` }]);
      } catch (err) {
        this.appendLog(a, [{ kind: 'error', text: `  ⎿ Could not post the QA report: ${(err as Error).message}` }]);
      }
      const qaRounds = rec.round - rec.retests; // rounds QA itself asked for
      const nextStatus = next === 'conflict' ? 'failed' : next;
      const fixInstructions = report.fixInstructions ?? report.checks.filter((c) => c.result === 'fail').map((c) => `${c.name}: ${c.details}`).join('\n');
      this.setQa(rec, {
        status: nextStatus,
        summary: report.summary,
        checks: report.checks,
        commentUrl: commentUrl ?? rec.commentUrl,
        fixInstructions,
        sessionFailures: 0,
        fixReason: pass ? null : 'qa',
        preQa: null,
        passedSha: pass ? rec.testedSha : null,
        mergeNote: null,
        pendingSince: null,
        mergeRetryAt: null,
        alerted: false,
        qaChecks: pull?.checks ?? null,
        shots,
      });
      // QA's findings travel with the merge fix; the developer's push then gets one more QA round.
      if (next === 'conflict') this.sendBack(repo, rec, 'conflict', conflictFixInstructions(fixInstructions, repo.defaultBranch), false);
      const stillConflicts = pull && (pull.mergeable === 'CONFLICTING' || pull.mergeState === 'DIRTY') ? `, and it still conflicts with ${repo.defaultBranch} with its ${MAX_MERGE_FIXES} merge fixes used up` : '';
      const triaged = nextStatus === 'needs-human' && this.stuck(rec, {}, `it failed QA ${qaRounds} times, the most QA rounds a PR gets (${MAX_QA_ROUNDS})${stillConflicts}`);
      if (!pass && qaRounds >= 2) {
        this.followup(followupEvents.qaFailed(repo.id, this.floorName(repo), rec.prNumber, qaRounds, rec.round, clip(report.summary, 200)));
      }
      this.toast(
        pass ? 'success' : 'error',
        pass
          ? `✅ ${a.name} passed PR #${rec.prNumber}${repo.autoMerge ? "; it merges once GitHub's checks are green" : ': ready to merge'}`
          : nextStatus === 'needs-human'
            ? `❌ PR #${rec.prNumber} failed QA ${qaRounds} times${triaged ? `; ${this.ceo().name} takes a look before it comes to you` : ' and needs a human'}`
            : next === 'conflict'
              ? `❌ ${a.name} failed PR #${rec.prNumber}, and it conflicts with ${repo.defaultBranch}; sending it back to merge and fix`
              : `❌ ${a.name} failed PR #${rec.prNumber}; sending it back to the developer`,
      );
    }
  }

  protected async renderQaComment(a: PersistedAgent, repo: PersistedRepo, rec: QaRecord, report: QaReport, shots: Shot[], next: QaNext) {
    const pass = report.verdict === 'pass';
    const images: string[] = [];
    const evidence = shots.slice(-8);
    const offset = shots.length - evidence.length;
    const folder = `pr-${rec.prNumber}/round-${rec.round}-${Date.now().toString(36)}`;
    for (const [i, shot] of evidence.entries()) {
      const n = offset + i + 1;
      const ext = MIME_EXT[shot.mime] ?? 'png';
      const file = `${folder}/${String(n).padStart(2, '0')}.${ext}`;
      try {
        const url = await this.backend.uploadEvidence(repo.fullName, file, shot.data);
        const caption = report.screenshots[n - 1] ?? `Screenshot ${n}`;
        images.push(`**${n}. ${caption}**${shot.url ? ` · \`${shot.url}\`` : ''}\n\n<img src="${url}" alt="${caption.replace(/"/g, "'")}" width="760">`);
      } catch (err) {
        this.appendLog(a, [{ kind: 'error', text: `  ⎿ screenshot ${n} upload failed: ${(err as Error).message.slice(0, 120)}` }]);
      }
    }
    const dev = rec.devAgentId ? this.state.agents.find((x) => x.id === rec.devAgentId) : null;
    const lines = [
      `## 🔍 QA report: ${pass ? '✅ Passed' : '❌ Failed'}`,
      `**Tester:** ${a.name} (cubefarm agent, in a fresh session) · **Round:** ${rec.round}${dev ? ` · **Author:** ${dev.name}` : ''}`,
      '',
      report.summary,
      '',
      '| | Check | Details |',
      '|---|---|---|',
      ...report.checks.map((c) => `| ${ICON[c.result]} | ${cell(c.name)} | ${cell(c.details)} |`),
    ];
    if (report.commands.length) {
      lines.push('', '<details><summary>🧪 Commands run</summary>', '', '| Command | Result |', '|---|---|', ...report.commands.map((c) => `| \`${cell(c.command)}\` | ${cell(c.result)} |`), '', '</details>');
    }
    if (!pass && report.fixInstructions) lines.push('', '### 🔧 What needs fixing', '', report.fixInstructions);
    if (images.length) lines.push('', '### 📸 Evidence', '', ...images.flatMap((img) => [img, '']));
    else lines.push('', '_No browser screenshots were taken in this round._');
    const merge = repo.autoMerge ? "merges automatically once GitHub's checks pass" : 'ready for the manager to merge';
    lines.push('', `<sub>Posted by cubefarm · ${pass ? merge : next === 'needs-human' ? 'needs a human decision' : next === 'conflict' ? `sent back to the developer to merge ${repo.defaultBranch} and fix` : 'sent back to the developer for fixes'}</sub>`);
    return lines.join('\n');
  }

  /** Send a failed PR back to the agent who wrote it (or any free agent on the floor). */
  protected async runFix(dev: PersistedAgent, repo: PersistedRepo, rec: QaRecord) {
    const original = rec.devAgentId === dev.id;
    const pull = this.repoRt.get(repo.id)?.pulls.find((p) => p.number === rec.prNumber);
    const headRef = pull?.headRefName ?? dev.branch ?? `pr-${rec.prNumber}`;
    const qaAgent = rec.qaAgentId ? this.state.agents.find((x) => x.id === rec.qaAgentId) : null;
    this.fixNudged.delete(`${repo.id}#${rec.prNumber}`);
    const author = rec.devAgentId;
    this.ledger({ kind: 'fix', repoId: repo.id, pr: rec.prNumber, key: `${rec.round}:${rec.mergeFixes}`, at: Date.now() });
    this.setQa(rec, { status: 'fixing', devAgentId: dev.id });
    this.beginTask(
      dev,
      // The session they held was another task's (QA, say); the author's own is resumed below, from rec.devSessionId.
      { task: 'fix', issueNumber: rec.issueNumber, issueTitle: pull?.title ?? `PR #${rec.prNumber}`, branch: headRef, prNumber: rec.prNumber, prUrl: pull?.url ?? null, sessionId: null },
      rec.fixReason === 'conflict' ? `Resolving conflicts on PR #${rec.prNumber}` : rec.fixReason === 'checks' ? `Fixing checks on PR #${rec.prNumber}` : `Fixing PR #${rec.prNumber} after QA round ${rec.round}`,
      `Checking out PR #${rec.prNumber}…`,
    );
    // GitHub's word, not the last sync's: a PR closed or merged since then gets no fix.
    const live = await this.backend.prDetails(repo.fullName, rec.prNumber).catch(() => null);
    if (dev.status !== 'preparing') {
      if (this.state.qa.includes(rec) && rec.status === 'fixing') this.setQa(rec, { status: 'failed' });
      return void this.abandoned(dev);
    }
    if (live && live.state !== 'OPEN') {
      this.appendLog(dev, [{ kind: 'system', text: `PR #${rec.prNumber} is ${live.state.toLowerCase()}; nothing to fix.` }]);
      this.clearTask(dev);
      this.dropRecord(repo, rec.prNumber);
      this.learnPull(repo, live, live.state);
      return;
    }
    const desk = await this.prepare(dev, repo, { pr: rec.prNumber }, headRef, { rec, task: 'fix', author });
    if (!desk) {
      if (this.state.qa.includes(rec) && rec.status === 'fixing') this.setQa(rec, { status: 'failed' });
      return;
    }
    const { cwd } = desk;
    const failed = rec.checks.filter((c) => c.result === 'fail');
    const takeover = original ? '' : ' A teammate wrote it, so read the PR and the linked issue first.';
    const push = `push to the same branch: git push origin HEAD:${headRef}`;
    const runId = rec.fixReason === 'checks' ? failedRunId(rec.fixInstructions) : null;
    const runLog = runId ? logTail(await this.backend.failedRunLog(repo.fullName, runId).catch(() => '')) : '';
    // A conflict QA never passed (it failed the last round) goes out as a QA fix: its instructions add the merge.
    const mergeFix =
      rec.fixReason === 'conflict' && (rec.preQa || rec.passedSha)
        ? [
            rec.preQa
              ? `Pull request #${rec.prNumber} (${pull?.url ?? ''}) conflicts with ${repo.defaultBranch} because other work was merged first, so it comes back to you before QA tests it.${takeover}`
              : `QA passed pull request #${rec.prNumber} (${pull?.url ?? ''}), but it now conflicts with ${repo.defaultBranch} because other work was merged first.${takeover}`,
            // A conflict found before QA keeps QA's last findings for the re-test, not for this fix.
            !rec.preQa && rec.fixInstructions ? `\nWhat needs fixing:\n${rec.fixInstructions}` : '',
            '',
            `Bring it up to date: git fetch origin && git merge origin/${repo.defaultBranch}. Resolve the conflicts so both this change and the newly merged work keep working, run the project's checks, and ${push}`,
          ]
        : rec.fixReason === 'checks'
          ? [
              `QA passed pull request #${rec.prNumber} (${pull?.url ?? ''}), but GitHub checks failed on it.${takeover}`,
              '',
              `Failed checks:\n${rec.fixInstructions ?? ''}`,
              ...(runId ? failedLogLines(runId, runLog) : []),
              '',
              `Read the logs with gh pr checks ${rec.prNumber} -R ${repo.fullName} (for GitHub Actions: gh run view <run id> -R ${repo.fullName} --log-failed). Fix the cause, run the same checks locally where you can, and ${push}`,
              `If a failure clearly has nothing to do with this change (a flaky test or a service outage), re-run it instead with gh run rerun <run id> -R ${repo.fullName} --failed, and say so.`,
            ]
          : null;
    const qaFix = [
      original
        ? `${qaAgent && qaAgent.id !== dev.id ? qaAgent.name : 'QA'} tested your pull request #${rec.prNumber} and it FAILED (round ${rec.round}).`
        : `You are taking over pull request #${rec.prNumber} (${pull?.url ?? ''}), written by a teammate, because QA failed it (round ${rec.round}). Read the PR and the linked issue first.`,
      '',
      `QA summary: ${rec.summary ?? ''}`,
      failed.length ? `Failed checks:\n${failed.map((c) => `- ${c.name}: ${c.details}`).join('\n')}` : '',
      rec.fixInstructions ? `\nWhat needs fixing:\n${rec.fixInstructions}` : '',
      rec.commentUrl ? `\nFull report with screenshots: ${rec.commentUrl}` : '',
      '',
      `Fix these problems, re-run the relevant checks, and push to the same branch: git push origin HEAD:${headRef}`,
      ownPrLine(repo.defaultBranch),
      'Then reply with a short summary of what you changed. Do not open a new pull request; QA will re-test automatically.',
    ];
    const mergeEnd = 'Then reply with a short summary of what you did. Do not open a new pull request; the office merges it once the checks pass, after another QA round if the code changed.';
    const prompt = (mergeFix ? [...mergeFix, ownPrLine(repo.defaultBranch), mergeEnd] : qaFix).filter((l) => l !== '').join('\n');
    const resume = original && rec.devSessionId ? rec.devSessionId : undefined;
    this.startAgentSession(dev, repo, cwd, prompt, this.buildSystemAppend(dev, repo, cwd, headRef, { pr: rec.prNumber, headRef }, desk.deps), resume);
  }

  protected async onFixFinished(a: PersistedAgent, repo: PersistedRepo, result: SessionResult) {
    const rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === a.prNumber);
    // Did it push anything? A checks fix may only re-run a flaky check, so only QA and conflict fixes are asked.
    const current = rec && result.ok && a.status !== 'stopped' && rec.fixReason !== 'checks' ? await this.prHead(a, repo, rec.prNumber) : null;
    if (a.status === 'stopped') {
      if (rec?.status === 'fixing') this.setQa(rec, { status: 'failed' });
      return;
    }
    if (!result.ok) {
      this.fail(a, result, `the fix for PR #${a.prNumber}`);
      // Someone else gets a go before it lands on the manager.
      const failures = rec ? rec.sessionFailures + (this.limited() ? 0 : 1) : 0;
      if (rec && failures >= MAX_FIX_FAILURES) this.stuck(rec, { sessionFailures: failures }, `${failures} fix sessions in a row failed`);
      else if (rec) this.setQa(rec, { status: 'failed', sessionFailures: failures });
      return;
    }
    if (!rec || !this.state.qa.includes(rec)) {
      a.status = 'done';
      this.spend.outcome(a.id, 'commit');
      this.appendLog(a, [{ kind: 'done', text: `✔ Fix pushed for PR #${a.prNumber} in ${this.minutes(a)}m. Back to QA.` }]);
      return;
    }
    const head = current?.headSha ?? null;
    const step = fixOutcome(rec, head, this.minutes(a), !this.limited(), current?.checks ?? null);
    if (!step.pushed && head) {
      // Asked once to push or say why nothing needs to change, before it counts as a strike.
      const key = `${repo.id}#${rec.prNumber}`;
      const noChange = noChangeReason(result.text);
      const next = unpushedFix(rec, head, { nudged: this.fixNudged.has(key), noChange, counts: !this.limited() });
      if (next.do === 'retest') {
        this.fixNudged.delete(key);
        a.status = 'done';
        this.spend.outcome(a.id, 'no-change');
        this.appendLog(a, [{ kind: 'done', text: `✔ No change needed for PR #${rec.prNumber}: ${noChange?.replace(/[.!\s]+$/, '')}. Back to QA for a re-test.` }]);
        this.setQa(rec, { ...next.set, devSessionId: a.sessionId ?? rec.devSessionId });
        this.toast('info', `${a.name} says PR #${rec.prNumber} needs no change; QA re-tests it`);
        return;
      }
      if (next.do === 'nudge') {
        if (this.ask(a, repo, result.text)) return void (a.status = 'done');
        this.fixNudged.add(key);
        a.status = 'done';
        this.spend.outcome(a.id, 'no-commit');
        this.appendLog(a, [{ kind: 'system', text: `No new commits were pushed for PR #${rec.prNumber}; asking ${a.name} once more.` }]);
        // message() starts the session before its first await, so the scheduler can't hand this developer other work first.
        void this.message(a.id, noPushNudge(rec.prNumber, repo.defaultBranch)).catch(() => {
          if (rec.status !== 'fixing') return;
          this.unpushed(a, repo, rec, step);
          this.emitAgent(a);
          setTimeout(() => this.schedule(), 500);
        });
        return;
      }
    }
    if (!step.pushed) {
      this.spend.outcome(a.id, 'no-commit');
      return this.unpushed(a, repo, rec, step);
    }
    a.status = 'done';
    this.spend.outcome(a.id, 'commit');
    this.appendLog(a, [step.log]);
    this.setQa(rec, { ...step.set, devSessionId: a.sessionId ?? rec.devSessionId });
    this.toast(
      'info',
      step.set.status === 'passed'
        ? `${a.name} fixed PR #${rec.prNumber}; it merges once it passes again`
        : 'preQa' in step.set
          ? `${a.name} brought PR #${rec.prNumber} up to date; QA tests it`
          : step.set.retests
            ? `${a.name} re-ran the failed checks on PR #${rec.prNumber}; QA re-tests it`
            : `${a.name} pushed fixes for PR #${rec.prNumber}; QA round ${rec.round} is queued`,
    );
  }

  /** A fix that pushed nothing counts as a failed session (fixOutcome's step). */
  protected unpushed(a: PersistedAgent, repo: PersistedRepo, rec: QaRecord, step: ReturnType<typeof fixOutcome>) {
    // Like a failed session: someone gets another go, with the same instructions, before it lands on the CEO.
    this.fixNudged.delete(`${repo.id}#${rec.prNumber}`);
    const needsHuman = step.set.status === 'needs-human';
    a.status = 'error';
    a.lastError = `No new commits were pushed for PR #${rec.prNumber}`;
    this.appendLog(a, [step.log]);
    const triaged = needsHuman ? this.stuck(rec, step.set, `it went back for fixes, but ${step.set.sessionFailures} fix sessions in a row ended without pushing a commit`) : (this.setQa(rec, step.set), false);
    const next = !needsHuman ? '; it goes back for another try' : triaged ? `; ${this.ceo().name} takes a look` : '; it needs you';
    this.toast('error', `${a.name} ended the fix for PR #${rec.prNumber} without pushing a commit${next}`);
  }

  /** The PR's head commit and checks now; null (with a warning in the agent's log) when GitHub can't be asked. */
  protected async prHead(a: PersistedAgent, repo: PersistedRepo, prNumber: number): Promise<Pick<PrDetails, 'headSha' | 'checks'> | null> {
    try {
      return await this.backend.prDetails(repo.fullName, prNumber);
    } catch (err) {
      console.warn(`could not read the head of ${repo.fullName}#${prNumber}`, err);
      this.appendLog(a, [{ kind: 'system', text: `⚠ Could not check PR #${prNumber} for new commits (${oneLine(err)}); taking the fix at its word.` }]);
      return null;
    }
  }
  protected qaWaits = new Map<string, number>(); // `${repoId}#${pr}` -> how long its QA run in progress waited for a tester
}
