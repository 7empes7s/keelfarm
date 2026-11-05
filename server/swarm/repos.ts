// Floors and their repos: connecting projects, syncing issues and PRs, the floor's app and PR previews, manager commands on GitHub.
import path from 'node:path';
import { checkCloseIssue } from '../ceo.ts';
import { HttpError } from '../httpError.ts';
import { DEFAULT_PREVIEW, parsePreviewPatch } from '../previews.ts';
import { qaShotsDir, readQaShot, removeQaShots } from '../qaShots.ts';
import { clip } from '../notify.ts';
import { unblockedIssues } from '../../shared/followups.ts';
import { charterMarkdown, charterOf, cleanCharter, isEmptyCharter, MISSION_MAX, newRecord, noteObjectives, withChange } from '../../shared/charter.ts';
import { PLAYBOOK_MAX } from '../../shared/types.ts';
import type { Charter, PreviewView, PrPreviewView, ProjectFolderView, PullInfo, RepoView } from '../../shared/types.ts';
import { type PersistedRepo, type FloorOptions, QA_SHOTS_DIR } from './model.ts';
import { FLOOR_COLORS } from './flavour.ts';
import { SwarmCore } from './core.ts';

export abstract class SwarmRepos extends SwarmCore {
  // ---------- GitHub / repos ----------

  listGithubRepos(owner?: string) {
    return this.backend.listMyRepos(owner);
  }

  /**
   * Give a GitHub repo a floor. Its main checkout is one of your own folders: the one you picked, else the folder in
   * your projects folder that already has it as origin, else a fresh clone into your projects folder.
   */
  async connectRepo(fullName: string, opts: FloorOptions & { localPath?: string } = {}): Promise<RepoView> {
    const existing = this.state.repos.find((r) => r.id.toLowerCase() === fullName.toLowerCase());
    if (existing) throw new HttpError(409, `${fullName} is already floor ${existing.floor}`);
    const meta = await this.backend.repoMeta(fullName);
    const folder = opts.localPath ?? (await this.projectFolderFor(meta.nameWithOwner));
    const floor = this.state.repos.reduce((m, r) => Math.max(m, r.floor), 0) + 1;
    const repo: PersistedRepo = {
      id: meta.nameWithOwner,
      fullName: meta.nameWithOwner,
      description: meta.description,
      url: meta.url,
      defaultBranch: meta.defaultBranch,
      floor,
      color: FLOOR_COLORS[(floor - 1) % FLOOR_COLORS.length],
      autoAssign: !!opts.autoAssign,
      autoMerge: true,
      browserTesting: true,
      links: [],
      localPath: folder,
      mission: (opts.mission ?? '').trim().slice(0, MISSION_MAX),
      summary: '',
      qaBrief: '',
      playbook: '',
      preview: { ...DEFAULT_PREVIEW, env: {} },
      addedAt: Date.now(),
      charter: newRecord(),
    };
    this.backend.setLocalPath(repo.fullName, folder);
    this.state.repos.push(repo);
    this.repoRt.set(repo.id, { issues: [], pulls: [], lastSync: null, syncing: false, cloneStatus: 'pending', lastMergedAt: null, folderSync: null, merging: false, closedIssues: new Map(), closedPulls: new Map(), openAt: new Map() });
    this.save();
    this.emitRepo(repo);
    this.toast('success', `${repo.fullName} moved into floor ${floor}`);
    this.ensureAgent(repo);
    void this.cloneRepo(repo.id);
    void this.syncRepo(repo.id);
    // The CEO studies every new floor and sizes its team; a brief given here is the manager asking for a plan.
    this.enqueueCeo({ kind: 'onboard', repoId: repo.id, at: Date.now() });
    if (repo.mission) this.enqueueCeo({ kind: 'plan', repoId: repo.id, at: Date.now() });
    return this.repoView(repo);
  }

