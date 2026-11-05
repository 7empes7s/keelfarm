// The office as a lab (#23): experiments that A/B test harness practices (prompt add-ons, effort and model per kind of
// task, cross-model QA, skills) on real issues. Pure, shared by the server (server/experiments.ts) and the results view:
// definitions and their checks, seeded stratified assignment, what a variant changes in a session, outcomes per PR,
// survival, and the statistics behind the verdicts.
import type { TaskKind } from './costs.ts';
import { cleanOverrides, type PracticeOverrides } from './practices.ts';
import type { AgentCli, EffortLevel } from './types.ts';

// ---------- definitions ----------

/** A bundle of harness settings. Every field is optional: an empty bundle is the office as it is (the control). */
export interface PracticeSettings {
  prompt?: string; // added to build and fix sessions' instructions
  qaLens?: string; // added to QA sessions' instructions
  effort?: Partial<Record<TaskKind, EffortLevel>>;
  model?: Partial<Record<TaskKind, string>>; // Claude Code sessions only
  qaCli?: AgentCli; // QA by a free agent on this coding agent when there is one (cross-model QA); never hires one
  toolsOff?: string[]; // Tools & skills switched off (Claude Code sessions)
  practices?: PracticeOverrides; // version-control practice switches for its issues and their PRs (#24)
}

interface Variant {
  id: string; // 'a', 'b', …
  name: string;
  settings: PracticeSettings;
}

type ExperimentStatus = 'draft' | 'running' | 'stopped';

export interface Experiment {
  id: string;
  name: string;
  hypothesis: string;
  variants: Variant[]; // the first is the control the others are compared with
  floors: string[]; // repo ids it covers; [] for every floor
  kinds: TaskKind[]; // the sessions its variants change; [] for every kind below
  status: ExperimentStatus;
  createdAt: number;
  startedAt: number | null;
  stoppedAt: number | null;
  seed: number;
  minSample: number; // PRs per variant before any verdict
  by: 'manager' | 'ceo';
  promoted: string | null; // the variant the manager made the default (applies while it isn't running)
}

/** What an experiment's variants may change: the agents' own sessions, never the CEO's. */
export const LAB_KINDS: TaskKind[] = ['issue', 'qa', 'fix-qa', 'fix-checks', 'fix-conflict'];
const MIN_SAMPLE = 10;
const MAX_TEXT = 1500;

const VARIANT_IDS = ['a', 'b', 'c', 'd'];

/** An experiment as the manager's form or the CEO's tool gives it. */
export interface ExperimentInput {
  name: string;
  hypothesis: string;
  floors?: string[];
  kinds?: TaskKind[];
  variants: { name: string; settings?: PracticeSettings }[];
  minSample?: number;
}

const EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const CLIS: AgentCli[] = ['claude', 'codex', 'opencode'];
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function cleanByKind<T extends string>(raw: unknown, ok: (v: unknown) => v is T, what: string): Partial<Record<TaskKind, T>> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') throw new Error(`${what} must be an object of task kind → value`);
  const out: Partial<Record<TaskKind, T>> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!LAB_KINDS.includes(k as TaskKind)) throw new Error(`Unknown task kind "${k}" in ${what}: use ${LAB_KINDS.join(', ')}`);
    if (v === '' || v === null || v === undefined) continue;
    if (!ok(v)) throw new Error(`"${String(v)}" is not a valid ${what} value`);
    out[k as TaskKind] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** A variant's settings, checked: unknown fields dropped, wrong values refused with a message saying what's wrong. */
