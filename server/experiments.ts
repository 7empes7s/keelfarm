// The office as a lab (#23): the experiments in state.json, the variant each new issue in one gets, what that changes
// in its sessions, and what came of its PR (the cost ledger's lines, the floors' syncs, and a survival check against
// the default branch and new issues). The rules are pure, in shared/experiments.ts; this is the bookkeeping.
import { randomBytes } from 'node:crypto';
import type { CostSession, TaskKind } from '../shared/costs.ts';
import {
  addSession,
  assignIssue,
  experimentResult,
  makeExperiment,
  practiceStarters,
  sessionPractice,
  starterExperiments,
  survivalOf,
  variantPractices,
  type Assignment,
  type Experiment,
  type LabView,
  type SessionPractice,
  type SurvivalSignals,
} from '../shared/experiments.ts';
import type { PracticeOverrides } from '../shared/practices.ts';
import type { PullInfo } from '../shared/types.ts';
import { HttpError } from './httpError.ts';

export interface LabState {
  experiments: Experiment[];
  assignments: Assignment[];
  practiceStarters?: boolean; // the practices' starter experiments (#24) were added to an office that had experiments
  busyStarter?: boolean; // conflict-aware scheduling's starter (#256) was added too
}

const KEEP_ASSIGNMENTS = 3000;
const MAX_TAGS = 300;
const SURVIVAL_DAYS = 31;
const SURVIVAL_EVERY_MS = 6 * 3_600_000;
const DAY_MS = 86_400_000;

/** The lab as state.json had it, or the starter experiments for an office that has none yet. */
export function loadLab(raw: unknown, now: number): LabState {
  const r = (raw ?? {}) as Partial<LabState>;
  const experiments = Array.isArray(r.experiments) ? r.experiments.filter((e) => e && typeof e.id === 'string' && Array.isArray(e.variants)) : starterExperiments(now);
  const assignments = Array.isArray(r.assignments) ? r.assignments.filter((a) => a && typeof a.experimentId === 'string' && typeof a.issue === 'number' && a.outcome) : [];
  // Offices from before #24 get its starters once; one the manager deleted since stays deleted.
  if (Array.isArray(r.experiments) && !r.practiceStarters) experiments.push(...practiceStarters(now).filter((s) => !experiments.some((e) => e.id === s.id)));
  if (Array.isArray(r.experiments) && !r.busyStarter) experiments.push(...practiceStarters(now).filter((s) => s.id === 'busy-files' && !experiments.some((e) => e.id === s.id)));
  return { experiments, assignments, practiceStarters: true, busyStarter: true };
}

/** The manager's and CEO's changes reach the tabs at once; assignments and outcomes, which grow with the company's
 *  activity, at most this often (server/scale.test.ts's traffic budget). */
const EMIT_SOON_MS = 500;
const EMIT_QUIET_MS = 30_000;

/** The experiments' bookkeeping. `save` writes the state; `emit` sends the tabs the view (throttled). */
export class Lab {
  private emitTimer: NodeJS.Timeout | null = null;
  private emitAt = 0;

  constructor(
    private st: () => LabState,
    private o: { save: () => void; emit: (view: LabView) => void; floorOk: (repoId: string) => boolean },
  ) {}