  /** Where a GitHub repo's checkout goes when you connect it without picking a folder. */
  protected async projectFolderFor(fullName: string): Promise<string> {
    const root = this.state.settings.projectsDir;
    const folders = await this.backend.scanProjects(root).catch(() => []);
    const match = folders.find((f) => f.github?.toLowerCase() === fullName.toLowerCase());
    if (match) return match.path;
    const name = fullName.split('/')[1];
    const taken = folders.find((f) => f.name.toLowerCase() === name.toLowerCase());
    if (taken) throw new HttpError(409, `${taken.path} already exists and isn't a clone of ${fullName}. Connect that folder instead, or rename it first.`);
    return path.join(root, name); // cloned there when the floor opens
  }

  /** A brand-new project: a folder in your projects folder, pushed to a new GitHub repo. */
  async createRepo(name: string, opts: FloorOptions & { description?: string; visibility: 'private' | 'public'; owner?: string }) {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new HttpError(400, 'Project names may only contain letters, numbers, ".", "-" and "_"');
    const created = await this.backend.createProject(this.state.settings.projectsDir, name, opts).catch((err: Error) => {
      throw new HttpError(400, err.message);
    });
    return this.connectRepo(created.fullName, { mission: opts.mission, autoAssign: opts.autoAssign, localPath: created.path });
  }

  /** The folders in your projects folder (or another folder you point at), and which are floors already. */
  async listProjectFolders(dir?: string): Promise<{ root: string; folders: ProjectFolderView[] }> {
    const root = dir?.trim() ? path.resolve(dir.trim()) : this.state.settings.projectsDir;
    const folders = await this.backend.scanProjects(root).catch((err: Error) => {
      throw new HttpError(400, err.message);
    });
    const same = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
    const floorOf = (f: { path: string; github: string | null }) =>
      this.state.repos.find((r) => (r.localPath && same(r.localPath, f.path)) || (f.github && r.id.toLowerCase() === f.github.toLowerCase()))?.floor ?? null;
    return { root, folders: folders.map((f) => ({ name: f.name, path: f.path, git: f.git, github: f.github, floor: floorOf(f) })) };
  }

  /** Give one of your folders a floor. It must already be on GitHub; otherwise publish it first. */
  async connectFolder(dir: string, opts: FloorOptions = {}) {
    const f = await this.backend.inspectFolder(dir).catch((err: Error) => {
      throw new HttpError(400, err.message);
    });
    if (!f.github) throw new HttpError(400, `${f.name} ${f.git ? "isn't on GitHub yet" : "isn't a git repository yet"}. Publish it to GitHub first.`);
    return this.connectRepo(f.github, { ...opts, localPath: f.path });
  }

  /** Put one of your folders on GitHub (only what's committed goes up), then give it a floor. */
  async publishFolder(dir: string, opts: FloorOptions & { name?: string; visibility: 'private' | 'public'; description?: string }) {
    const f = await this.backend.inspectFolder(dir).catch((err: Error) => {
      throw new HttpError(400, err.message);
    });
    const name = (opts.name?.trim() || f.name).replace(/[^A-Za-z0-9._-]+/g, '-');
    const fullName = await this.backend.publishFolder(f.path, { name, visibility: opts.visibility, description: opts.description }).catch((err: Error) => {
      throw new HttpError(400, err.message);
    });
    return this.connectRepo(fullName, { mission: opts.mission, autoAssign: opts.autoAssign, localPath: f.path });
  }

  disconnectRepo(id: string) {
    const repo = this.repo(id);
    this.state.ceo.queue = this.state.ceo.queue.filter((j) => j.repoId !== id);
    for (const r of this.state.requests.filter((x) => x.repoId === id && x.status === 'pending')) {
      this.decide(r, { status: 'rejected', note: 'The floor was disconnected.', decidedBy: null });
    }
    for (const a of this.state.agents.filter((x) => x.repoId === id)) this.fireAgent(a.id, true);
    void this.previews.remove({ ...repo });
    this.state.repos = this.state.repos.filter((r) => r.id !== id);
    for (const q of this.state.qa.filter((x) => x.repoId === id)) {
      this.broadcast({ type: 'qaRemoved', repoId: id, prNumber: q.prNumber });
      void removeQaShots(qaShotsDir(QA_SHOTS_DIR, id, q.prNumber)).catch(() => undefined);
    }
    this.state.qa = this.state.qa.filter((q) => q.repoId !== id);
    this.state.held = this.state.held.filter((h) => h.repoId !== id);
    delete this.state.pong[id];
    for (const r of this.state.repos) r.links = r.links.filter((l) => l !== id);
    this.repoRt.delete(id);
    // Keep floors contiguous.
    this.state.repos.sort((a, b) => a.floor - b.floor).forEach((r, i) => (r.floor = i + 1));
    this.backend.setLocalPath(repo.fullName, null);
    this.save();
    this.broadcast({ type: 'repoRemoved', repoId: id });
    for (const r of this.state.repos) this.emitRepo(r);
    this.toast('info', repo.localPath ? `${repo.fullName} left the building. Your folder ${repo.localPath} is untouched.` : `${repo.fullName} disconnected (its clone stays on disk)`);
  }