function cleanSettings(raw: unknown): PracticeSettings {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object') throw new Error('settings must be an object');
  const r = raw as Record<string, unknown>;
  const out: PracticeSettings = {};
  const prompt = str(r.prompt, MAX_TEXT);
  if (prompt) out.prompt = prompt;
  const lens = str(r.qaLens, MAX_TEXT);
  if (lens) out.qaLens = lens;
  const effort = cleanByKind(r.effort, (v): v is EffortLevel => EFFORTS.includes(v as EffortLevel), 'effort');
  if (effort) out.effort = effort;
  const model = cleanByKind(r.model, (v): v is string => typeof v === 'string' && /^[\w.:/-]{1,80}$/.test(v), 'model');
  if (model) out.model = model;
  if (r.qaCli !== undefined && r.qaCli !== '' && r.qaCli !== null) {
    if (!CLIS.includes(r.qaCli as AgentCli)) throw new Error(`qaCli must be one of ${CLIS.join(', ')}`);
    out.qaCli = r.qaCli as AgentCli;
  }
  if (r.toolsOff !== undefined) {
    if (!Array.isArray(r.toolsOff)) throw new Error('toolsOff must be a list of tool, skill or plugin ids');
    const ids = r.toolsOff.filter((t): t is string => typeof t === 'string' && /^[\w.:@/-]{1,200}$/.test(t)).slice(0, 30);
    if (ids.length) out.toolsOff = ids;
  }
  const practices = cleanOverrides(r.practices);
  if (Object.keys(practices).length) out.practices = practices;
  return out;
}

/** A new experiment (a draft) from the form or the CEO's tool, checked. `floorOk` says whether a repo id is a floor. */
export function makeExperiment(raw: unknown, o: { id: string; by: Experiment['by']; now: number; seed: number; floorOk: (id: string) => boolean }): Experiment {
  if (!raw || typeof raw !== 'object') throw new Error('An experiment needs a name, a hypothesis and 2 to 4 variants');
  const r = raw as Record<string, unknown>;
  const name = str(r.name, 80);
  const hypothesis = str(r.hypothesis, 600);
  if (!name) throw new Error('Give the experiment a name');
  if (!hypothesis) throw new Error('Give the experiment a hypothesis: what you expect a variant to change, and on which numbers');
  if (!Array.isArray(r.variants) || r.variants.length < 2 || r.variants.length > VARIANT_IDS.length) throw new Error('An experiment needs 2 to 4 variants (the first is the control)');
  const variants = r.variants.map((v: unknown, i) => {
    const x = (v ?? {}) as Record<string, unknown>;
    return { id: VARIANT_IDS[i], name: str(x.name, 40) || `Variant ${VARIANT_IDS[i].toUpperCase()}`, settings: cleanSettings(x.settings) };
  });
  const floors = Array.isArray(r.floors) ? [...new Set(r.floors.filter((f): f is string => typeof f === 'string'))] : [];
  const bad = floors.find((f) => !o.floorOk(f));
  if (bad) throw new Error(`"${bad}" is not a floor of this office`);
  const kinds = Array.isArray(r.kinds) ? [...new Set(r.kinds)] : [];
  const wrong = kinds.find((k) => !LAB_KINDS.includes(k as TaskKind));
  if (wrong !== undefined) throw new Error(`Unknown task kind "${String(wrong)}": use ${LAB_KINDS.join(', ')}`);
  const minSample = Math.max(3, Math.min(200, Math.round(Number(r.minSample)) || MIN_SAMPLE));
  return { id: o.id, name, hypothesis, variants, floors, kinds: kinds as TaskKind[], status: 'draft', createdAt: o.now, startedAt: null, stoppedAt: null, seed: o.seed, minSample, by: o.by, promoted: null };
}

const FIX_KINDS: TaskKind[] = ['fix-qa', 'fix-checks', 'fix-conflict'];

