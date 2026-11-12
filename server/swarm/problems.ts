// The problems register (#544): every work, infrastructure and process problem in one list, recorded in plain code (no
// model call per entry) from what the office already sees: finished sessions (failed QA rounds by cause, conflict and
// checks fixes, sessions without a result), QA records (needs-human, failing QA 3+ times), Mission control's agent
// alarms and issues blocked over a day; IT's tickets (#542) join it as infrastructure; the CEO and IT note process
// problems with note_problem. A PR merging or closing resolves its entries. A daily digest goes to the CEO chat as a
// card (and Telegram) at Settings' hour. The CEO's follow-ups already wake for agent errors, QA failures and
// needs-human PRs, so the register adds no job of its own. Rules pure in shared/problems.ts.
import { blockers } from '../../shared/issues.ts';
import type { CostSession } from '../../shared/costs.ts';
import { agentErrorProblem, BLOCKED_MS, blockedProblem, CAUSE_LABELS, digest, digestDue, digestHour, fmtLost, isOpen, loadProblems, needsHumanProblem, noteInput, problemsView, pruneProblems, qaRepeatProblem, recordProblem, recurring, register, resolveProblems, sessionProblem, STATE_LABELS, updateProblem, worstFirst, type Problem, type ProblemInput } from '../../shared/problems.ts';
import type { PullInfo, WorldSnapshot } from '../../shared/types.ts';
import type { NoteProblemArgs, ProblemsArgs } from '../ceoProblemTools.ts';
import { HttpError } from '../httpError.ts';
import { problemSample } from '../problemSample.ts';
import { wantsTicketSample } from '../itTicketSample.ts';
import type { PersistedRepo, QaRecord } from './model.ts';
import { SwarmLiveLeases } from './liveLeases.ts';

const TICK_MS = 60_000;
/** Tabs hear the register at most this often: a big company records a problem every few seconds (scale.test.ts). */
const PUSH_MS = 30_000;
const LISTED = 15;

export abstract class SwarmProblems extends SwarmLiveLeases {
  /** The saved register, from the state file (shared/problems.ts loadProblems). */
  protected loadProblemsState(raw: unknown) {
    return loadProblems(raw);
  }

  private floorAt(repoId: string | null) {
    return { floor: this.state.repos.find((r) => r.id === repoId)?.floor ?? null };
  }

  /** Left out while there are none: every tab's snapshot pays for it (scale.test.ts). */
  override snapshot(): WorldSnapshot {
    const list = this.state.problems.list;
    return list.length ? { ...super.snapshot(), problems: problemsView(list) } : super.snapshot();
  }

  private problemsPush: ReturnType<typeof setTimeout> | null = null;

  private problemsChanged() {
    this.save();
    this.problemsPush ??= setTimeout(() => {
      this.problemsPush = null;
      this.broadcast({ type: 'problems', problems: problemsView(this.state.problems.list) });
    }, PUSH_MS);
    this.problemsPush.unref?.();
  }

  private record(inputs: ProblemInput[]) {
    if (!inputs.length) return;
    const now = Date.now();
    for (const p of inputs) recordProblem(this.state.problems, p, now);
    this.problemsChanged();
  }

  private resolve(match: (p: Problem) => boolean, resolution: string) {
    if (resolveProblems(this.state.problems, match, resolution, Date.now()).length) this.problemsChanged();
  }

  /** Every finished session (core.ts' cost ledger callback): a failed round by its cause, a fix, or waste. */
  protected problemSession(line: CostSession) {
    const p = sessionProblem(line, this.floorAt(line.repoId));
    if (p) this.record([p]);
  }

  /** Every QA change: needs-human in and out, a third failed round. */
  protected override setQa(rec: QaRecord, patch: Partial<QaRecord>) {
    const was = rec.status, escalated = rec.escalated;
    super.setQa(rec, patch);
    if (!this.state.qa.includes(rec)) return;
    const w = this.floorAt(rec.repoId);
    const key = `needs-human:${rec.repoId}#${rec.prNumber}`;
    if (rec.status === 'needs-human' && (was !== 'needs-human' || escalated !== rec.escalated)) this.record([needsHumanProblem(rec, w)]);
    if (was === 'needs-human' && rec.status !== 'needs-human') this.resolve((p) => p.key === key, `Back in the flow (${rec.status}).`);
    const rounds = rec.round - rec.retests;
    if (rec.status === 'failed' && was !== 'failed' && rounds >= 3) this.record([qaRepeatProblem(rec, rounds, w)]);
  }

  /** A PR merged or closed: its entries are resolved. */
  protected override ledgerPulls(repo: PersistedRepo, pulls: PullInfo[]) {
    super.ledgerPulls(repo, pulls);
    const gone = new Map(pulls.filter((p) => p.state !== 'OPEN').map((p) => [p.number, p.state === 'MERGED' ? 'merged' : 'closed']));
    const hit = this.state.problems.list.filter((p) => isOpen(p) && p.repoId === repo.id && p.pr !== null && gone.has(p.pr));
    for (const pr of new Set(hit.map((p) => p.pr!))) this.resolve((p) => p.repoId === repo.id && p.pr === pr, `PR #${pr} ${gone.get(pr)}.`);
  }

