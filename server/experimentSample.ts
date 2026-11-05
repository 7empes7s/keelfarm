// The demo's lab (#23): the starter experiments, one of them running for three weeks with made-up outcomes, so the
// results view has numbers, confidence intervals and a verdict from the start. And a fake survival check.
import { emptyOutcome, pickVariant, starterExperiments, type Assignment, type SurvivalSignals } from '../shared/experiments.ts';
import type { LabState } from './experiments.ts';
import { seeded } from './journalSample.ts';

const DAY_MS = 86_400_000;

/** The starter experiments, "Test first vs current" running on every floor with 16 issues per variant behind it. */
export function sampleLab(repos: { id: string }[], now: number): LabState {
  const experiments = starterExperiments(now - 21 * DAY_MS);
  const exp = experiments.find((e) => e.id === 'test-first')!;
  Object.assign(exp, { status: 'running', startedAt: now - 21 * DAY_MS });
  const rand = seeded(23);
  const assignments: Assignment[] = [];
  const floors = repos.length ? repos.map((r) => r.id) : ['demo/app'];
  const counts = new Map<string, number>();
  for (let i = 0; i < 32; i++) {
    const repoId = floors[i % floors.length];
    const stratum = `${repoId}:${['S', 'M', 'L'][i % 3]}`;
    const nth = counts.get(stratum) ?? 0;
    counts.set(stratum, nth + 1);
    const variantId = pickVariant(exp, stratum, nth);
    const b = variantId === 'b';
    const at = now - (20 - i * 0.6) * DAY_MS;
    const merged = i < 28;
    const rounds = 1 + Math.floor(rand() * (b ? 1.7 : 2.6));
    const reverted = merged && rand() < (b ? 0.04 : 0.15);
    const mergedAt = merged ? at + (2 + rand() * (b ? 5 : 7)) * 3_600_000 : null;
    assignments.push({
      experimentId: exp.id,
      variantId,
      repoId,
      issue: 900 + i,
      pr: 1400 + i,
      at,
      stratum,
      outcome: {
        ...emptyOutcome(),
        usd: Math.round((b ? 2.6 : 2.2) * (0.7 + rand() * 0.8) * rounds * 100) / 100,
        sessions: rounds * 2,
        qaRounds: merged ? rounds : 0,
        firstPass: merged ? rounds === 1 : null,
        checkFixes: rand() < 0.2 ? 1 : 0,
        mergedAt,
        diff: merged ? Math.round((b ? 160 : 210) * (0.5 + rand())) : null,
        revertedAt: reverted && mergedAt ? mergedAt + (1 + rand() * 6) * DAY_MS : null,
        checkedAt: merged ? now : null,
      },
    });
  }
  return { experiments, assignments };
}

/** The demo's survival check: nothing on the default branch or in new issues points at a PR. */
export const demoSurvival = async (): Promise<SurvivalSignals> => ({ commits: [], issues: [] });