/** The starter experiments: defined, not started. */
export function starterExperiments(now: number): Experiment[] {
  const def = (id: string, name: string, hypothesis: string, kinds: TaskKind[], b: { name: string; settings: PracticeSettings }, a: { name: string; settings: PracticeSettings } = { name: 'Current', settings: {} }): Experiment => ({
    id, name, hypothesis, variants: [{ id: 'a', ...a }, { id: 'b', ...b }], floors: [], kinds, status: 'draft', createdAt: now, startedAt: null, stoppedAt: null, seed: 23, minSample: MIN_SAMPLE, by: 'manager', promoted: null,
  });
  return [
    def('test-first', 'Test first vs current', 'Writing a failing test before the code gets PRs through QA in fewer rounds, and they survive longer.', ['issue', 'fix-qa'], {
      name: 'Test first',
      settings: { prompt: 'Before changing any code, write a test that fails without your change and run it to see it fail; then make it pass.' },
    }),
    def('plan-in-pr', 'Plan in the PR vs none', 'A short written plan before coding gives smaller diffs and a higher first-round QA pass.', ['issue'], {
      name: 'Plan in the PR',
      settings: { prompt: 'Before coding, write a short plan (files to change, approach, risks) and put it at the top of your pull request description.' },
    }),
    def('self-review', 'Self-review skill vs none', 'Reviewing the diff with the simplify skill before pushing gets PRs through QA in fewer rounds.', ['issue', 'fix-qa'], {
      name: 'Self-review',
      settings: { prompt: 'Before pushing, review your diff with the simplify skill (or code-review at low effort) and fix what it finds.' },
    }),
    def('cross-model-qa', 'Cross-model QA vs same model', "Codex testing Claude's PRs catches more: fewer reverts and follow-up bugs. Uses Codex agents already on the floor; never hires one.", ['qa'], {
      name: 'Codex QA',
      settings: { qaCli: 'codex' },
    }),
    def(
      'fix-effort',
      'Fixes at medium vs high effort',
      'High effort for fixes costs more per session but fewer rounds, so less per merge.',
      FIX_KINDS,
      { name: 'High', settings: { effort: { 'fix-qa': 'high', 'fix-checks': 'high', 'fix-conflict': 'high' } } },
      { name: 'Medium', settings: { effort: { 'fix-qa': 'medium', 'fix-checks': 'medium', 'fix-conflict': 'medium' } } },
    ),
    ...practiceStarters(now),
  ];
}

/** The version-control practices' starter experiments (#24): each switch on against the office as it is. */
export function practiceStarters(now: number): Experiment[] {
  const def = (id: string, name: string, hypothesis: string, practices: PracticeOverrides, label: string): Experiment => ({
    id, name, hypothesis, variants: [{ id: 'a', name: 'Current', settings: {} }, { id: 'b', name: label, settings: { practices } }], floors: [], kinds: [], status: 'draft', createdAt: now, startedAt: null, stoppedAt: null, seed: 24, minSample: MIN_SAMPLE, by: 'manager', promoted: null,
  });
  return [
    def('up-to-date', 'Up to date before merge vs current', 'Merging only PRs brought up to date with main and green on that result means fewer red mains and fewer follow-up fixes.', { upToDate: true }, 'Up to date'),
    def('file-leases', 'File leases vs current', 'Holding back issues whose files overlap work in flight means fewer conflict fixes and fewer QA rounds.', { leases: true }, 'Leases'),
    def('auto-rebase', 'Auto-rebase vs current', 'Updating conflicting PRs as soon as main moves, before QA, gets them merged sooner with fewer QA rounds.', { autoRebase: true }, 'Auto-rebase'),
    def('small-prs', 'Small-PR budget vs none', 'A 400-line soft budget gives smaller diffs, a higher first-round QA pass and better survival.', { diffBudget: 400 }, '400-line budget'),
  ];
}

// ---------- assignment ----------

/** An issue in an experiment, the variant it got, and what came of its PR. */
export interface Assignment {
  experimentId: string;
  variantId: string;
  repoId: string;
  issue: number;
  pr: number | null;
  at: number;
  stratum: string; // floor and size: the variants are balanced within it
  outcome: PrOutcome;
}