  private changed(soon = false) {
    this.o.save();
    const at = Date.now() + (soon ? EMIT_SOON_MS : EMIT_QUIET_MS);
    if (this.emitTimer && this.emitAt <= at) return;
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.emitAt = at;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.o.emit(this.view());
    }, at - Date.now());
  }

  private get experiments() {
    return this.st().experiments;
  }

  private exp(id: unknown): Experiment {
    const e = this.experiments.find((x) => x.id === id);
    if (!e) throw new HttpError(404, 'No such experiment');
    return e;
  }

  view(now = Date.now()): LabView {
    const { experiments, assignments } = this.st();
    const running = new Set(experiments.filter((e) => e.status === 'running').map((e) => e.id));
    return {
      experiments: experiments.map((e) => ({ ...e, assigned: assignments.filter((a) => a.experimentId === e.id).length, result: experimentResult(e, assignments, now) })),
      tags: assignments
        .filter((a) => running.has(a.experimentId))
        .slice(-MAX_TAGS)
        .reverse()
        .map((a) => ({ repoId: a.repoId, issue: a.issue, pr: a.pr, experimentId: a.experimentId, variantId: a.variantId })),
    };
  }

  /** A new experiment, as a draft: only the manager starts it. */
  define(raw: unknown, by: Experiment['by']): Experiment {
    let e: Experiment;
    try {
      e = makeExperiment(raw, { id: `x${randomBytes(4).toString('hex')}`, by, now: Date.now(), seed: randomBytes(4).readUInt32LE(0), floorOk: this.o.floorOk });
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    if (this.experiments.some((x) => x.name.toLowerCase() === e.name.toLowerCase())) throw new HttpError(409, `There is already an experiment called "${e.name}"`);
    this.experiments.push(e);
    this.changed(true);
    return e;
  }

  /** define_experiment's answer: short, and what happens next. */
  defineText(input: unknown): string {
    const e = this.define(input, 'ceo');
    return `Defined "${e.name}" (${e.id}) as a draft: ${e.variants.map((v) => `${v.id.toUpperCase()} ${v.name}`).join(', ')}. Only the manager starts it, in Mission control.`;
  }

  /** The manager's start, stop, promote and delete. */
  act(id: unknown, action: unknown, variant?: unknown): Experiment | null {
    const e = this.exp(id);
    const now = Date.now();
    if (action === 'start') {
      if (e.status === 'running') throw new HttpError(409, 'It is already running');
      Object.assign(e, { status: 'running', startedAt: e.startedAt ?? now, stoppedAt: null });
    } else if (action === 'stop') {
      if (e.status !== 'running') throw new HttpError(409, 'It is not running');
      Object.assign(e, { status: 'stopped', stoppedAt: now });
    } else if (action === 'promote') {
      if (e.status === 'running') throw new HttpError(409, 'Stop it before promoting a variant to the default');
      if (variant !== null && !e.variants.some((v) => v.id === variant)) throw new HttpError(400, 'Pick one of its variants, or null to stop promoting one');
      e.promoted = (variant as string | null) ?? null;
      e.stoppedAt ??= now;
    } else if (action === 'delete') {
      if (e.status === 'running') throw new HttpError(409, 'Stop it first');
      const s = this.st();
      s.experiments = s.experiments.filter((x) => x !== e);
      s.assignments = s.assignments.filter((a) => a.experimentId !== e.id);
      this.changed(true);
      return null;
    } else throw new HttpError(400, 'action must be start, stop, promote or delete');
    this.changed(true);
    return e;
  }

  /** A new issue starts: its variant, when a running experiment covers its floor (an issue keeps the one it got). */
  assign(repoId: string, issue: { number: number; body: string; labels: string[] }): Assignment | null {
    const s = this.st();
    const had = s.assignments.find((a) => a.repoId === repoId && a.issue === issue.number);
    if (had) return had;
    const a = assignIssue(s.experiments, s.assignments, repoId, issue, Date.now());
    if (!a) return null;
    s.assignments.push(a);
    if (s.assignments.length > KEEP_ASSIGNMENTS) s.assignments.splice(0, s.assignments.length - KEEP_ASSIGNMENTS);
    this.changed();
    return a;
  }

  private find(repoId: string, issue: number | null | undefined, pr: number | null | undefined) {
    return this.st().assignments.find((a) => a.repoId === repoId && ((issue != null && a.issue === issue) || (pr != null && a.pr === pr)));
  }

  /** What a session on this issue or PR runs with (nothing for work no experiment covers). */
  practice(repoId: string, issue: number | null | undefined, pr: number | null | undefined, kind: TaskKind): SessionPractice {
    return sessionPractice(this.experiments, this.find(repoId, issue, pr), repoId, kind);
  }

  /**
   * The practice switches an issue's work runs with from the lab. An issue not started yet (`peek`) gets the variant it
   * would get if it started now, so the scheduler can hold it back by its leases before it has one.
   */
  practices(repoId: string, issue: number | null | undefined, pr: number | null | undefined, peek?: { number: number; body: string; labels: string[] }): PracticeOverrides {
    const s = this.st();
    const a = this.find(repoId, issue, pr) ?? (peek ? assignIssue(s.experiments, s.assignments, repoId, peek, Date.now()) : null);
    return variantPractices(s.experiments, a, repoId);
  }

  /** Whether a running experiment covering the floor has a variant that turns this practice on. */
  tries(repoId: string, key: 'leases' | 'upToDate' | 'autoRebase' | 'busyFiles' | 'liveLeases'): boolean {
    return this.experiments.some((e) => e.status === 'running' && (!e.floors.length || e.floors.includes(repoId)) && e.variants.some((v) => v.settings.practices?.[key] === true));
  }

  /** A variant's settings and the experiment's verdict, for making its practices every project's default. */
  variant(id: unknown, variantId: unknown) {
    const e = this.exp(id);
    if (e.status === 'running') throw new HttpError(409, 'Stop it before making a variant every project\'s default');
    const v = e.variants.find((x) => x.id === variantId);
    if (!v) throw new HttpError(400, 'Pick one of its variants');
    if (!v.settings.practices || !Object.keys(v.settings.practices).length) throw new HttpError(400, `${v.name} has no practice switches to make the default`);
    return { experiment: e, variant: v, summary: experimentResult(e, this.st().assignments, Date.now()).summary };
  }

  /** A finished session's ledger line, onto its PR's outcome. */
  session(line: CostSession) {
    if (!line.exp) return;
    const a = this.find(line.repoId, line.issue, line.pr);
    if (!a || `${a.experimentId}/${a.variantId}` !== line.exp) return;
    a.outcome = addSession(a.outcome, line);
    a.pr ??= line.pr;
    this.changed();
  }

  /** A floor's sync: which PR closes each assigned issue, and the merges. */
  pulls(repoId: string, pulls: PullInfo[]) {
    let changed = false;
    for (const a of this.st().assignments) {
      if (a.repoId !== repoId || a.outcome.mergedAt !== null) continue;
      const p = pulls.find((x) => (a.pr !== null ? x.number === a.pr : x.closesIssues.includes(a.issue)));
      if (!p) continue;
      if (a.pr === null) {
        a.pr = p.number;
        changed = true;
      }
      const at = p.state === 'MERGED' && p.mergedAt ? Date.parse(p.mergedAt) : NaN;
      if (Number.isFinite(at)) {
        a.outcome = { ...a.outcome, mergedAt: at, closedAt: null, diff: p.additions + p.deletions };
        changed = true;
      }
    }
    if (changed) this.changed();
  }

  /** Floors with merged PRs young enough to look at again, and since when, at most every few hours each. */
  survivalDue(now: number): { repoId: string; since: number }[] {
    const due = new Map<string, number>();
    for (const a of this.st().assignments) {
      const o = a.outcome;
      if (o.mergedAt === null || now - o.mergedAt > SURVIVAL_DAYS * DAY_MS || o.revertedAt !== null) continue;
      if (o.checkedAt !== null && now - o.checkedAt < SURVIVAL_EVERY_MS) continue;
      due.set(a.repoId, Math.min(due.get(a.repoId) ?? Infinity, o.mergedAt));
    }
    return [...due].map(([repoId, since]) => ({ repoId, since }));
  }

  /** What the default branch and new issues say about a floor's merged PRs. */
  survival(repoId: string, signals: SurvivalSignals, now: number) {
    for (const a of this.st().assignments) {
      const o = a.outcome;
      if (a.repoId !== repoId || o.mergedAt === null || a.pr === null || now - o.mergedAt > SURVIVAL_DAYS * DAY_MS) continue;
      const s = survivalOf({ pr: a.pr, issue: a.issue, mergedAt: o.mergedAt }, signals);
      a.outcome = { ...o, revertedAt: o.revertedAt ?? s.revertedAt, followup: o.followup ?? s.followup, checkedAt: now };
    }
    this.changed();
  }

  /** Survival checks for the floors that are due; a floor that can't be read is tried again next time. */
  async checkSurvival(fullName: (repoId: string) => string | null, read: (fullName: string, since: number) => Promise<SurvivalSignals>) {
    const now = Date.now();
    for (const { repoId, since } of this.survivalDue(now)) {
      const name = fullName(repoId);
      if (name) await read(name, since).then((s) => this.survival(repoId, s, now), (err) => console.warn('could not check survival', err));
    }
  }

  /** company_status's line per experiment that runs or has results: the plain verdict and a winner to suggest. */
  summary(now = Date.now()): string[] {
    const { assignments } = this.st();
    return this.experiments
      .filter((e) => e.status !== 'draft')
      .map((e) => {
        const r = experimentResult(e, assignments, now);
        const winner = r.winner && !e.promoted ? `; ${e.variants.find((v) => v.id === r.winner)?.name} looks like a winner: suggest the manager promotes it` : '';
        return `${e.name} (${e.status}${e.promoted ? `, ${e.promoted.toUpperCase()} promoted` : ''}, ${r.variants.map((v) => `${v.id.toUpperCase()} n=${v.n}`).join(' ')}): ${r.summary}${winner}`;
      });
  }
}
