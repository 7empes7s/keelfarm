// Agents' sessions: terminals, desk setup, prompts, starting and finishing a build session.
import fs from 'node:fs/promises';
import type { WebSocket } from 'ws';
import type { LogEntry, SessionResult } from '../agentRunner.ts';
import { agentPortEnv } from '../portLanes.ts';
import type { BoxTarget } from '../boxCli.ts';
import { boxLinkedDir } from '../boxScripts.ts';
import { CloudError } from '../box.ts';
import { redact } from '../cloud.ts';
import { ceoSystemPrompt } from '../ceo.ts';
import { stillOpen } from '../closeCleanup.ts';
import { depsPromptLine, type DepsOutcome } from '../deps.ts';
import { setUpDesk } from '../deskSetup.ts';
import { mainKey, prKey } from '../prTheatre.ts';
import { MAX_FIX_FAILURES } from '../fixOutcome.ts';
import { PREP_HOLD_MS, prepFailure } from '../handOut.ts';
import { sessionStart } from '../reconcile.ts';
import { resumesAfterRestart } from '../restartRecovery.ts';
import { sessionKind } from '../health.ts';
import { agentPromptPreview, ceoPromptPreview, devBranch, devSystemPrompt } from '../prompts.ts';
import { leaseTools } from '../leaseTool.ts';
import { normPath, overlap, practiceLines, qaPracticeLines } from '../../shared/practices.ts';
import { recordBox, recordCost } from '../metrics.ts';
import { BOX_SIZE_INFO, boxCli } from '../../shared/cloud.ts';
import { cliLabel } from '../clis.ts';
import { costsRequest, taskKindOf } from '../costLedger.ts';
import { resolveEffort, type CostsView } from '../../shared/costs.ts';
import { officeParts } from '../../shared/startup.ts';
import { knownUrl } from '../../shared/browserAddress.ts';
import { AgentTerminal } from '../terminal.ts';
import { INSTALL_STEP } from '../../shared/types.ts';
import type { AgentCli, AgentPromptView, AgentStatus, IssueInfo, WorldSnapshot } from '../../shared/types.ts';
import {
  type PersistedRepo,
  type PersistedAgent,
  type PrepJob,
  prepKey,
  MAX_QA_FAILURES,
  oneLine,
  SIGNED_IN_AGAIN,
  SignInNeeded,
  terminalFile,
} from './model.ts';
import { slugify } from './flavour.ts';
import { SCREENS_DIR, screenFile, removeScreens } from './screens.ts';
import { SwarmRotation } from './rotation.ts';
import { TestLab, type Requester } from '../testLab.ts';
import { OFFICE_DIR } from '../officeUpdate.ts';
import { createLabTools } from '../testLabTools.ts';
import { fixCause } from '../../shared/rounds.ts';

const LAB_VIEWER = 'testlab';
const LAB_PREVIEW_MS = 5 * 60_000;

export abstract class SwarmSessions extends SwarmRotation {
  // ---------- terminals ----------

  protected async loadTerminal(agentId: string): Promise<AgentTerminal | null> {
    if (!(await fs.stat(terminalFile(agentId)).catch(() => null))) return null;
    const t = this.newTerminal(agentId);
    await t.load(terminalFile(agentId));
    return t;
  }

  /** The agent's terminal, made the first time they run in the terminal runtime. */
  protected terminalFor(a: PersistedAgent): AgentTerminal {
    const rt = this.agentRt.get(a.id)!;
    rt.terminal ??= this.newTerminal(a.id);
    return rt.terminal;
  }

  protected newTerminal(agentId: string) {
    const t = new AgentTerminal();
    // Typed at a CLI waiting at its prompt after its task: a follow-up, which starts synchronously when it can.
    t.onIdlePrompt = (text) => {
      void this.message(agentId, text, true).catch(() => undefined);
      return !!this.agentRt.get(agentId)?.session;
    };
    return t;
  }

  protected async saveTerminals(all = false) {
    for (const [id, rt] of this.agentRt) {
      if (rt.terminal && (all || rt.terminal.dirty)) await rt.terminal.save(terminalFile(id)).catch((err) => console.warn('could not save a terminal', err));
    }
  }

  /** A browser opened an agent's terminal (/ws/term?agent=<id>), or an account's sign-in (agent=account:<id>, #247). */
  attachTerminal(agentId: string, ws: WebSocket) {
    if (agentId.startsWith('account:')) {
      const t = this.accounts.terminal(agentId.slice('account:'.length));
      return t ? t.attach(ws) : ws.close(4404, 'No such account');
    }
    const a = this.state.agents.find((x) => x.id === agentId);
    // Opening the terminal of a cloud agent who waits for a sign-in (at their desk, or 🔑 Sign in) starts one if none runs.
    if (a?.needsSignIn && a.host === 'box') {
      this.terminalFor(a);
      void this.startSignIn(a);
    }
    const t = this.agentRt.get(agentId)?.terminal;
    if (!t) return ws.close(4404, 'That agent has no terminal');
    t.attach(ws);
  }

  protected buildSystemAppend(a: PersistedAgent, repo: PersistedRepo, cwd: string, branch: string, fixing?: { pr: number; headRef: string }, deps?: DepsOutcome) {
    return devSystemPrompt({ agent: a, repo, port: this.port(a), cwd, branch, linked: this.linkedDirs(repo, a), fixing, depsLine: depsPromptLine(deps), officePlaybook: this.state.settings.officePlaybook, lab: this.usesTestLab(a, repo) });
  }