/** FNV-1a: a stable 32-bit hash. */
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 */
function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(n: number, seed: number): number[] {
  const rand = seeded(seed);
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export type IssueSize = 'S' | 'M' | 'L';

/** A rough size from the issue itself: a size label if it has one, else how much its body asks for. */
export function issueSize(issue: { body: string; labels: string[] }): IssueSize {
  const label = issue.labels.map((l) => /^size[:/ -]?(xs|s|m|l|xl)$/i.exec(l.trim())?.[1]?.toUpperCase()).find(Boolean);
  if (label) return label === 'XS' ? 'S' : label === 'XL' ? 'L' : (label as IssueSize);
  const body = issue.body ?? '';
  const asks = (body.match(/^\s*(?:[-*]|\d+\.)\s+/gm) ?? []).length;
  const score = body.length / 800 + asks / 4;
  return score < 1 ? 'S' : score < 4 ? 'M' : 'L';
}

/**
 * The variant for the `nth` issue (0-based) of a stratum: permuted blocks, one of each variant per block in an order
 * drawn from the experiment's seed, so it's deterministic and the variants never differ by more than one in a stratum.
 */
export function pickVariant(exp: Pick<Experiment, 'id' | 'seed' | 'variants'>, stratum: string, nth: number): string {
  const k = exp.variants.length;
  const order = shuffled(k, hash32(`${exp.seed}:${exp.id}:${stratum}:${Math.floor(nth / k)}`));
  return exp.variants[order[nth % k]].id;
}

const coversFloor = (exp: Pick<Experiment, 'floors'>, repoId: string) => !exp.floors.length || exp.floors.includes(repoId);
const coversKind = (exp: Pick<Experiment, 'kinds'>, kind: TaskKind) => LAB_KINDS.includes(kind) && (!exp.kinds.length || exp.kinds.includes(kind));

/** A new issue's experiment and variant, or null when no running experiment covers its floor. One experiment per issue. */
export function assignIssue(experiments: Experiment[], assignments: Assignment[], repoId: string, issue: { number: number; body: string; labels: string[] }, now: number): Assignment | null {
  const open = experiments.filter((e) => e.status === 'running' && coversFloor(e, repoId)).sort((x, y) => (x.id < y.id ? -1 : 1));
  if (!open.length) return null;
  const exp = open[hash32(`${repoId}#${issue.number}`) % open.length];
  const stratum = `${repoId}:${issueSize(issue)}`;
  const nth = assignments.filter((a) => a.experimentId === exp.id && a.stratum === stratum).length;
  return { experimentId: exp.id, variantId: pickVariant(exp, stratum, nth), repoId, issue: issue.number, pr: null, at: now, stratum, outcome: emptyOutcome() };
}

// ---------- what a variant changes in a session ----------

export interface SessionPractice {
  tag: string | null; // `${experiment}/${variant}` on the ledger line, while its experiment runs
  prompt: string; // added to the session's instructions ('' for nothing)
  effort: EffortLevel | null;
  model: string | null;
  toolsOff: string[];
  qaCli: AgentCli | null;
}

const NONE: SessionPractice = { tag: null, prompt: '', effort: null, model: null, toolsOff: [], qaCli: null };

function applied(s: PracticeSettings, kind: TaskKind): Omit<SessionPractice, 'tag'> {
  return {
    prompt: (kind === 'qa' ? s.qaLens : s.prompt) ?? '',
    effort: s.effort?.[kind] ?? null,
    model: s.model?.[kind] ?? null,
    toolsOff: s.toolsOff ?? [],
    qaCli: kind === 'qa' ? (s.qaCli ?? null) : null,
  };
}

/**
 * What a session runs with: its issue's variant while that experiment runs and covers this kind of task; otherwise the
 * variants the manager promoted for this floor and kind (the last promoted wins a clash); otherwise nothing changes.
 */
export function sessionPractice(experiments: Experiment[], a: Pick<Assignment, 'experimentId' | 'variantId'> | null | undefined, repoId: string, kind: TaskKind): SessionPractice {
  const exp = a ? experiments.find((e) => e.id === a.experimentId && e.status === 'running') : undefined;
  if (exp && a) {
    const v = exp.variants.find((x) => x.id === a.variantId);
    const tag = `${exp.id}/${a.variantId}`;
    return v && coversKind(exp, kind) ? { tag, ...applied(v.settings, kind) } : { ...NONE, tag };
  }
  const promoted = experiments
    .filter((e) => e.status !== 'running' && e.promoted && coversFloor(e, repoId) && coversKind(e, kind))
    .sort((x, y) => (x.stoppedAt ?? 0) - (y.stoppedAt ?? 0))
    .map((e) => applied(e.variants.find((v) => v.id === e.promoted)?.settings ?? {}, kind));
  if (!promoted.length) return NONE;
  const out = { ...NONE };
  for (const p of promoted) {
    out.prompt = [out.prompt, p.prompt].filter(Boolean).join('\n');
    out.effort = p.effort ?? out.effort;
    out.model = p.model ?? out.model;
    out.toolsOff = [...new Set([...out.toolsOff, ...p.toolsOff])];
    out.qaCli = p.qaCli ?? out.qaCli;
  }
  return out;
}

/**
 * The practice switches an issue's work runs with from the lab: its variant's while that experiment runs (whatever
 * kinds it covers: the switches act on the issue and its PR, not on one kind of session), else the promoted variants'
 * covering its floor (the last promoted wins a clash), else none.
 */
export function variantPractices(experiments: Experiment[], a: Pick<Assignment, 'experimentId' | 'variantId'> | null | undefined, repoId: string): PracticeOverrides {
  const exp = a ? experiments.find((e) => e.id === a.experimentId && e.status === 'running') : undefined;
  if (exp && a) return exp.variants.find((v) => v.id === a.variantId)?.settings.practices ?? {};
  return experiments
    .filter((e) => e.status !== 'running' && e.promoted && coversFloor(e, repoId))
    .sort((x, y) => (x.stoppedAt ?? 0) - (y.stoppedAt ?? 0))
    .reduce<PracticeOverrides>((out, e) => ({ ...out, ...e.variants.find((v) => v.id === e.promoted)?.settings.practices }), {});
}

/** Free agents for a PR's QA: only the ones on `cli` other than its author when there are any (cross-model QA), else all of them. */
export function preferCli<T extends { id: string }>(free: T[], cli: AgentCli | null, author: string | null, cliOf: (a: T) => AgentCli): T[] {
  const on = cli ? free.filter((a) => a.id !== author && cliOf(a) === cli) : [];
  return on.length ? on : free;
}

// ---------- outcomes ----------

export interface PrOutcome {
  usd: number; // every session on the issue and its PR
  sessions: number;
  qaRounds: number; // 0 before its first verdict
  firstPass: boolean | null;
  checkFixes: number; // sessions fixing a red check: the CI reruns it took
  mergedAt: number | null;
  closedAt: number | null; // closed without merging
  diff: number | null; // lines added + deleted
  revertedAt: number | null;
  followup: { issue: number; at: number } | null; // a bug issue or fix commit that referenced it after the merge
  checkedAt: number | null; // survival last looked at
}

export const emptyOutcome = (): PrOutcome => ({ usd: 0, sessions: 0, qaRounds: 0, firstPass: null, checkFixes: 0, mergedAt: null, closedAt: null, diff: null, revertedAt: null, followup: null, checkedAt: null });

/** A finished session (its ledger line) added to its PR's outcome. */
export function addSession(o: PrOutcome, s: { kind: TaskKind; usd: number; round: number | null; outcome: string }): PrOutcome {
  const out = { ...o, usd: Math.round((o.usd + s.usd) * 10_000) / 10_000, sessions: o.sessions + 1 };
  if (s.kind === 'qa' && (s.outcome === 'qa-pass' || s.outcome === 'qa-fail')) {
    const round = s.round ?? o.qaRounds + 1;
    if (round <= 1 && o.firstPass === null) out.firstPass = s.outcome === 'qa-pass';
    out.qaRounds = Math.max(o.qaRounds, round);
  }
  if (s.kind === 'fix-checks') out.checkFixes++;
  return out;
}

export interface SurvivalSignals {
  commits: { at: number; message: string }[]; // the default branch's commits since the oldest merge looked at
  issues: { number: number; at: number; title: string; body: string; labels: string[] }[]; // issues filed since then
}

const ref = (n: number) => new RegExp(`(?:#|/(?:pull|issues)/)${n}(?!\\d)`);
const BUGGY = /\b(bug|regression|regress(ed|es)?|broke|broken|breaks|crash(es|ed)?|revert(ed)?)\b/i;
const FIXES = (n: number) => new RegExp(`\\b(fix(es|ed)?|regression (from|in|of)|follow-?up (to|of|for|on)|caused by|broken by)\\s+(?:PR\\s+)?#${n}(?!\\d)`, 'i');

/**
 * Did a merged PR survive: the first revert of it (a commit "Revert …" naming the PR), else the first follow-up
 * (a later commit that says it fixes the PR or its issue, or a bug issue that references either), after the merge.
 */
export function survivalOf(a: { pr: number; issue: number; mergedAt: number }, s: SurvivalSignals): Pick<PrOutcome, 'revertedAt' | 'followup'> {
  const after = <T extends { at: number }>(xs: T[]) => xs.filter((x) => x.at > a.mergedAt).sort((x, y) => x.at - y.at);
  const revert = after(s.commits).find((c) => /^revert\b/i.test(c.message.trim()) && ref(a.pr).test(c.message));
  const own = (m: string) => ref(a.pr).test(m.split('\n')[0]) && !/^revert\b/i.test(m.trim()); // the PR's own merge commit
  const fix = after(s.commits).find((c) => !/^revert\b/i.test(c.message.trim()) && !own(c.message) && (FIXES(a.pr).test(c.message) || FIXES(a.issue).test(c.message)));
  const bug = after(s.issues).find((i) => i.number !== a.issue && (ref(a.pr).test(`${i.title}\n${i.body}`) || ref(a.issue).test(`${i.title}\n${i.body}`)) && (i.labels.some((l) => /bug|regression/i.test(l)) || BUGGY.test(`${i.title}\n${i.body}`)));
  const follow = [fix ? { issue: 0, at: fix.at } : null, bug ? { issue: bug.number, at: bug.at } : null].filter((x): x is { issue: number; at: number } => !!x).sort((x, y) => x.at - y.at)[0] ?? null;
  return { revertedAt: revert?.at ?? null, followup: follow };
}

const DAY_MS = 86_400_000;

/** 1 when a merged PR made it `days` days with no revert or follow-up bug, 0 when it didn't, null while it's too soon. */
export function survived(o: Pick<PrOutcome, 'mergedAt' | 'revertedAt' | 'followup'>, days: number, now: number): number | null {
  if (o.mergedAt === null) return null;
  const bad = Math.min(o.revertedAt ?? Infinity, o.followup?.at ?? Infinity);
  if (bad - o.mergedAt <= days * DAY_MS) return 0;
  return now - o.mergedAt >= days * DAY_MS ? 1 : null;
}

// ---------- statistics ----------

type MetricKey = 'firstPass' | 'qaRounds' | 'cost' | 'hours' | 'diff' | 'checkFixes' | 'survival14' | 'survival30';

export interface Metric {
  key: MetricKey;
  label: string;
  better: 'lower' | 'higher';
  unit: 'pct' | 'usd' | 'n';
  value: (a: Assignment, now: number) => number | null;
}

const done = (o: PrOutcome) => o.mergedAt !== null || o.closedAt !== null;

export const METRICS: Metric[] = [
  { key: 'firstPass', label: 'first-round QA pass', better: 'higher', unit: 'pct', value: (a) => (a.outcome.firstPass === null ? null : Number(a.outcome.firstPass)) },
  { key: 'qaRounds', label: 'QA rounds', better: 'lower', unit: 'n', value: (a) => (done(a.outcome) && a.outcome.qaRounds ? a.outcome.qaRounds : null) },
  { key: 'cost', label: 'cost to merge', better: 'lower', unit: 'usd', value: (a) => (a.outcome.mergedAt !== null ? a.outcome.usd : null) },
  { key: 'hours', label: 'hours to merge', better: 'lower', unit: 'n', value: (a) => (a.outcome.mergedAt !== null ? Math.max(0, a.outcome.mergedAt - a.at) / 3_600_000 : null) },
  { key: 'diff', label: 'diff size', better: 'lower', unit: 'n', value: (a) => (a.outcome.mergedAt !== null ? a.outcome.diff : null) },
  { key: 'checkFixes', label: 'red-check fixes', better: 'lower', unit: 'n', value: (a) => (done(a.outcome) ? a.outcome.checkFixes : null) },
  { key: 'survival14', label: 'survival at 14 days', better: 'higher', unit: 'pct', value: (a, now) => survived(a.outcome, 14, now) },
  { key: 'survival30', label: 'survival at 30 days', better: 'higher', unit: 'pct', value: (a, now) => survived(a.outcome, 30, now) },
];

// Student's t at 97.5% for 1 to 30 degrees of freedom.
const T975 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];