  /** The register's clock starts with the office (init starts the usage readings once). A fresh demo gets the sample and a digest. */
  protected override async startUsage() {
    if (this.backend.demo && !this.state.problems.list.length) {
      setTimeout(() => {
        if (!wantsTicketSample(this.backend.demo, this.state.repos.length, this.state.problems.list.length)) return;
        problemSample(this.state.problems, this.state.repos, this.state.agents, Date.now());
        this.problemsChanged();
        this.problemsDigest(Date.now());
      }, 3500).unref();
    }
    setInterval(() => this.problemsTick(), TICK_MS).unref();
    await super.startUsage();
  }

  /** Each minute: agents stuck on errors and issues blocked over a day in and out, quiet entries resolved, the digest when due. */
  private problemsTick() {
    const now = Date.now();
    const s = this.state.problems;
    const before = JSON.stringify(s.list.map((p) => [p.id, p.state, p.count]));
    const alarms = this.opsNow().alarms.filter((a) => a.kind === 'agent' && a.agentId);
    const stuck = new Set(alarms.map((a) => a.agentId!));
    for (const al of alarms) {
      const a = this.state.agents.find((x) => x.id === al.agentId);
      if (a && !s.list.some((p) => isOpen(p) && p.key === `agent-error:${a.id}`)) recordProblem(s, agentErrorProblem({ id: a.id, name: a.name, error: a.lastError, repoId: al.repoId, issue: a.issueNumber }, this.floorAt(al.repoId)), now);
    }
    resolveProblems(s, (p) => p.cause === 'agent-error' && !stuck.has(p.agentId ?? ''), 'Out of the error.', now);
    const blocked = new Set<string>();
    for (const r of this.state.repos) {
      const issues = this.repoRt.get(r.id)?.issues ?? [];
      const open = new Set(issues.map((i) => i.number));
      for (const i of issues) {
        const waits = blockers(i.body, open);
        if (!waits.length || now - Date.parse(i.createdAt) < BLOCKED_MS) continue;
        const key = `blocked:${r.id}#${i.number}`;
        blocked.add(key);
        if (!s.list.some((p) => isOpen(p) && p.key === key)) recordProblem(s, blockedProblem({ repoId: r.id, number: i.number, blockers: waits }, { floor: r.floor }), now);
      }
    }
    resolveProblems(s, (p) => p.cause === 'blocked' && !blocked.has(p.key ?? ''), 'Its dependencies closed.', now);
    pruneProblems(s, now);
    if (JSON.stringify(s.list.map((p) => [p.id, p.state, p.count])) !== before) this.problemsChanged();
    const day = digestDue(now, digestHour(this.state.settings.notify.problemsDigestHour), s.digestDay);
    if (day) {
      s.digestDay = day;
      this.problemsDigest(now);
    }
  }

  /** The daily digest: a card in the CEO chat with the items, the manager's first; the same lines on Telegram. */
  private problemsDigest(now: number) {
    const d = digest(register(this.state.problems.list, this.state.itTickets.list), now);
    this.postMessage('office', d.text, undefined, { problems: d });
    if (this.mirrorsToTelegram()) void this.telegram.send([d.text, ...d.items.map((i) => `${i.needsYou ? '👉 ' : '• '}${i.title}`)].join('\n'));
    this.save();
  }

  // ---------- the CEO's and IT's tools ----------

  /** problems: the register, worst first, one line each. */
  protected problemsList(a: ProblemsArgs): string {
    const now = Date.now();
    const all = register(this.state.problems.list, this.state.itTickets.list);
    const list = worstFirst(all.filter((p) => (a.open_only === false || isOpen(p)) && (a.floor === undefined || p.floor === a.floor)), now);
    if (!list.length) return 'No problems on the register.';
    const line = (p: Problem) => {
      const lost = [fmtLost(p.lostMs + (p.ongoing && isOpen(p) ? now - p.at : 0)), p.lostUsd >= 0.01 ? `$${p.lostUsd.toFixed(2)}` : ''].filter(Boolean).join(', ');
      const tags = [`${p.kind}/${CAUSE_LABELS[p.cause]}`, p.floor !== null && `floor ${p.floor}`, `owner ${p.owner}`, STATE_LABELS[p.state].toLowerCase(), p.count > 1 && `${p.count}×`, `lost ${lost}`, recurring(p, all, now) && 'recurring', p.needsYou && 'needs the manager'].filter(Boolean).join(', ');
      return `${p.id} [${tags}] ${p.title}${p.resolution ? ` → ${p.resolution}` : ''}`;
    };
    return [`${list.length} problem${list.length === 1 ? '' : 's'}, worst first:`, ...list.slice(0, LISTED).map(line)].join('\n');
  }

  /** note_problem: a new process problem, or an entry's state, owner and resolution. */
  protected noteProblem(a: NoteProblemArgs): string {
    const now = Date.now();
    try {
      if (a.id) {
        const p = updateProblem(this.state.problems, a.id.trim(), a, now);
        this.problemsChanged();
        return `${p.id}: ${STATE_LABELS[p.state].toLowerCase()}, owner ${p.owner}.`;
      }
      const repo = a.floor === undefined ? undefined : this.state.repos.find((r) => r.floor === a.floor);
      if (a.floor !== undefined && !repo) throw new Error(`No floor ${a.floor}.`);
      const { problem, joined } = recordProblem(this.state.problems, noteInput(a, { floor: repo?.floor ?? null, repoId: repo?.id ?? null, pr: a.pr, issue: a.issue }), now);
      this.problemsChanged();
      return joined ? `Joined open ${problem.id} (${problem.count}×).` : `Noted ${problem.id}.`;
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  }
}
