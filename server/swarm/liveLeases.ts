// Live leases (#398, the practices' `liveLeases` switch): each building or fixing agent's real diff, read from their
// worktree every LIVE_EVERY_MS and when a session ends, feeds the floor's leases (core.ts leasesOf); when the default
// branch moves onto files an agent is editing they're told to merge it now, and the later of two agents on one file
// hears who else is on it. Nobody is held back. Rules pure in shared/liveLeases.ts, git reads in server/liveDiff.ts.
import { LIVE_EVERY_MS, dueDiffs, mainNudges, nudgeNote, nudgeText, pairNudges } from '../../shared/liveLeases.ts';
import type { AgentView } from '../../shared/types.ts';
import type { SessionResult } from '../agentRunner.ts';
import { BUSY, type PersistedAgent, type PersistedRepo } from './model.ts';
import { SwarmItImprove } from './itImprove.ts';

/** A worktree is read at most this often, also when a merge or a session end asks sooner. */
const MIN_GAP_MS = 60_000;
const names = (n: string[]) => (n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n.at(-1)}` : n.join(''));

export abstract class SwarmLiveLeases extends SwarmItImprove {
  private liveAt = new Map<string, number>(); // agent id -> their worktree's last read
  private liveBusy = new Set<string>(); // floors whose tick is running
  private toldMain = new Map<string, string>(); // agent id -> the main SHA they were last told to merge
  private toldPair = new Set<string>(); // "later>earlier" agent ids told they share a file
  private mainFiles = new Map<string, string[] | null>(); // `${repoId}:${from}..${to}` -> what main changed
  private nudgeNotes = new Map<string, { issue: number | null; note: string }>(); // agent id -> the line on their card, while on that issue

  /** Whether any of the floor's work runs with live leases: its switch, or a running experiment's variant. */
  protected liveWanted(r: PersistedRepo) {
    return this.practicesOf(r).liveLeases || this.lab.tries(r.id, 'liveLeases');
  }

  protected override agentView(a: PersistedAgent, withLog: boolean): AgentView {
    const v = super.agentView(a, withLog);
    const n = this.nudgeNotes.get(a.id);
    return n && n.issue === a.issueNumber ? { ...v, nudge: n.note } : v;
  }

  /** A merge moved the default branch: check the branches in flight against it. */
  protected override async syncFolder(repo: PersistedRepo) {
    const out = await super.syncFolder(repo);
    void this.liveTick(repo);
    return out;
  }

  /** A session ended: their worktree is read again now if they're still on the work. */
  protected override async onFinished(a: PersistedAgent, repo: PersistedRepo, ran: SessionResult) {
    await super.onFinished(a, repo, ran);
    this.liveAt.delete(a.id);
    void this.liveTick(repo);
  }

  /** Every floor's tick, every LIVE_EVERY_MS (30 s in the demo, so it shows soon). */
  protected override async startUsage() {
    await super.startUsage();
    setInterval(() => this.state.repos.forEach((r) => void this.liveTick(r)), this.backend.demo ? 30_000 : LIVE_EVERY_MS).unref();
  }

  /** One floor: read the due worktrees, then nudge whoever the default branch or a teammate collides with. */
  protected async liveTick(repo: PersistedRepo) {
    if (this.liveBusy.has(repo.id) || !this.repoRt.has(repo.id)) return;
    this.liveBusy.add(repo.id);
    try {
      await this.liveStep(repo);
    } catch (err) {
      console.warn(`live leases on ${repo.fullName}:`, err);
    } finally {
      this.liveBusy.delete(repo.id);
    }
  }

  private async liveStep(repo: PersistedRepo) {
    const fp = this.floorPractice(repo.id);
    const wanted = this.liveWanted(repo);
    const work = this.state.agents.filter((a) => a.repoId === repo.id && a.role !== 'ceo' && a.task !== 'qa' && a.issueNumber != null);
    const live = work.map((a) => ({ a, id: a.id, busy: BUSY.includes(a.status), on: wanted && this.practicesOf(repo, a.issueNumber, a.prNumber).liveLeases, local: a.host !== 'box' }));
    let changed = false;
    // Off, idle or gone: their lease ends; their card line lasts while they're on that issue.
    for (const id of fp.diffs.keys()) {
      const l = live.find((x) => x.id === id);
      if (!l?.on || !l.busy) changed = fp.diffs.delete(id) || changed;
    }
    for (const [id, n] of this.nudgeNotes) if (this.state.agents.find((a) => a.id === id)?.issueNumber !== n.issue) this.nudgeNotes.delete(id);
    for (const id of dueDiffs(live, this.liveAt, Date.now(), MIN_GAP_MS)) {
      const a = live.find((x) => x.id === id)!.a;
      const dir = this.deskOf(a, repo);
      if (!this.backend.deskExists(dir)) continue;
      this.liveAt.set(id, Date.now());
      const d = await this.backend.worktreeChanges(dir, repo.defaultBranch).catch(() => null);
      if (!d || !BUSY.includes(a.status)) continue;
      if (JSON.stringify(fp.diffs.get(id)?.files) !== JSON.stringify(d.files)) changed = true;
      fp.diffs.set(id, d);
    }
    if (changed && this.repoRt.has(repo.id)) this.emitRepo(repo);
    if (!fp.diffs.size) return;
    const inFlight = work.filter((a) => fp.diffs.has(a.id));
    for (const n of pairNudges(inFlight.map((a) => ({ agentId: a.id, startedAt: a.startedAt ?? 0, files: fp.diffs.get(a.id)!.files, pr: a.prNumber })), this.toldPair)) {
      const a = inFlight.find((x) => x.id === n.agentId)!;
      const who = names(n.others.map((id) => this.state.agents.find((x) => x.id === id)?.name ?? id));
      if (await this.nudge(a, nudgeText('pair', n.files, repo.defaultBranch, who), nudgeNote('pair', n.files, who))) n.keys.forEach((k) => this.toldPair.add(k));
    }
    await this.nudgeMain(repo, inFlight); // last: "merge main now" is the line their card keeps
  }

  /** The default branch against each branch in flight: whoever it moved onto merges it now, once per main SHA. */
  private async nudgeMain(repo: PersistedRepo, inFlight: PersistedAgent[]) {
    const fp = this.floorPractice(repo.id);
    const head = await this.backend.mainHead(repo.fullName, repo.defaultBranch).catch(() => null);
    if (!head) return;
    const branches = [];
    for (const a of inFlight) {
      const d = fp.diffs.get(a.id)!;
      const key = `${repo.id}:${d.base}..${head}`;
      if (!this.mainFiles.has(key)) {
        if (this.mainFiles.size > 200) this.mainFiles.clear();
        this.mainFiles.set(key, d.base === head ? [] : await this.backend.mainFilesSince(repo.fullName, d.base, head).catch(() => null));
      }
      const rec = this.prRecord(a);
      branches.push({ agentId: a.id, files: d.files, mainFiles: this.mainFiles.get(key) ?? null, inQa: rec?.status === 'queued' || rec?.status === 'testing' });
    }
    for (const n of mainNudges(branches, head, this.toldMain)) {
      const a = inFlight.find((x) => x.id === n.agentId)!;
      if (await this.nudge(a, nudgeText('main', n.files, repo.defaultBranch), nudgeNote('main', n.files))) this.toldMain.set(a.id, head);
    }
  }

  /** Into their running session (read after its current step), their log, chat and card. False when there's none. */
  private async nudge(a: PersistedAgent, text: string, note: string) {
    if (!this.agentRt.get(a.id)?.session) return false;
    await this.message(a.id, text, false, 'Office');
    this.nudgeNotes.set(a.id, { issue: a.issueNumber, note });
    this.emitAgent(a);
    return true;
  }
}