/** The two-sided 95% critical value of Student's t (fractional df rounded down, which errs wide). */
export function tCrit(df: number): number {
  if (!(df >= 1)) return T975[0];
  const d = Math.floor(df);
  return d <= 30 ? T975[d - 1] : 1.96 + (T975[29] - 1.96) * (30 / d);
}

export interface MeanCi {
  n: number;
  mean: number | null;
  lo: number | null; // the 95% confidence interval; null below 2 values
  hi: number | null;
}

const variance = (xs: number[], m: number) => xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);

/** The mean of `xs` with its 95% confidence interval (Student's t). */
export function meanCi(xs: number[]): MeanCi {
  const n = xs.length;
  if (!n) return { n, mean: null, lo: null, hi: null };
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  if (n < 2) return { n, mean, lo: null, hi: null };
  const half = tCrit(n - 1) * Math.sqrt(variance(xs, mean) / n);
  return { n, mean, lo: mean - half, hi: mean + half };
}

/** b's mean minus a's, with Welch's 95% confidence interval; null below 2 values on either side. */
export function diffCi(a: number[], b: number[]): { diff: number; lo: number; hi: number } | null {
  if (a.length < 2 || b.length < 2) return null;
  const ma = a.reduce((s, x) => s + x, 0) / a.length;
  const mb = b.reduce((s, x) => s + x, 0) / b.length;
  const va = variance(a, ma) / a.length;
  const vb = variance(b, mb) / b.length;
  const se = Math.sqrt(va + vb);
  const df = se ? (va + vb) ** 2 / ((va ** 2) / (a.length - 1) + (vb ** 2) / (b.length - 1)) : a.length + b.length - 2;
  const half = tCrit(df) * se;
  return { diff: mb - ma, lo: mb - ma - half, hi: mb - ma + half };
}

