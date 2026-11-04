// The demo's made-up cost ledger (#18): a week of sessions on each floor (issues, QA rounds, fixes, the odd wasted
// session) and the CEO's jobs, with the PRs that merged, so the usage view has something to show. Pure and seeded.
import type { CostMerge, CostRecord, CostSession, SessionOutcome, TaskKind } from '../shared/costs.ts';
import type { EffortLevel } from '../shared/types.ts';
import { DAY_MS, HOUR_MS, startOfDay } from './metrics.ts';

export interface SampleFloor {
  repoId: string;
  agents: { id: string; name: string }[];
}

export function sampleCosts(floors: SampleFloor[], ceo: { id: string; name: string }, now: number, rand: () => number, days = 7): CostRecord[] {
  const out: CostRecord[] = [];
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const today = startOfDay(now);
  let issueNo = 300;
  let prNo = 600;
  const session = (s: Omit<CostSession, 'type' | 'tokens' | 'model' | 'round'> & { round?: number }) =>
    out.push({ type: 'session', tokens: null, model: 'claude-opus-5-5', round: null, ...s, usd: Math.round(s.usd * 100) / 100 });
  for (let d = days - 1; d >= 0; d--) {
    const start = today - d * DAY_MS + 8 * HOUR_MS; // the working day starts at 8
    const end = d === 0 ? Math.min(now, today + 20 * HOUR_MS) : start + 11 * HOUR_MS;
    if (end <= start) continue;
    const at = () => Math.round(between(start, end));
    for (const f of floors) {
      if (!f.agents.length) continue;
      const tasks = 2 + Math.floor(rand() * 4);
      for (let t = 0; t < tasks; t++) {
        const issue = issueNo++;
        const dev = pick(f.agents);
        let when = at();
        const base = { repoId: f.repoId, issue, effort: 'medium' as EffortLevel };
        const add = (kind: TaskKind, agent: { id: string; name: string }, usd: number, outcome: SessionOutcome, pr: number | null, extra: { round?: number; effort?: EffortLevel } = {}) => {
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
        if (rand() < 0.15) add('fix-conflict', dev, between(0.2, 0.9), 'commit', pr, { effort: 'low' });
        const rounds = rand() < 0.55 ? 1 : rand() < 0.7 ? 2 : 3 + Math.floor(rand() * 2);
        for (let r = 1; r <= rounds; r++) {
          const pass = r === rounds;
          add('qa', pick(f.agents), between(0.4, 1.6), pass ? 'qa-pass' : 'qa-fail', pr, { round: r });
          if (!pass) add('fix-qa', dev, between(0.5, 2.2), rand() < 0.1 ? 'no-commit' : 'commit', pr);
        }
        if (rand() < 0.2) add('fix-checks', dev, between(0.2, 1), 'commit', pr, { effort: 'low' });
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
  return out.filter((r) => r.at <= now).sort((a, b) => a.at - b.at);
}