  /**
   * What a session's practice switches add to its instructions (#24): the file rules and diff budget, and for a
   * builder or fixer with leases on who can call it (Claude Code on this computer), the declare_files step. '' with
   * every switch off.
   */
  protected practicePrompt(a: PersistedAgent, repo: PersistedRepo, cli: AgentCli | undefined, issue = a.issueNumber ?? this.prRecord(a)?.issueNumber) {
    const p = this.practicesOf(repo, issue, a.prNumber);
    const declares = p.leases && a.task !== 'qa' && (cli ?? 'claude') === 'claude' && a.host !== 'box' && issue != null;
    const lines = a.task === 'qa' ? qaPracticeLines(p) : practiceLines(p, { base: repo.defaultBranch, declareTool: declares });
    return { text: lines.join('\n'), office: declares ? leaseTools((files) => this.declareFiles(a, repo, files)) : undefined };
  }

  /** declare_files: the agent's lease for their current task, and who else is on those files already. */
  protected declareFiles(a: PersistedAgent, repo: PersistedRepo, files: string[]) {
    if (a.issueNumber == null || !this.state.agents.includes(a)) throw new Error('You have no issue to declare files for.');
    a.declared = [...new Set(files.map(normPath).filter((f) => f && !f.split('/').includes('..')))].slice(0, 30);
    this.save();
    this.emitRepo(repo);
    const others = this.leasesOf(repo).filter((l) => l.issue !== a.issueNumber);
    const clash = others.map((l) => ({ l, files: overlap(a.declared!, l.files) })).filter((x) => x.files.length);
    const note = clash.map((x) => `#${x.l.issue}${x.l.pr ? ` (PR #${x.l.pr})` : ''} also touches ${x.files.slice(0, 5).join(', ')}`).join('; ');
    return `Declared ${a.declared.length} path${a.declared.length === 1 ? '' : 's'}.${note ? ` Heads-up: ${note}. Keep your changes there small, and merge origin/${repo.defaultBranch} before you push.` : ''}`;
  }

  /** The floor's linked repos where the agent reads them: the floor checkouts here, or their copies in a cloud agent's Box. */
  protected linkedDirs(repo: PersistedRepo, a?: PersistedAgent) {
    return this.linkedRepos(repo).map((r) => ({ fullName: r.fullName, dir: a?.host === 'box' ? boxLinkedDir(r.fullName) : this.backend.mainDir(r.fullName) }));
  }

  /** What an agent is told on a task, previewed with placeholders for the task's details. */
  agentPrompt(id: string): AgentPromptView {
    const a = this.agent(id);
    if (a.role === 'ceo') return ceoPromptPreview(ceoSystemPrompt(this.ceoPromptInput(a)));
    const repo = this.repo(a.repoId);
    const view = agentPromptPreview({ agent: a, repo, port: this.port(a), slug: slugify(a.name), linked: this.linkedDirs(repo, a), officePlaybook: this.state.settings.officePlaybook });
    // The floor's practice switches (#24), as a session on it gets them (an experiment's variant can change them per issue).
    const p = this.practicesOf(repo);
    const dev = practiceLines(p, { base: repo.defaultBranch, declareTool: true }).join('\n');
    const qa = qaPracticeLines(p).join('\n');
    return { ...view, parts: view.parts.map((x, i) => ((i === 1 ? qa : dev) ? { ...x, text: `${x.text}\n\n${i === 1 ? qa : dev}` } : x)) };
  }

  protected beginTask(a: PersistedAgent, patch: Partial<PersistedAgent>, banner: string, preparing: string) {
    const rt = this.agentRt.get(a.id)!;
    this.dropping.delete(a.id);
    Object.assign(a, {
      status: 'preparing' as AgentStatus,
      startedAt: Date.now(),
      endedAt: null,
      costUsd: 0,
      turns: 0,
      declared: null, // a lease is per task
      lastError: null,
      ...patch,
    });
    rt.screenshot = null;
    rt.browserUrl = null;
    rt.shots = [];
    void removeScreens(a.id);
    this.appendLog(a, [
      { kind: 'system', text: '' },
      { kind: 'system', text: `━━━ ${banner} ━━━` },
      { kind: 'system', text: preparing },
    ]);
    this.emitAgent(a);
    this.save();
  }

  /** job: the PR fix or QA run this desk is for; if the desk can't be set up, the PR pays for it, not the agent. */
  protected async prepare(a: PersistedAgent, repo: PersistedRepo, base: { pr?: number }, branch: string, job?: PrepJob): Promise<{ cwd: string; deps: DepsOutcome } | null> {
    try {
      if (this.repoRt.get(repo.id)?.cloneStatus !== 'ready') await this.cloneRepo(repo.id);
      const note = (text: string) => this.appendLog(a, [{ kind: 'system', text }]);
      const cwd = await setUpDesk(this.agentRt.get(a.id)?.terminal, {
        release: () => this.releaseDesk(a, repo).then(() => undefined),
        prepare: () => this.machinesFor(a).prepareDesk(this.machineOf(a), repo.fullName, { defaultBranch: repo.defaultBranch, pr: base.pr }, branch, note),
      });
      this.deskAlerts.delete(a.id);
      if (job) this.prepStrikes.delete(prepKey(repo.id, job.rec.prNumber, job.task));
      if (a.status !== 'preparing') return this.abandoned(a); // stopped or fired while preparing, or its issue or PR closed
      // Outside the repo's git lock, so other desks keep checking out meanwhile. A failed install never fails the task.
      const deps = await this.installDeps(a, cwd, repo);
      return a.status === 'preparing' ? { cwd, deps } : this.abandoned(a);
    } catch (err) {
      if (a.status !== 'preparing') return this.abandoned(a);
      // Upstash refusing or unreachable is the cloud's trouble, not the PR's: it goes back in line without a strike.
      const cloud = err instanceof CloudError;
      if (job && !cloud) {
        this.jobDeskFailed(a, repo, job, (err as Error).message);
        return null;
      }
      if (job) {
        if (this.state.qa.includes(job.rec)) this.setQa(job.rec, job.task === 'fix' ? { status: 'failed', devAgentId: job.author } : { status: 'queued', qaAgentId: null });
        this.clearTask(a);
      }
      a.status = 'error';
      a.endedAt = Date.now();
      a.lastError = (err as Error).message;
      this.appendLog(a, [{ kind: 'error', text: `✗ ${a.lastError}` }]);
      if (this.deskAlerts.get(a.id) !== a.lastError) {
        // Once per agent and error: retries that fail the same way don't ring the phone again.
        this.deskAlerts.set(a.id, a.lastError);
        this.postMessage('office', `⚠️ ${a.name}'s desk couldn't be set up: ${a.lastError.slice(0, 240)}`);
      }
      this.emitAgent(a);
      this.save();
      return null;
    }
  }

  /**
   * A desk couldn't be set up for a PR's fix or QA run (#199). Nothing ran, so the agent is free again at once. The PR
   * is handed out again; after repeated failures it sits out a while (one phone message), and in time needs the manager.
   */
  protected jobDeskFailed(a: PersistedAgent, repo: PersistedRepo, job: PrepJob, error: string) {
    const { rec, task } = job;
    this.appendLog(a, [
      { kind: 'error', text: `✗ ${error}` },
      { kind: 'system', text: `Nothing ran, so ${a.name} is free for other work.` },
    ]);
    this.clearTask(a);
    this.save();
    if (!this.state.qa.includes(rec)) return;
    const key = prepKey(repo.id, rec.prNumber, task);
    const step = prepFailure(this.prepStrikes.get(key), rec.sessionFailures, task === 'fix' ? MAX_FIX_FAILURES : MAX_QA_FAILURES, Date.now());
    this.prepStrikes.set(key, step.strikes);
    const needsHuman = step.next === 'needs-human';
    this.setQa(rec, {
      ...(task === 'fix' ? { status: needsHuman ? 'needs-human' : 'failed', devAgentId: job.author } : { status: needsHuman ? 'needs-human' : 'queued', qaAgentId: null }),
      sessionFailures: step.sessionFailures,
      ...(needsHuman ? { mergeNote: "its desk couldn't be set up", stuckWhy: "its desk couldn't be set up", escalated: true } : {}), // no CEO tool fixes a desk: straight to the manager
    });
    if (step.next === 'retry') return;
    const what = task === 'fix' ? 'fix' : 'QA run';
    const why = `desks couldn't be set up for its ${what} twice in a row: ${error.slice(0, 240)}`;
    this.postMessage(
      'office',
      needsHuman
        ? `⚠️ PR #${rec.prNumber} on ${repo.fullName} needs you: ${why}`
        : `⚠️ PR #${rec.prNumber} on ${repo.fullName} waits ${Math.round(PREP_HOLD_MS / 60_000)} minutes before anyone tries its ${what} again: ${why}`,
    );
  }

  protected clearPrepStrikes(repoId: string, prNumber: number) {
    for (const task of ['fix', 'qa'] as const) this.prepStrikes.delete(prepKey(repoId, prNumber, task));
  }

  /** The desk's dependencies, shown on the agent's card ("Installing dependencies") while npm runs. */
  protected async installDeps(a: PersistedAgent, cwd: string, repo: PersistedRepo): Promise<DepsOutcome> {
    const rt = this.agentRt.get(a.id);
    const cb = {
      log: (lines: string[]) => this.appendLog(a, lines.map((text) => ({ kind: text.startsWith('⚠') ? 'error' : 'system', text }) as LogEntry)),
      installing: () => {
        if (!rt) return;
        rt.currentTool = INSTALL_STEP;
        this.emitAgent(a);
      },
    };
    try {
      // A cloud agent's dependencies are installed in their Box, outside this computer's install limit.
      return await (a.host === 'box' ? this.boxMachines.installDeps(this.machineOf(a), repo.fullName, cb) : this.backend.installDeps(cwd, cb));
    } finally {
      if (rt?.currentTool === INSTALL_STEP) {
        rt.currentTool = null;
        this.emitAgent(a);
      }
    }
  }

  protected async runTask(a: PersistedAgent, repo: PersistedRepo, issue: IssueInfo, note?: string) {
    const branch = devBranch(issue.number, slugify(a.name));
    this.beginTask(
      a,
      { task: 'issue', issueNumber: issue.number, issueTitle: issue.title, branch, prNumber: null, prUrl: null, sessionId: null },
      `Issue #${issue.number}: ${issue.title}`,
      `Preparing worktree on ${branch}…`,
    );
    // GitHub's word, not the last sync's: an issue closed since then isn't started.
    const live = await this.backend.issueState(repo.fullName, issue.number).catch(() => null);
    if (a.status !== 'preparing') return void this.abandoned(a);
    const rt = this.repoRt.get(repo.id);
    if (rt && !stillOpen({ kind: 'issue', number: issue.number }, this.floorState(rt), live)) {
      this.appendLog(a, [{ kind: 'system', text: `Issue #${issue.number} is closed; nothing to do.` }]);
      this.clearTask(a);
      this.learnIssueClosed(repo, issue.number);
      return;
    }
    const desk = await this.prepare(a, repo, {}, branch);
    if (!desk) return;
    const { cwd } = desk;

    const prompt = [
      `Please resolve GitHub issue #${issue.number}: ${issue.title}`,
      `URL: ${issue.url}`,
      issue.labels.length ? `Labels: ${issue.labels.join(', ')}` : '',
      '',
      issue.body?.trim() || '(The issue has no description.)',
      this.ceoFiles.issueLines(issue.body),
      note ? `\nNote from the manager: ${note}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    this.lab.assign(repo.id, issue);
    this.startAgentSession(a, repo, cwd, prompt, this.buildSystemAppend(a, repo, cwd, branch, undefined, desk.deps));
  }

  protected startAgentSession(
    a: PersistedAgent,
    repo: PersistedRepo,
    cwd: string,
    prompt: string,
    systemAppend: string,
    resumeSessionId?: string,
    outputSchema?: Record<string, unknown>,
    /** typed: the manager typed the prompt at the CLI; reattach: follow the CLI that kept working through a restart. */
    mode: 'typed' | 'reattach' | null = null,
  ) {
    const rt = this.agentRt.get(a.id);
    if (!rt || !this.state.agents.includes(a)) return; // let go meanwhile
    // A cloud agent's session runs in their Box: it's awake and set up, their linked repos fetched there, and their
    // credentials resolved first. (Following a CLI that kept working there needs none of that.)
    if (a.host === 'box' && mode !== 'reattach') {
      const cli = this.sessionRuntime(a, resumeSessionId).cli ?? 'claude';
      const note = (text: string) => this.appendLog(a, [{ kind: 'system', text }]);
      void this.boxTarget(a, cli, repo.browserTesting, mode !== 'typed')
        .then(async (box) => {
          const linked = await this.boxMachines.linkRepos(this.machineOf(a), this.linkedRepos(repo).map((r) => r.fullName), note).catch(() => []);
          this.launchSession(a, repo, cwd, prompt, systemAppend, resumeSessionId, outputSchema, mode, box, linked);
        })
        .catch((err) => {
          if (err instanceof SignInNeeded) return this.holdForSignIn(a, err.cli, () => this.startAgentSession(a, repo, cwd, prompt, systemAppend, resumeSessionId, outputSchema, mode));
          const why = redact(oneLine(err), this.secrets());
          this.appendLog(a, [{ kind: 'error', text: `✗ ${why}` }]);
          void this.onFinished(a, repo, { ok: false, text: '', costUsd: 0, turns: 0, errors: [why] });
        });
      return;
    }
    this.launchSession(a, repo, cwd, prompt, systemAppend, resumeSessionId, outputSchema, mode);
  }

  // ---------- the test lab (#56) ----------

  /** Agents' screenshots, browser checks and heavy commands, one shared browser for all. */
  readonly testLab = new TestLab({
    runner: () => this.backend.testLab,
    settings: () => this.state.settings.testLab,
    refusal: (kind) => this.health.refusal(kind),
    forbidden: () => [OFFICE_DIR, ...this.state.repos.map((r) => this.backend.mainDir(r.fullName))],
    previewUrl: (repoId, pr, agentId) => this.labPreviewUrl(repoId, pr, agentId),
    shot: (agentId, file, page) => this.labShot(agentId, file, page),
    emit: (testLab) => this.broadcast({ type: 'testLab', testLab }),
    updateGate: () => this.labGateNow(),
  });

  /** Running lab jobs, for #55's admission (health.ts). */
  protected labSessions() {
    return this.testLab.sessions();
  }

  protected labView() {
    return this.testLab.view();
  }

  protected closeTestLab(restart: boolean) {
    return this.testLab.close(restart);
  }

  /** Does this agent's session use the test lab? Claude Code on this computer (the lab's tools reach it over MCP). */
  protected usesTestLab(a: PersistedAgent, repo: PersistedRepo): boolean {
    return this.state.settings.testLab.enabled && repo.browserTesting && a.host !== 'box' && (a.cli || this.state.settings.defaultCli) === 'claude';
  }

  /** The lab's tools for one session, bound to its agent, floor and worktree. */
  protected labTools(a: PersistedAgent, repo: PersistedRepo, cwd: string) {
    const who = (): Requester => ({ agentId: a.id, agent: a.name, repoId: repo.id, floor: repo.floor, fullName: repo.fullName, defaultBranch: repo.defaultBranch, worktree: cwd, pr: a.prNumber ?? null, labCommands: repo.labCommands ?? [] });
    return createLabTools({ submit: (input) => this.testLab.submit(who(), input), status: () => this.testLab.status(a.id) });
  }

  /** The address of a floor's app for the lab: the PR's preview (the PR theatre's), else the floor's, started if need be. */
  protected async labPreviewUrl(repoId: string, pr: number | null, agentId: string): Promise<string> {
    const repo = this.repo(repoId);
    const now = () => (pr ? this.previews.prViews().find((v) => v.repoId === repoId && v.pr === pr) : this.previews.view(repo));
    const v = now();
    if (!v || v.status === 'stopped' || v.status === 'error') await (pr ? this.startPrPreview(repoId, pr) : this.startPreview(repoId));
    this.holdPreview(agentId, repoId, pr);
    for (const until = Date.now() + LAB_PREVIEW_MS; Date.now() < until; await new Promise((r) => setTimeout(r, 2000))) {
      this.previews.watch(LAB_VIEWER, repoId, pr); // kept up while the lab uses it; the theatre stops it once idle
      const x = now();
      if (x?.status === 'running' && x.url) return x.url;
      if (x?.status === 'error' || x?.status === 'unconfigured') throw new Error(`The ${pr ? `PR #${pr} ` : ''}preview didn't start: ${x.error ?? 'no command to run the app'}. Start your dev server and give its url instead.`);
    }
    throw new Error("The preview didn't start in 5 minutes: start your dev server and give its url instead.");
  }

  /** An agent's lab uses this preview: the manager can't stop, restart or evict it while their QA or fix session runs (#204). */
  protected holdPreview(agentId: string, repoId: string, pr: number | null) {
    const key = pr ? prKey(repoId, pr) : mainKey(repoId);
    if (this.previewHolds.get(key)?.agentId === agentId) return;
    this.previewHolds.set(key, { agentId, repoId, pr });
    this.previews.heldChanged(repoId, pr);
  }

  /** Every 5 s: previews nobody uses stop, and holds whose agent's QA or fix session ended let go (the views say so). */
  protected sweepPreviews() {
    this.previews.sweepPrs();
    for (const [key, { repoId, pr }] of this.previewHolds) {
      if (this.previewHolder(repoId, pr)) continue;
      this.previewHolds.delete(key);
      this.previews.heldChanged(repoId, pr);
    }
  }

  /** A screenshot the lab took for an agent: their screen in the office, and QA's evidence, as a Playwright one would. */
  protected labShot(agentId: string, file: string, page: string) {
    const a = this.state.agents.find((x) => x.id === agentId);
    if (a) void fs.readFile(file).then((data) => this.screenTaken(a, data, 'image/png', page), () => undefined);
  }

  /** page: the address the screenshot is of, when known; else their last known one stays (#230). */
  protected screenTaken(a: PersistedAgent, data: Buffer, mime: string, page?: string | null) {
    const rt = this.agentRt.get(a.id);
    if (!rt) return;
    const at = Date.now();
    rt.browserUrl = knownUrl(rt.browserUrl, page);
    rt.screenshot = { data, mime, at };
    rt.shots.push({ data, mime, url: rt.browserUrl, at });
    if (rt.shots.length > 12) rt.shots.shift();
    this.broadcast({ type: 'screen', agentId: a.id, url: rt.browserUrl, at, earlier: rt.shots.slice(-6, -1).map((s) => s.at) });
    void removeScreens(a.id)
      .then(() => fs.mkdir(SCREENS_DIR, { recursive: true }))
      .then(() => fs.writeFile(screenFile(a.id, mime), data))
      .catch((err) => console.warn('could not save screenshot', err));
  }

  // ---------- accounts (#247) ----------

  override snapshot(): WorldSnapshot {
    const accounts = this.accounts.view();
    return { ...super.snapshot(), accounts: { ...accounts, sources: this.usageSources(accounts.accounts) } };
  }

  protected override secrets(): string[] {
    return [...super.secrets(), ...this.accounts.secretValues()];
  }

  protected launchSession(
    a: PersistedAgent,
    repo: PersistedRepo,
    cwd: string,
    prompt: string,
    systemAppend: string,
    resumeSessionId: string | undefined,
    outputSchema: Record<string, unknown> | undefined,
    mode: 'typed' | 'reattach' | null,
    box?: BoxTarget,
    linked?: string[],
  ) {
    const rt = this.agentRt.get(a.id);
    if (!rt || !this.state.agents.includes(a)) return; // let go meanwhile
    // A session started in a folder that's gone dies at once (Windows exit 267): set the desk up again first. (A Box's
    // desk is taken to be there: looking would wake it.)
    if (a.host !== 'box' && sessionStart(this.backend.deskExists(cwd), mode) === 'prepare') {
      const machine = a.machine;
      // An agent who moved to their machine meanwhile can't resume a session from their old desk (machineOf).
      void this.restoreDesk(a, repo).then((dir) => dir && this.startAgentSession(a, repo, dir, prompt, systemAppend, a.machine === machine ? resumeSessionId : undefined, outputSchema, mode));
      return;
    }
    a.status = 'working';
    rt.acrossRestart = mode === 'reattach'; // its CLI kept working through an office restart (#333)
    this.activity.set(a.id, Date.now());
    this.dropQuestion(a.id); // they moved on
    const how = this.sessionRuntime(a, resumeSessionId);
    const testLab = !box && this.usesTestLab(a, repo);
    const kind = this.taskKind(a);
    const lab = this.lab.practice(repo.id, a.issueNumber ?? this.prRecord(a)?.issueNumber, a.prNumber, kind); // an experiment's variant wins over every default
    const practice = this.practicePrompt(a, repo, how.cli);
    const rec = a.task === 'fix' ? this.prRecord(a) : undefined;
    // A conflict-only fix on the cheaper model (#256): Claude Code only, and never over an experiment's own model.
    const cheap = rec?.cheapFix && (how.cli ?? 'claude') === 'claude' && !lab.model && !lab.effort ? rec.cheapFix : null;
    if (rec && rec.cheapFix && !cheap) rec.cheapFix = null;
    const model = cheap ? cheap.model : lab.model && (how.cli ?? 'claude') === 'claude' ? lab.model : this.modelFor(a, how.cli);
    const system = [systemAppend, practice.text, lab.prompt].filter(Boolean).join('\n\n');
    const known = officeParts({ system, prompt, officePlaybook: this.state.settings.officePlaybook, playbook: repo.playbook, qaBrief: repo.qaBrief });
    const run = this.spend.start(a.id, { kind, effort: (cheap?.effort || lab.effort) ?? resolveEffort(a.effort, kind, this.state.settings.taskEffort, this.state.settings.defaultEffort), model, cheap: !!cheap, startedAt: Date.now(), round: a.task === 'qa' ? (this.prRecord(a)?.round ?? null) : null, cause: a.task === 'fix' ? fixCause(rec) : null, exp: lab.tag, known, cwd, sessionId: resumeSessionId ?? null, title: a.issueTitle ?? '' });
    this.emitAgent(a);
    this.chatOf(a)?.session(); // its first prompt is their chat's task card
    const active = (entries: LogEntry[]) => {
      if (entries.some((e) => e.kind !== 'manager')) this.activity.set(a.id, Date.now());
    };
    // The demo's QA tests in its PR's preview, as a real one's lab would (#204): the app viewer shows it held.
    if (this.backend.demo && testLab && a.task === 'qa' && a.prNumber) void this.labPreviewUrl(repo.id, a.prNumber, a.id).catch(() => undefined);
    rt.session = this.startOnAccount(
      a,
      {
        cwd,
        prompt,
        systemAppend: system,
        model: run.model,
        effort: run.effort,
        // A session on the test lab (#56) gets its lab_* tools instead of a browser of its own.
        browserTesting: repo.browserTesting && !testLab,
        ...(testLab ? { office: this.labTools(a, repo, cwd) } : {}),
        additionalDirectories: linked ?? (a.host === 'box' ? [] : this.linkedRepos(repo).map((r) => this.backend.mainDir(r.fullName))),
        role: a.role,
        task: a.task,
        // On this computer a demo office the agent starts takes their own ports, never the live office's (#227).
        env: a.host === 'box' ? this.machineEnv(a) : { ...agentPortEnv(this.port(a)), ...this.machineEnv(a) },
        outputSchema,
        ...(box ? { box } : {}),
        // An agent's CLI stays at its prompt after building or fixing, for the manager and for follow-ups; after QA it
        // closes, so the next QA run of that PR is a fresh session.
        keepAlive: a.task !== 'qa',
        typed: mode === 'typed',
        reattach: mode === 'reattach',
        agentId: a.id,
        ...(practice.office ? { office: practice.office } : {}),
        tools: this.sessionToolsFor(a, how.cli, lab.toolsOff),
        mcpServers: this.providers.mcpFor(a.id),
        ...how,
      },
      {
        log: (entries) => {
          active(entries);
          this.appendLog(a, entries);
        },
        tool: (name) => {
          this.activity.set(a.id, Date.now());
          if (rt.currentTool === name) return;
          rt.currentTool = name;
          this.emitAgent(a);
        },
        chat: (events) => this.chatEvents(a, events, cwd),
        sessionId: (id) => {
          a.sessionId = id;
          a.sessionCli = id ? (how.cli ?? 'claude') : null;
          if (id) run.sessionId = id;
        },
        browserUrl: (url) => {
          rt.browserUrl = url;
          this.emitAgent(a);
        },
        screenshot: (data, mime) => this.screenTaken(a, data, mime),
        limited: (at) => this.pauseForLimit(at),
        usageWarning: (info) => this.paceForWarning(info),
        usage: (readings) => this.recordUsage(readings),
        startup: (st) => this.spend.startup(a.id, st.tokens, st.memoryChars),
        blocked: (reason) => { rt.blocked = reason ? { reason, since: Date.now(), told: false } : null; this.emitAgent(a); },
        finished: (result) => {
          // A cloud agent's CLI whose login expired: the task carries on (the same conversation) once it's signed in again.
          const again = () => this.startAgentSession(a, repo, cwd, a.sessionId ? SIGNED_IN_AGAIN : prompt, systemAppend, a.sessionId ?? undefined, outputSchema, null);
          if (a.host === 'box' && (result.signedOut || result.keyTrouble)) void this.signedOutMidTask(a, repo, result, how.cli ?? 'claude', again);
          else void this.onFinished(a, repo, result);
        },
      },
    );
  }

  /**
   * A cloud agent's session that ended because their CLI's login is gone (cliRunner's signedOut), or the office's API
   * key it ran on ran out of credit or was turned away (keyTrouble, #258): either way the task waits for a sign-in,
   * with no round counted.
   */
  protected async signedOutMidTask(a: PersistedAgent, repo: PersistedRepo, result: SessionResult, cli: AgentCli, again: () => void) {
    const rt = this.agentRt.get(a.id);
    if (!rt || !this.state.agents.includes(a)) return;
    const creds = !boxCli(cli) ? null : await this.cloud.credentials(cli, !!a.ownLogin).catch(() => null);
    const keyStopped = !!creds?.onKey;
    if (!boxCli(cli) || !(creds?.ownLogin || keyStopped) || a.status === 'stopped' || this.dropping.has(a.id) || a.host !== 'box') {
      // A key from Settings that was turned away has nothing to sign in here: the session failed like any other.
      const errors = creds && !creds.ownLogin ? [`${cliLabel(cli)} turned the key it was given away: check it in Settings → Cloud agents.`] : result.errors;
      return this.onFinished(a, repo, { ...result, errors });
    }
    if (this.silenced.delete(a.id)) return; // the demo's pretend restart cut it off: reconciled like after a real one
    rt.session = null;
    rt.currentTool = null;
    const turn = this.spend.perTurn(a.id, this.spend.sid(a.id), result);
    a.costUsd += turn.costUsd;
    a.turns += result.turns;
    recordCost(this.state.ops, repo.id, turn.costUsd, Date.now());
    void this.spend.record(a, repo.id, this.spend.take(a.id), this.taskKind(a), { ...turn, ok: false }, { stopped: false });
    if (keyStopped) {
      // Off the key onto their own login: straight back to work if their Box is signed in already, else the guided steps.
      this.keyStopped(a, cli, result.keyTrouble ?? 'invalid');
      if ((await this.boxMachines.signedIn(this.machineOf(a), cli).catch(() => null)) === true) return again();
      return this.holdForSignIn(a, cli, again);
    }
    // The login its servers turned away is forgotten, so the Box reads as signed out until the manager signs it in again.
    await this.boxMachines.signOut(this.machineOf(a), cli).catch(() => undefined);
    this.holdForSignIn(a, cli, again, true);
  }

  protected taskKind = (a: PersistedAgent) => taskKindOf(a.task, this.prRecord(a)?.fixReason);
  protected prRecord = (a: PersistedAgent) => (a.prNumber === null ? undefined : this.state.qa.find((q) => q.repoId === a.repoId && q.prNumber === a.prNumber));

  /** GET /api/costs: the usage view over the last `days` days, for one floor or all of them. */
  costsView(days: unknown, repoId: unknown): CostsView {
    return costsRequest(this.spend.ledger.all(), days, repoId, (id) => this.state.repos.some((r) => r.id === id));
  }

  protected async onFinished(a: PersistedAgent, repo: PersistedRepo, ran: SessionResult) {
    const rt = this.agentRt.get(a.id);
    if (!rt || !this.state.agents.includes(a)) return; // fired
    if (this.officeUpdate.cutOff.has(a.id)) return; // stopped for the office's update: recovered like after a restart
    if (this.silenced.delete(a.id)) return; // the demo's pretend restart cut it off: reconciled like after a real one
    rt.session = null;
    rt.currentTool = rt.blocked = null;
    const run = this.spend.take(a.id);
    const result = this.spend.perTurn(a.id, run?.sessionId, ran); // a CLI kept or resumed across runs reports a running total (#254)
    a.endedAt = Date.now();
    a.costUsd += result.costUsd;
    a.turns += result.turns;
    recordCost(this.state.ops, repo.id, result.costUsd, a.endedAt);
    if (a.host === 'box' && a.startedAt) recordBox(this.state.ops, repo.id, a.endedAt - a.startedAt, BOX_SIZE_INFO[this.state.settings.cloud.boxSize].usdPerCpuHour, a.endedAt); // Mission control's cloud today (#260)
    this.ledger({ kind: 'session', agentId: a.id, key: `${a.id}:${a.startedAt}:${a.endedAt}`, costUsd: result.costUsd, turns: result.turns }, false); // emitted below
    // Dev servers (or a demo office) the agent forgot to stop would otherwise keep its ports and lock its desk folder.
    void this.releaseDesk(a, repo)
      .then((busy) => {
        if (busy.length) this.appendLog(a, [{ kind: 'system', text: `⚠ Port${busy.length > 1 ? 's' : ''} ${busy.join(', ')} still in use after the session's clean-up.` }]);
      })
      .catch(() => undefined);
    if (result.interrupted) this.interrupted(a);
    const killed = this.health.ended(a, sessionKind(a), result.errors, !this.dropping.has(a.id) && a.status !== 'stopped', resumesAfterRestart(a, false, this.backend.demo));
    const ledger = { issue: a.issueNumber, pr: a.prNumber, stopped: a.status === 'stopped' || !!killed };

    if (killed) Object.assign(a, { status: 'stopped', lastError: killed });
    else if (result.signedOut && a.host !== 'box' && a.status !== 'stopped' && !this.dropping.has(a.id)) {
      // It opened on its CLI's sign-in (#360): no strike, the work goes back in line for an account that's signed in.
      a.status = 'idle';
      this.requeue(a, `${result.errors[0] ?? 'their coding agent needs signing in'}`.replace(/\.$/, ''));
    } else if (this.dropping.has(a.id)) this.dropTask(a, '↺ Cleared desk. Ready for new work.'); // stopped: its issue or PR closed
    else if (a.task === 'qa') await this.onQaFinished(a, repo, result);
    else if (a.task === 'fix') await this.onFixFinished(a, repo, result);
    else await this.onIssueFinished(a, repo, result);
    // The task's handler has run, so its outcome hint is in.
    void this.spend.record({ ...a, issueNumber: a.issueNumber ?? ledger.issue, prNumber: a.prNumber ?? ledger.pr }, repo.id, run, this.taskKind(a), result, ledger);

    this.emitAgent(a);
    this.save();
    this.applyTeamChanges();
    void this.syncRepo(repo.id);
    setTimeout(() => this.schedule(), 500);
  }

  protected minutes(a: PersistedAgent) {
    return a.startedAt && a.endedAt ? Math.max(1, Math.round((a.endedAt - a.startedAt) / 60000)) : 0;
  }

  protected fail(a: PersistedAgent, result: SessionResult, what: string) {
    a.status = 'error';
    a.lastError = result.errors.join('; ') || 'Session failed';
    this.appendLog(a, [{ kind: 'error', text: `✗ ${a.lastError}` }]);
    this.notice({ kind: 'error', title: `${a.name} hit a problem`, text: `On ${what}: ${a.lastError.slice(0, 120)}`, target: { kind: 'agent', agentId: a.id, terminal: true }, actions: ['terminal', 'retry'] });
  }

  protected async onIssueFinished(a: PersistedAgent, repo: PersistedRepo, result: SessionResult) {
    const escaped = repo.fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = result.text.match(new RegExp(`https://github\\.com/${escaped}/pull/(\\d+)`, 'i'));
    if (m) {
      a.prNumber = Number(m[1]);
      a.prUrl = m[0];
    } else if (a.branch) {
      const pr = await this.backend.prForBranch(repo.fullName, a.branch).catch(() => null);
      if (pr) {
        a.prNumber = pr.number;
        a.prUrl = pr.url;
      }
    }

    if (a.status === 'stopped') return; // the manager already logged the stop
    if (!result.ok) {
      this.issueFailed(repo, a.issueNumber);
      return this.fail(a, result, `#${a.issueNumber}`);
    }
    this.issueFailures.delete(`${repo.id}#${a.issueNumber}`);
    a.status = 'done';
    this.spend.outcome(a.id, a.prNumber ? 'pr' : 'no-pr');
    if (a.prNumber) this.ledger({ kind: 'opened', repoId: repo.id, pr: a.prNumber, title: a.issueTitle ?? '', author: a.id, at: Date.now(), took: a.startedAt ? Date.now() - a.startedAt : undefined }, false);
    this.appendLog(a, [{ kind: 'done', text: `✔ Finished in ${this.minutes(a)}m · ${a.turns} turns${a.prNumber ? ` · PR #${a.prNumber}` : ' · no PR found'}` }]);
    const failedEarly = a.prNumber ? this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === a.prNumber && q.status === 'failed') : undefined;
    if (failedEarly) {
      // QA failed the PR while this session was still going (#199): the fix was kept for them, and resumes this session.
      this.setQa(failedEarly, { devAgentId: a.id, devSessionId: a.sessionId ?? failedEarly.devSessionId });
      this.appendLog(a, [{ kind: 'system', text: `📨 QA already failed PR #${a.prNumber}; fixing it is next.` }]);
    } else if (a.prNumber) {
      this.queueQa(repo, a.prNumber, a, a.issueNumber);
      this.appendLog(a, [{ kind: 'system', text: `📨 Handed PR #${a.prNumber} to QA.` }]);
      this.toast('success', `${a.name} opened PR #${a.prNumber} for #${a.issueNumber}; it's off to QA`);
    } else if (!this.ask(a, repo, result.text)) {
      this.noPullRequest(a, repo);
    }
  }

  /**
   * An issue session ended without a PR, which would leave the issue "taken" with nobody on it. The same developer,
   * who has the context and the worktree, is asked once to finish; after that the issue goes back on the board.
   */
  protected noPullRequest(a: PersistedAgent, repo: PersistedRepo) {
    const key = `${repo.id}#${a.issueNumber}`;
    if (this.nudged.has(key)) return this.releaseIssue(a, repo);
    this.nudged.add(key);
    // message() starts the session before its first await, so the scheduler can't hand this developer other work first.
    void this.message(
      a.id,
      `You finished without opening a pull request for #${a.issueNumber}. Finish the remaining steps now: commit, push your branch and open the PR with "Closes #${a.issueNumber}". If the issue can't be done, open a draft PR that explains why.`,
    ).catch(() => this.releaseIssue(a, repo));
  }

  protected releaseIssue(a: PersistedAgent, repo: PersistedRepo) {
    const n = a.issueNumber;
    this.clearTask(a);
    this.postMessage('office', `⚠️ ${a.name} finished #${n} on ${repo.fullName} without opening a pull request, so it's back on the board for anyone.`);
  }
  protected issueFailures = new Map<string, number>(); // `${repoId}#${issue}` → failed sessions on it
  protected nudged = new Set<string>(); // `${repoId}#${issue}`: its agent was asked once to finish the missing PR

  // ---------- the watchdog and the office doctor (#262) ----------

  protected activity = new Map<string, number>(); // agent id -> their session's latest output or tool activity
  protected silenced = new Set<string>(); // sessions the demo's pretend restart cut off: their end is ignored
}
