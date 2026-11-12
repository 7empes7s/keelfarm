// The demo's problems register (#544): a fresh demo office's entries, so Settings → Problems shows every cause, owner and
// state, a recurring cause, a PR that needs the manager, and the digest card has items. Live ones come from the demo's
// sessions and QA like a real office's.
import { needsHumanProblem, noteInput, recordProblem, resolveProblems, type ProblemInput, type ProblemsState } from '../shared/problems.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Files the sample into `s` (the demo's floors and agents give it names and links). */
export function problemSample(s: ProblemsState, repos: { id: string; floor: number }[], agents: { id: string; name: string; role: string }[], now: number) {
  const [r1, r2 = r1] = [...repos].sort((a, b) => a.floor - b.floor);
  const [a, b = a] = agents.filter((x) => x.role !== 'ceo');
  if (!r1 || !a) return;
  const work = (r: typeof r1, over: Partial<ProblemInput> & Pick<ProblemInput, 'cause' | 'title' | 'key'>): ProblemInput => ({ kind: 'work', floor: r.floor, repoId: r.id, pr: null, issue: null, agentId: null, owner: 'agents', ...over });
  const at = (ago: number, p: ProblemInput) => recordProblem(s, p, now - ago).problem;
  for (const [pr, ago] of [[21, 20 * HOUR], [23, 9 * HOUR], [24, 2 * HOUR]] as const) {
    at(ago, work(r1, { cause: 'conflict', title: `Merge conflict on PR #${pr}`, pr, agentId: a.id, agentName: a.name, lostMs: 38 * MIN, lostUsd: 1.1, key: `round:conflict:${r1.id}#${pr}` }));
  }
  at(5 * HOUR, work(r2, { cause: 'bug', title: 'QA found bugs on PR #31', pr: 31, issue: 12, agentId: b.id, agentName: b.name, lostMs: 25 * MIN, lostUsd: 2.4, key: `round:bug:${r2.id}#31` }));
  at(3 * HOUR, work(r2, { cause: 'spec-missing', title: 'QA found a test missing on PR #33', pr: 33, agentId: b.id, agentName: b.name, lostMs: 18 * MIN, lostUsd: 0.9, key: `round:spec-missing:${r2.id}#33` }));
  at(4 * HOUR, work(r1, { cause: 'waste', title: 'issue #14: stopped by the watchdog', issue: 14, agentId: a.id, agentName: a.name, lostMs: 31 * MIN, lostUsd: 1.6, key: `waste:${r1.id}:issue #14` }));
  at(90 * MIN, needsHumanProblem({ repoId: r1.id, prNumber: 19, issueNumber: 8, stuckWhy: 'it failed QA 3 times, the most QA rounds a PR gets (3)', escalated: true }, { floor: r1.floor }));
  at(26 * HOUR, work(r2, { cause: 'blocked', title: 'Issue #17 waits on #15', issue: 17, owner: 'ceo', ongoing: true, key: `blocked:${r2.id}#17` }));
  at(2 * HOUR, noteInput({ cause: 'vague-brief', title: 'Issue #16 had no acceptance criteria: QA could not judge it', detail: 'Two rounds argued over what "done" means.' }, { floor: r2.floor, repoId: r2.id, issue: 16 }));
  const err = at(7 * HOUR, work(r1, { cause: 'agent-error', title: `${b.name} is stuck on an error`, agentId: b.id, agentName: b.name, owner: 'ceo', ongoing: true, detail: 'spawn npm ENOENT', key: `agent-error:${b.id}` }));
  resolveProblems(s, (p) => p === err, 'Out of the error.', now - 6 * HOUR);
  const nit = at(30 * HOUR, work(r2, { cause: 'nit', title: 'QA sent it back for nits on PR #28', pr: 28, lostMs: 12 * MIN, lostUsd: 0.4, key: `round:nit:${r2.id}#28` }));
  resolveProblems(s, (p) => p === nit, 'PR #28 merged.', now - 10 * HOUR);
}
