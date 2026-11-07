// The demo's made-up cost ledger (#18): a week of sessions on each floor (issues, QA rounds, fixes, the odd wasted
// session) and the CEO's jobs, with the PRs that merged, so the usage view has something to show. Pure and seeded.
import type { CostMerge, CostRecord, CostSession, SessionOutcome, TaskKind } from '../shared/costs.ts';
import type { RoundCause } from '../shared/rounds.ts';
import type { EffortLevel } from '../shared/types.ts';
import { startupParts, type StartupContext } from '../shared/startup.ts';
import { DAY_MS, HOUR_MS, startOfDay } from './metrics.ts';

/** A lean session's startup (#50), as this machine measured them: Claude Code's ~23k, CLAUDE.md files, the office's texts. */
function sampleStartup(kind: TaskKind, usd: number): StartupContext {
  const ceo = kind.startsWith('ceo-');
  const office = ceo ? 1_800 : kind === 'qa' ? 900 : 850;
  return startupParts(32_000 + Math.round(usd * 300), [
    { label: 'CLAUDE.md files', tokens: ceo ? 2_400 : 8_900 },
    { label: 'Office instructions', tokens: office },
    { label: 'Task prompt', tokens: ceo ? 250 : 120 },
  ]);
}

/** Why the sample's QA rounds failed (#188), as often as each turns up. */
const QA_CAUSES: RoundCause[] = ['bug', 'bug', 'bug', 'bug', 'nit', 'nit', 'nit', 'spec-missing', 'spec-missing', 'lab-error'];

export interface SampleFloor {
  repoId: string;
  agents: { id: string; name: string }[];
  /** Its open issues: today's work in flight is on them, so the usage view shows their titles, open ones and repeats. */
  open?: number[];
  /** Twice the work: the first floor, so the Charter's drift view has an objective with 20+ PRs in a week (#240). */
  busy?: boolean;
}

/** The sample for an office: its floors, their agents and open issues, and its CEO. */
export function sampleOffice(repos: { id: string; open?: number[] }[], agents: { id: string; name: string; role: string; repoId: string }[], now: number, rand: () => number, days = 7): CostRecord[] {
  const ceo = agents.find((a) => a.role === 'ceo') ?? { id: 'ceo', name: 'Morgan' };
  return sampleCosts(repos.map((r, i) => ({ repoId: r.id, agents: agents.filter((a) => a.repoId === r.id), open: r.open, busy: i === 0 })), ceo, now, rand, days);
}