/** A number as a metric shows it: percentage points, dollars, or a plain number. */
export function fmtMetric(x: number, unit: Metric['unit'], signed = false): string {
  const v = Math.abs(x);
  const body = unit === 'pct' ? `${Math.round(v * 100)}${signed ? ' pts' : '%'}` : unit === 'usd' ? `$${v.toFixed(2)}` : v >= 100 ? `${Math.round(v)}` : `${Math.round(v * 10) / 10}`;
  const zero = !/[1-9]/.test(body);
  return (zero ? '' : x < 0 ? '−' : signed && x > 0 ? '+' : '') + body;
}

/** Every metric is a count, a cost or a share: its interval is clipped to what it can be. */
const clipped = (c: MeanCi, unit: Metric['unit']): MeanCi => {
  const top = unit === 'pct' ? 1 : Infinity;
  return c.lo === null || c.hi === null ? c : { ...c, lo: Math.max(0, c.lo), hi: Math.min(top, c.hi) };
};

interface VariantResult {
  id: string;
  name: string;
  n: number; // issues assigned
  metrics: Record<MetricKey, MeanCi>;
}

interface MetricVerdict {
  metric: MetricKey;
  variant: string; // compared with the control
  enough: boolean; // both sides reached the minimum sample
  diff: number | null;
  lo: number | null;
  hi: number | null;
  better: boolean | null; // null: no clear difference, or not enough data
  text: string;
}

