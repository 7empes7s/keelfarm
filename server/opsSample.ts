// The demo's made-up ops history: a past week of merges, QA rounds, check runs and cost for mission control.
import type { RoundCause } from '../shared/rounds.ts';
import { DAY_MS, emptyHistory, HOUR_MS, prune, startOfDay, type OpsHistory, type QaEntry } from './metrics.ts';

const PAST_CAUSES: RoundCause[] = ['bug', 'nit', 'bug', 'spec-missing', 'lab-error', 'bug', 'outage']; // why QA failed it (#188)

/**
 * A believable past week for mission control: each floor merged a few PRs every working day (the first floor more),
 * most QA rounds and check runs passed, and sessions cost around a dollar. `rand` is there for the tests.
 */
export function demoPastWeek(repos: string[], now: number, rand: () => number = Math.random): OpsHistory {
  const h = emptyHistory();
  const min = 60_000;
  let n = 0;
  repos.forEach((repo, floor) => {
    const pace = floor === 0 ? 1 : 0.6;
    for (let day = 6; day >= 0; day--) {
      const midnight = startOfDay(now) - day * DAY_MS;
      const merges = Math.round((3 + rand() * 4) * pace);
      for (let k = 0; k < merges; k++) {
        const at = midnight + (9 + rand() * 9) * HOUR_MS; // working hours
        const rounds = rand() < 0.3 ? 2 : 1; // now and then QA failed it once first
        const pr = -++n; // made up, so never a real PR's number
        h.merges.push([at, repo, pr, Math.round((25 + rand() * 200) * min)]);
        for (let r = 0; r < rounds; r++) {
          const before = (rounds - r) * 20 * min;
          const pass = r === rounds - 1;
          const entry: QaEntry = [at - before, repo, pass, Math.round((1 + rand() * 14) * min), pr, r + 1];
          if (!pass) entry.push(PAST_CAUSES[n % PAST_CAUSES.length]);
          h.qa.push(entry);
          h.checks.push([at - before - 6 * min, repo, `past${String(n++).padStart(4, '0')}`, rand() > 0.12, Math.round((2.5 + rand() * 5) * min)]);
          h.cost.push([at - before, repo, Math.round((0.3 + rand()) * 100) / 100], [at - before - 40 * min, repo, Math.round((0.4 + rand() * 1.2) * 100) / 100]);
        }
      }
      for (const hour of [10, 15]) h.cost.push([midnight + hour * HOUR_MS, '', Math.round((0.5 + rand() * 0.8) * 100) / 100]); // the CEO's reviews
    }
  });
  for (const list of [h.merges, h.qa, h.checks, h.cost] as [number, ...unknown[]][][]) {
    for (let i = list.length - 1; i >= 0; i--) if (list[i][0] > now) list.splice(i, 1); // nothing from later today
  }
  prune(h, now);
  return h;
}