export function sampleCosts(floors: SampleFloor[], ceo: { id: string; name: string }, now: number, rand: () => number, days = 7): CostRecord[] {
  const out: CostRecord[] = [];
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const today = startOfDay(now);
  let issueNo = 300;
  let prNo = 600;
  const session = (s: Omit<CostSession, 'type' | 'tokens' | 'model' | 'round'> & { round?: number; model?: string }) =>
    out.push({ type: 'session', tokens: null, model: 'claude-opus-5-5', round: null, ...s, usd: Math.round(s.usd * 100) / 100, startup: sampleStartup(s.kind, s.usd) });
  for (let d = days - 1; d >= 0; d--) {
    const start = today - d * DAY_MS + 8 * HOUR_MS; // the working day starts at 8
    const end = d === 0 ? Math.min(now, today + 20 * HOUR_MS) : start + 11 * HOUR_MS;
    if (end <= start) continue;
    const at = () => Math.round(between(start, end));
    for (const f of floors) {
      if (!f.agents.length) continue;
      const tasks = (2 + Math.floor(rand() * 4)) * (f.busy ? 2 : 1);
      for (let t = 0; t < tasks; t++) {
        const issue = issueNo++;
        const dev = pick(f.agents);
        let when = at();
        const base = { repoId: f.repoId, issue, effort: 'medium' as EffortLevel };
        const add = (kind: TaskKind, agent: { id: string; name: string }, usd: number, outcome: SessionOutcome, pr: number | null, extra: { round?: number; effort?: EffortLevel; cause?: RoundCause; cheap?: boolean; model?: string } = {}) => {
          const ms = Math.round(between(4, 40) * 60_000);
          when = Math.min(now, when + ms);
          session({ ...base, ...extra, at: when, ms, agentId: agent.id, agent: agent.name, kind, pr, usd, outcome });
        };
        if (rand() < 0.12) {
          add('issue', dev, between(0.6, 2.5), rand() < 0.5 ? 'no-pr' : 'watchdog', null);
          continue;
        }
        const pr = prNo++;
        add('issue', dev, between(1.2, 5.5), 'pr', pr);
        // Every other conflict fix ran on the cheaper model (#256), without a draw, so the rest of the sample stays as it was.
        if (rand() < 0.15) add('fix-conflict', dev, between(0.2, 0.9) * (issue % 2 ? 1 : 0.4), 'commit', pr, { effort: 'low', cause: 'conflict', ...(issue % 2 ? {} : { cheap: true, model: 'claude-sonnet-5' }) });
        const rounds = rand() < 0.55 ? 1 : rand() < 0.7 ? 2 : 3 + Math.floor(rand() * 2);
        for (let r = 1; r <= rounds; r++) {
          const pass = r === rounds;
          const cause = pass ? undefined : pick(QA_CAUSES);
          add('qa', pick(f.agents), between(0.4, 1.6), pass ? 'qa-pass' : 'qa-fail', pr, { round: r, cause });
          if (cause && cause !== 'lab-error') add('fix-qa', dev, between(0.5, 2.2), rand() < 0.1 ? 'no-commit' : 'commit', pr, { cause }); // a lab error is re-tested as it is
        }
        if (rand() < 0.2) add('fix-checks', dev, between(0.2, 1), 'commit', pr, { effort: 'low', cause: rand() < 0.25 ? 'outage' : 'checks' });
        if (when < now && rand() < 0.85) out.push({ type: 'merge', at: Math.min(now, when + 5 * 60_000), repoId: f.repoId, pr, issues: [issue] } satisfies CostMerge);
      }
    }
    for (let i = 0; i < 3; i++) {
      const kind = pick<TaskKind>(['ceo-review', 'ceo-review', 'ceo-chat', 'ceo-triage']);
      const idle = kind === 'ceo-review' && rand() < 0.5;
      const ms = Math.round(between(2, 12) * 60_000);
      session({ repoId: '', issue: null, pr: null, effort: 'xhigh', at: Math.min(now, at() + ms), ms, agentId: ceo.id, agent: ceo.name, kind, usd: between(0.3, 2.4), outcome: idle ? 'ceo-idle' : 'ceo-acted' });
    }
  }
  // Work in flight on open issues: one built three times in a row without a PR, one with an open PR back from QA.
  for (const f of floors) {
    const [stuck, open] = f.open ?? [];
    const dev = f.agents[0];
    if (!dev) continue;
    const flight = (hoursAgo: number, kind: TaskKind, issue: number, pr: number | null, usd: number, outcome: SessionOutcome, round?: number, cause?: RoundCause) =>
      session({ repoId: f.repoId, issue, pr, effort: 'medium', at: now - hoursAgo * HOUR_MS, ms: 20 * 60_000, agentId: dev.id, agent: dev.name, kind, usd, outcome, ...(round === undefined ? {} : { round }), ...(cause ? { cause } : {}) });
    if (stuck !== undefined) for (const h of [5, 3.5, 2]) flight(h, 'issue', stuck, null, between(0.8, 2), 'no-pr');
    if (open !== undefined) {
      const pr = prNo++;
      flight(6, 'issue', open, pr, between(8, 11), 'pr');
      flight(4.5, 'qa', open, pr, between(0.6, 1.4), 'qa-fail', 1, 'bug');
      flight(4, 'fix-qa', open, pr, between(0.8, 1.8), 'no-commit', undefined, 'bug');
      flight(1.5, 'qa', open, pr, between(0.6, 1.4), 'qa-fail', 2, 'bug');
    }
  }
  return out.filter((r) => r.at <= now).sort((a, b) => a.at - b.at);
}