  updateRepo(
    id: string,
    patch: Partial<Pick<PersistedRepo, 'autoAssign' | 'autoMerge' | 'browserTesting' | 'color' | 'links' | 'mission' | 'summary' | 'qaBrief' | 'playbook'>> & { previewCommand?: unknown; previewEnv?: unknown },
  ) {
    const repo = this.repo(id);
    const preview = parsePreviewPatch(patch.previewCommand, patch.previewEnv);
    repo.preview = { ...repo.preview, ...preview };
    if (preview.command === null) void this.previews.refreshDefault(repo);
    if (patch.autoAssign !== undefined) repo.autoAssign = !!patch.autoAssign;
    if (patch.autoMerge !== undefined) {
      repo.autoMerge = !!patch.autoMerge;
      if (repo.autoMerge) void this.syncRepo(repo.id);
    }
    if (patch.browserTesting !== undefined) repo.browserTesting = !!patch.browserTesting;
    if (patch.color && /^#[0-9a-f]{6}$/i.test(patch.color)) repo.color = patch.color;
    if (Array.isArray(patch.links)) repo.links = patch.links.filter((l) => l !== id && this.state.repos.some((r) => r.id === l));
    if (typeof patch.mission === 'string') this.applyCharter(repo, { ...charterOf(repo.mission, repo.charter), mission: patch.mission.trim().slice(0, MISSION_MAX) }, this.managerLabel(), 'brief edited');
    if (typeof patch.summary === 'string') repo.summary = patch.summary.trim().slice(0, 140);
    if (typeof patch.qaBrief === 'string') repo.qaBrief = patch.qaBrief.trim().slice(0, 2500);
    if (typeof patch.playbook === 'string') repo.playbook = patch.playbook.trim().slice(0, PLAYBOOK_MAX);
    this.save();
    this.emitRepo(repo);
    setTimeout(() => this.schedule(), 200);
    return this.repoView(repo);
  }

  // ---------- the charter (#48) ----------

  protected managerLabel() {
    return this.state.settings.managerName || 'The manager';
  }

  /** Make `next` the floor's charter, with a line in its history when a part changed. */
  protected applyCharter(repo: PersistedRepo, next: Charter, by: string, note: string) {
    repo.charter.history = withChange(repo.charter.history, charterOf(repo.mission, repo.charter), next, by, clip(note, 240), Date.now());
    repo.mission = next.mission;
    Object.assign(repo.charter, { objectives: next.objectives, standards: next.standards, nonGoals: next.nonGoals, focus: next.focus });
  }

  /** The manager's edit in the Charter screen. */
  setCharter(id: string, raw: unknown): RepoView {
    const repo = this.repo(id);
    this.applyCharter(repo, cleanCharter(raw), this.managerLabel(), 'edited');
    this.save();
    this.emitRepo(repo);
    return this.repoView(repo);
  }

  /** The manager approves the CEO's proposal (as it is, or as they edited it: `edited`), or dismisses it. */
  decideCharter(id: string, approve: boolean, edited?: unknown): RepoView {
    const repo = this.repo(id);
    const p = repo.charter.proposal;
    if (!p) throw new HttpError(409, 'There is no charter proposal on this floor any more.');
    repo.charter.proposal = null;
    if (approve) {
      const next = edited === undefined ? p.charter : cleanCharter(edited);
      const changed = JSON.stringify(next) !== JSON.stringify(p.charter);
      this.applyCharter(repo, next, `${p.by}, approved by ${this.managerLabel()}`, changed ? `edited, then approved: ${p.reason}` : p.reason);
    }
    this.save();
    this.emitRepo(repo);
    return this.repoView(repo);
  }

  /** Export: the full charter as docs/CHARTER.md, on a pull request the manager merges. */
  async exportCharter(id: string): Promise<{ url: string }> {
    const repo = this.repo(id);
    const c = charterOf(repo.mission, repo.charter);
    if (isEmptyCharter(c)) throw new HttpError(400, 'The charter is empty: write it first.');
    const url = await this.backend.exportCharter(repo.fullName, repo.defaultBranch, charterMarkdown(c, repo.fullName));
    this.toast('success', `docs/CHARTER.md is ready to merge on ${repo.fullName}`);
    return { url };
  }

  // ---------- the floor's app (preview monitor) ----------

  /** Run the floor's app from its preview worktree: the default branch, or an open PR. Replaces what it is running now. */
  async startPreview(id: string, pr?: number | null): Promise<PreviewView> {
    const repo = this.repo(id);
    this.health.ensure('preview');
    return this.previews.start(repo, `${repo.fullName.split('/')[1]} app`, pr);
  }

  stopPreview(id: string): Promise<PreviewView> {
    return this.previews.stop(this.repo(id));
  }

  /** The PR theatre: run an open PR beside the floor's main preview (kept when it's already up, unless restart). */
  startPrPreview(id: string, pr: number, restart = false): Promise<PrPreviewView> {
    const repo = this.repo(id);
    return this.previews.startPr(repo, pr, `${repo.fullName.split('/')[1]} app`, restart);
  }

  stopPrPreview(id: string, pr: number): Promise<void> {
    return this.previews.stopPr(this.repo(id), pr);
  }

  /** An open app viewer's heartbeat: the PR preview it has on screen (null: none). */
  watchPreview(viewer: string, repoId: string | null, pr: number | null) {
    if (repoId) this.repo(repoId);
    this.previews.watch(viewer, repoId, pr);
  }

  /** The address of a sync proxy in front of the floor's app (pr null) or a PR preview, for compare mode's synced scrolling. */
  async previewSyncUrl(id: string, pr: number | null): Promise<{ url: string }> {
    return { url: await this.previews.syncUrl(this.repo(id), pr) };
  }

  /** Whether the preview gateway may pass requests on to `port` (a preview's or a sync proxy's). */
  previewProxied(port: number): boolean {
    return this.previews.proxied(port);
  }

  /** One of QA's screenshots from a PR's latest round. */
  async qaShot(repoId: string, pr: number, index: number): Promise<{ data: Buffer; mime: string } | null> {
    const shot = this.state.qa.find((q) => q.repoId === repoId && q.prNumber === pr)?.shots?.[index];
    if (!shot) return null;
    const data = await readQaShot(qaShotsDir(QA_SHOTS_DIR, repoId, pr), index, shot.mime);
    return data && { data, mime: shot.mime };
  }

  /**
   * Server shutdown: stop every floor's app so nothing is left holding a preview port. Agents' CLIs keep working
   * through a restart (the terminal keeper holds them for the next start) and stop when the office quits.
   */
  async shutdown(restart = false): Promise<void> {
    this.backend.cloud.detach(); // cloud agents' CLIs carry on in their Boxes: their records are final from here
    await this.writeState().catch((err) => console.warn('could not save the state', err));
    await this.journal.close().catch((err) => console.warn('could not write the journal', err));
    await this.telegram.stop();
    await this.backend.releaseClis(restart); // before the terminals are saved: whatever they print next waits in the keeper
    await this.saveTerminals(true);
    await this.previews.stopAll(this.state.repos);
  }

  protected async cloneRepo(id: string) {
    const repo = this.state.repos.find((r) => r.id === id);
    const rt = this.repoRt.get(id);
    if (!repo || !rt || rt.cloneStatus === 'cloning') return;
    rt.cloneStatus = 'cloning';
    rt.cloneError = undefined;
    this.emitRepo(repo);
    try {
      await this.backend.ensureClone(repo.fullName);
      rt.cloneStatus = 'ready';
      void this.previews.refreshDefault(repo);
      void this.sweepFloor(id);
    } catch (err) {
      rt.cloneStatus = 'error';
      rt.cloneError = (err as Error).message;
      this.toast('error', `Could not clone ${repo.fullName}: ${rt.cloneError}`);
    }
    if (this.repoRt.has(id)) this.emitRepo(repo);
  }

  async syncRepo(id: string) {
    const repo = this.state.repos.find((r) => r.id === id);
    const rt = this.repoRt.get(id);
    if (!repo || !rt || rt.syncing) return;
    rt.syncing = true;
    try {
      const started = Date.now();
      const [issues, pulls] = await Promise.all([this.backend.listIssues(repo.fullName), this.backend.listPulls(repo.fullName)]);
      const before = rt.lastSync != null ? rt.issues : null;
      rt.issues = issues;
      for (const i of before ? unblockedIssues(before, issues) : []) {
        this.followup({ kind: 'unblocked', key: `unblocked:${repo.id}#${i.number}`, label: `#${i.number} unblocked`, text: `#${i.number} "${clip(i.title, 100)}" on ${this.floorName(repo)} can start: what it waited for has closed.`, repoId: repo.id });
      }
      rt.pulls = pulls;
      if (noteObjectives(repo.charter.log, issues, pulls, Date.now())) this.save();
      this.issueAges.learn(repo.id, issues);
      this.issueAges.stamp(repo.id, pulls);
      void this.lookUpIssueAges(repo);
      rt.lastSync = Date.now();
      rt.fetchedAt = started;
      rt.syncError = undefined;
      await this.askGitHub(repo, rt);
      if (!this.repoRt.has(id)) return; // disconnected meanwhile
      this.settleLearned(rt);
      this.ledgerPulls(repo, rt.pulls); // while the QA records still say who wrote what
      this.cleanUpClosed(repo);
      this.recordSync(repo, rt.pulls);
      this.reconcilePulls(repo, rt.pulls);
      // Something was merged since the last look (by the office or anyone else): bring the folder up to date.
      const newest = pulls.reduce<string | null>((m, p) => (p.mergedAt && (!m || p.mergedAt > m) ? p.mergedAt : m), null);
      if (newest !== rt.lastMergedAt) {
        rt.lastMergedAt = newest;
        void this.syncFolder(repo);
      }
      void this.advanceMerges(repo);
    } catch (err) {
      rt.syncError = (err as Error).message;
    } finally {
      rt.syncing = false;
    }
    if (this.repoRt.has(id)) this.emitRepo(repo);
  }

  /** When the issues behind the day's merges were filed, if the office never saw them open (e.g. after a restart). */
  protected async lookUpIssueAges(repo: PersistedRepo) {
    const wanted = this.issueAges.wanted(repo.id, this.repoRt.get(repo.id)?.pulls ?? [], Date.now());
    if (!wanted.length) return;
    for (const n of wanted) this.issueAges.know(repo.id, n, (await this.backend.issueDetails(repo.fullName, n).catch(() => null))?.createdAt);
    const rt = this.repoRt.get(repo.id);
    if (!rt) return;
    this.issueAges.stamp(repo.id, rt.pulls);
    this.emitRepo(repo);
  }

  /** Tell the ledger what a sync saw: open PRs (and their checks), merges, and which PRs went away. */
  protected ledgerPulls(repo: PersistedRepo, pulls: PullInfo[]) {
    const now = Date.now();
    for (const pr of pulls) {
      if (pr.state === 'OPEN') this.ledger({ kind: 'pr-open', repoId: repo.id, pr: pr.number, title: pr.title, author: this.prAuthor(repo, pr), checks: pr.checks, at: now });
      else if (pr.state === 'MERGED') {
        const at = pr.mergedAt ? Date.parse(pr.mergedAt) : now;
        this.ledger({ kind: 'merged', repoId: repo.id, repoName: repo.fullName, pr: pr.number, title: pr.title, author: this.prAuthor(repo, pr), at: Number.isFinite(at) ? Math.min(at, now) : now });
      }
    }
    this.ledger({ kind: 'listed', repoId: repo.id, numbers: pulls.map((p) => p.number), at: now });
  }

  /**
   * Every swarm PR goes through QA, including ones opened before QA existed or while the server was down. (Merged and
   * closed PRs leave QA, and agents who had them are cleared, in cleanUpClosed.)
   */
  protected reconcilePulls(repo: PersistedRepo, pulls: PullInfo[]) {
    for (const pr of pulls) {
      if (pr.state !== 'OPEN' || pr.isDraft || !pr.headRefName.startsWith('swarm/')) continue;
      if (this.state.qa.some((q) => q.repoId === repo.id && q.prNumber === pr.number)) continue;
      const dev = this.state.agents.find((a) => a.repoId === repo.id && a.role !== 'ceo' && a.task !== 'qa' && (a.prNumber === pr.number || a.branch === pr.headRefName));
      this.queueQa(repo, pr.number, dev ?? null, pr.closesIssues[0] ?? null);
    }
    this.save();
  }

  async createIssue(repoId: string, title: string, body: string, assignTo?: string) {
    const repo = this.repo(repoId);
    if (!title.trim()) throw new HttpError(400, 'An issue needs a title');
    const number = await this.backend.createIssue(repo.fullName, title.trim(), body);
    await this.syncRepo(repo.id);
    this.toast('success', `Issue #${number} filed on ${repo.fullName}`);
    if (assignTo) await this.assign(assignTo, number);
    else setTimeout(() => this.schedule(), 200);
    return number;
  }

  async mergePull(repoId: string, number: number, method: 'squash' | 'merge' | 'rebase' = 'squash') {
    const repo = this.repo(repoId);
    const pr = this.repoRt.get(repo.id)?.pulls.find((p) => p.number === number) ?? (await this.backend.prDetails(repo.fullName, number));
    await this.backend.mergePull(repo.fullName, number, method);
    this.toast('success', `Merged PR #${number} into ${repo.defaultBranch}`);
    this.notifyMerge(repo, number, pr.title);
    await this.closeResolvedIssues(repo, number, pr);
    await this.syncRepo(repo.id);
    setTimeout(() => this.schedule(), 200);
  }

  /** The manager's Close on a PR: closed on GitHub, and its QA, fix and anyone working on it stop now. */
  async closePull(repoId: string, number: number) {
    const repo = this.repo(repoId);
    const pr = this.repoRt.get(repo.id)?.pulls.find((p) => p.number === number) ?? (await this.backend.prDetails(repo.fullName, number).catch(() => null));
    await this.backend.closePull(repo.fullName, number);
    this.learnPull(repo, { number, headRefName: pr?.headRefName ?? '', closesIssues: pr?.closesIssues ?? [] }, 'CLOSED');
    await this.syncRepo(repo.id);
  }

  /** The manager's Close on an issue: closed on GitHub as not planned, and whoever works on it stops now. */
  async closeIssueByManager(repoId: string, number: number, resolvedBy?: number) {
    const repo = this.repo(repoId);
    const rt = this.repoRt.get(repo.id);
    const state = rt?.issues.some((i) => i.number === number) ? 'OPEN' : await this.backend.issueState(repo.fullName, number).catch(() => null);
    checkCloseIssue({ floor: repo.floor, number, state, pulls: rt?.pulls ?? [] });
    const by = this.state.settings.managerName || 'the manager';
    // From the office doctor, for an issue a merged PR resolved: closed as completed, not as not planned.
    if (resolvedBy) await this.backend.closeIssue(repo.fullName, number, `Resolved by #${resolvedBy}; closed by ${by} from the cubefarm office.`, 'completed');
    else await this.backend.closeIssue(repo.fullName, number, `Closed as not planned by ${by} from the cubefarm office.`, 'not planned');
    this.toast('info', `Closed #${number} on ${repo.fullName}`);
    this.learnIssueClosed(repo, number);
    await this.syncRepo(repo.id);
  }
}