export interface ExperimentResult {
  variants: VariantResult[];
  verdicts: MetricVerdict[];
  summary: string; // the plain verdict, e.g. "B is better on QA rounds (−0.6, 95% CI −0.9…−0.3); not enough data on survival yet"
  winner: string | null; // a variant better than the control on something and worse on nothing, once the sample is reached
}

/** An experiment's numbers per variant, each variant against the control, and the plain verdict. Never a winner before the minimum sample. */
export function experimentResult(exp: Experiment, assignments: Assignment[], now: number): ExperimentResult {
  const mine = assignments.filter((a) => a.experimentId === exp.id);
  const values = (vid: string, m: Metric) => mine.filter((a) => a.variantId === vid).map((a) => m.value(a, now)).filter((x): x is number => x !== null && Number.isFinite(x));
  const variants: VariantResult[] = exp.variants.map((v) => ({
    id: v.id,
    name: v.name,
    n: mine.filter((a) => a.variantId === v.id).length,
    metrics: Object.fromEntries(METRICS.map((m) => [m.key, clipped(meanCi(values(v.id, m)), m.unit)])) as Record<MetricKey, MeanCi>,
  }));
  const control = exp.variants[0];
  const verdicts: MetricVerdict[] = [];
  for (const v of exp.variants.slice(1)) {
    const label = exp.variants.length > 2 ? v.name : v.id.toUpperCase();
    for (const m of METRICS) {
      const a = values(control.id, m);
      const b = values(v.id, m);
      const enough = a.length >= exp.minSample && b.length >= exp.minSample;
      const d = diffCi(a, b);
      if (!enough || !d) {
        verdicts.push({ metric: m.key, variant: v.id, enough: false, diff: d?.diff ?? null, lo: d?.lo ?? null, hi: d?.hi ?? null, better: null, text: `not enough data on ${m.label} yet (${Math.min(a.length, b.length)}/${exp.minSample})` });
        continue;
      }
      const ci = `(${fmtMetric(d.diff, m.unit, true)}, 95% CI ${fmtMetric(d.lo, m.unit, true)}…${fmtMetric(d.hi, m.unit, true)})`;
      const clear = d.lo > 0 || d.hi < 0;
      const better = clear ? (m.better === 'lower') === d.diff < 0 : null;
      verdicts.push({ metric: m.key, variant: v.id, enough, ...d, better, text: better === null ? `no clear difference on ${m.label} ${ci}` : `${label} is ${better ? 'better' : 'worse'} on ${m.label} ${ci}` });
    }
  }
  const clear = verdicts.filter((x) => x.better !== null).map((x) => x.text);
  const thin = [...new Set(verdicts.filter((x) => !x.enough).map((x) => METRICS.find((m) => m.key === x.metric)!.label))];
  const parts = [...clear, ...(thin.length ? [`not enough data on ${thin.length === METRICS.length ? 'anything' : thin.join(', ')} yet`] : [])];
  const winners = exp.variants.slice(1).filter((v) => {
    const mine = verdicts.filter((x) => x.variant === v.id);
    return mine.some((x) => x.better === true) && !mine.some((x) => x.better === false);
  });
  return { variants, verdicts, summary: parts.join('; ') || 'no clear difference yet', winner: winners.length === 1 ? winners[0].id : null };
}

// ---------- what the tabs get ----------

/** An issue's variant, for its Kanban card. */
export interface LabTag {
  repoId: string;
  issue: number;
  pr: number | null;
  experimentId: string;
  variantId: string;
}

export interface ExperimentView extends Experiment {
  assigned: number;
  result: ExperimentResult;
}

export interface LabView {
  experiments: ExperimentView[];
  tags: LabTag[]; // the running experiments' issues, newest first
}

export const emptyLabView = (): LabView => ({ experiments: [], tags: [] });
