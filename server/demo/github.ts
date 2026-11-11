// The demo's GitHub calls (#257): issues, PRs, merges, checks and reads, answered from the fake repos (world.ts).
import type { GhRepoSummary, PullInfo, TryStep } from '../../shared/types.ts';
import { TRUST_LABEL } from '../../shared/trust.ts';
import { demoDesign } from '../demoDesign.ts';
import { demoMerged, demoPractices, demoPrDiff, demoReadWorktree, demoRepoFile } from '../demoReads.ts';
import { registerDemo } from './registry.ts';
import { CI_ONLY_PR, CI_ONLY_REPO, CI_ONLY_SUMMARY, topUp } from './seedRepos.ts';
import { CI_DOWN_NOTE, CI_DOWN_REPO, ciDown, closedFiled, closedIssues, fakeSha, forgotten, issue, mergedSinceSync, now, repos, runChecks, takeNumber } from './world.ts';

const bodySteps = new WeakMap<PullInfo, TryStep[]>(); // the fake PRs' bodies' steps

registerDemo('github', ({ scale }) => ({
  user: async () => 'demo-manager',
  listMyRepos: async (): Promise<GhRepoSummary[]> =>
    [...repos.values()].map((r) => ({ nameWithOwner: r.fullName, description: r.description, visibility: 'PUBLIC', updatedAt: now() })),
  repoMeta: async (fullName) => {
    const r = repos.get(fullName);
    if (!r) throw new Error(`Unknown demo repo ${fullName}`);
    return { nameWithOwner: fullName, description: r.description, url: `https://github.com/${fullName}`, defaultBranch: 'main' };
  },
  listIssues: async (fullName) => {
    const r = repos.get(fullName);
    if (r && scale) topUp(r, scale.agents * 2);
    // GitHub's fields for trust (#185), set on the fake's own objects: the office keeps them as they are, like before.
    for (const i of r?.issues ?? []) i.authorAssociation ??= 'OWNER';
    return [...(r?.issues ?? [])];
  },
  // Like GitHub's list: the open PRs and the 8 latest merges, never closed ones, so the office asks about those.
  listPulls: async (fullName) => {
    const pulls = repos.get(fullName)?.pulls ?? [];
    for (const p of pulls) Object.assign(p, { author: p.author ?? 'demo-manager', isCrossRepository: p.isCrossRepository ?? false });
    // The open ones' "Try it" steps, read from their bodies each time as GitHub's would be: the sync takes them off (#381).
    for (const p of pulls) {
      if (p.tryIt) bodySteps.set(p, p.tryIt);
      else if (p.state === 'OPEN' && bodySteps.has(p)) p.tryIt = bodySteps.get(p);
    }
    return [...pulls.filter((p) => p.state === 'OPEN'), ...pulls.filter((p) => p.state === 'MERGED').slice(0, 8)];
  },
  writers: async () => ['demo-manager'],
  exportCharter: async (fullName) => {
    if (!repos.has(fullName)) throw new Error('Unknown repo');
    return `https://github.com/${fullName}/compare/main...cubefarm/charter`; // the demo writes nothing
  },
  createIssue: async (fullName, title, body, labels = []) => {
    const r = repos.get(fullName);
    if (!r) throw new Error('Unknown repo');
    const n = takeNumber(r);
    r.issues.push(issue(n, title, body, fullName, labels));
    return n;
  },
  issueState: async (fullName, number) => {
    const r = repos.get(fullName);
    return r?.issues.some((i) => i.number === number) ? 'OPEN' : closedIssues.has(`${fullName}#${number}`) || forgotten(fullName, number) ? 'CLOSED' : null;
  },
  editIssue: async (fullName, number, edit) => {
    const i = repos.get(fullName)?.issues.find((x) => x.number === number);
    if (!i) throw new Error(`Unknown issue #${number}`);
    if (edit.body !== undefined) i.body = edit.body;
    if (edit.addLabels?.includes(TRUST_LABEL)) i.trustedBy = 'demo-manager';
    i.labels = [...i.labels.filter((l) => !edit.removeLabels?.includes(l)), ...(edit.addLabels ?? []).filter((l) => !i.labels.includes(l))];
  },
  mergePull: async (fullName, number, _method, headSha) => {
    const r = repos.get(fullName);
    const pr = r?.pulls.find((p) => p.number === number);
    if (!r || !pr) throw new Error('Unknown PR');
    if (headSha && pr.headSha !== headSha) throw new Error('Head branch was modified. Review and try the merge again.');
    mergedSinceSync.set(fullName, (mergedSinceSync.get(fullName) ?? 0) + 1);
    pr.state = 'MERGED';
    demoMerged(r.pulls);
    // Now and then a merge leaves another open PR conflicting, so conflict fixes (before QA and after it) can be seen.
    for (const other of r.pulls) if (other.state === 'OPEN' && Math.random() < 0.25) Object.assign(other, { mergeable: 'CONFLICTING', mergeState: 'DIRTY' });
    pr.mergedAt = now();
    // GitHub closes what "Closes #N" links a little after the merge, not straight away.
    setTimeout(() => {
      for (const n of pr.closesIssues) closedIssues.add(`${fullName}#${n}`);
      r.issues = r.issues.filter((i) => !pr.closesIssues.includes(i.number));
    }, 20_000).unref();
  },
  closeIssue: async (fullName, number) => {
    const r = repos.get(fullName);
    if (!r?.issues.some((i) => i.number === number)) throw new Error(`Issue #${number} is not open`);
    closedIssues.add(`${fullName}#${number}`);
    r.issues = r.issues.filter((i) => i.number !== number);
  },
  updateBranch: async (fullName, number) => {
    const pr = repos.get(fullName)?.pulls.find((p) => p.number === number);
    if (!pr) throw new Error('Unknown PR');
    Object.assign(pr, { headSha: fakeSha(), mergeState: 'CLEAN' });
    runChecks(pr, false);
  },
  ...demoPractices,
  failedRunLog: async (_fullName, runId) =>
    [
      `build\tRun npm test\t2025-01-01T00:00:00Z > vitest run (run ${runId})`,
      'build\tRun npm test\t2025-01-01T00:00:01Z  FAIL  src/__tests__/toolbar.test.ts > wraps below 480px',
      'build\tRun npm test\t2025-01-01T00:00:01Z AssertionError: expected "nowrap" to be "wrap"',
      'build\tRun npm test\t2025-01-01T00:00:02Z Test Files  1 failed | 7 passed (8)',
      'build\tRun npm test\t2025-01-01T00:00:02Z ##[error]Process completed with exit code 1.',
    ].join('\n'),
  checkAnnotations: async (fullName) => (ciDown(`/${fullName}/`) ? [CI_DOWN_NOTE] : []),
  demoParked: () => [...(repos.get(CI_DOWN_REPO)?.pulls.filter((p) => p.state === 'OPEN' && ciDown(p.url)).map((p) => ({ fullName: CI_DOWN_REPO, prNumber: p.number })) ?? []), { fullName: CI_ONLY_REPO, prNumber: CI_ONLY_PR, stuck: CI_ONLY_SUMMARY }],
  demoDesign,
  rerunFailedJobs: async (fullName, runIds) => {
    // The re-run passes: a flake, as the office hoped.
    for (const pr of repos.get(fullName)?.pulls ?? []) {
      if (pr.failedChecks.some((c) => runIds.some((id) => c.url?.includes(`/actions/runs/${id}/`)))) runChecks(pr, false);
    }
  },
  closePull: async (fullName, number) => {
    const pr = repos.get(fullName)?.pulls.find((p) => p.number === number);
    if (pr) pr.state = 'CLOSED';
  },
  prForBranch: async () => null,
  prDetails: async (fullName, number) => {
    const pr = repos.get(fullName)?.pulls.find((p) => p.number === number);
    if (!pr && forgotten(fullName, number)) {
      // From before a restart: the fake GitHub starts over, so it was closed while the office was down.
      return {
        number,
        title: `PR #${number}`,
        body: '',
        url: `https://github.com/${fullName}/pull/${number}`,
        headRefName: '',
        headSha: fakeSha(),
        isCrossRepository: false,
        closesIssues: [],
        state: 'CLOSED',
        mergeable: 'UNKNOWN',
        mergeState: 'UNKNOWN',
        checks: 'none',
        checkNames: [],
        failedChecks: [],
        pendingChecks: [],
      };
    }
    if (!pr) throw new Error(`Unknown PR #${number}`);
    return {
      number,
      title: pr.title,
      body: `Implements the change.\n\nCloses #${pr.closesIssues[0] ?? '?'}`,
      url: pr.url,
      headRefName: pr.headRefName,
      headSha: pr.headSha,
      isCrossRepository: false,
      closesIssues: pr.closesIssues,
      state: pr.state,
      mergeable: pr.mergeable,
      mergeState: pr.mergeState,
      checks: pr.checks,
      checkNames: pr.checks === 'none' ? [] : ['CI / build', 'Vercel'],
      failedChecks: pr.failedChecks.map((c) => c.name),
      pendingChecks: pr.pendingChecks,
    };
  },
  // The CEO's pr_diff and worktree_file read made-up changes: the demo has no code on disk.
  prDiff: async (fullName, number, patch) => {
    const pr = repos.get(fullName)?.pulls.find((p) => p.number === number);
    if (!pr) throw new Error(`Unknown PR #${number}`);
    return demoPrDiff(pr, patch);
  },
  readWorktree: async (r) => demoReadWorktree(r),
  hasRepoFile: (fullName, rel) => demoRepoFile(fullName, rel) !== null,
  readRepoFile: async (fullName, _branch, rel) => demoRepoFile(fullName, rel) ?? Promise.reject(new Error(`${rel} isn't on the default branch.`)),
  issueDetails: async (fullName, number) => {
    const i = repos.get(fullName)?.issues.find((x) => x.number === number);
    return { title: i?.title ?? `Issue #${number}`, body: i?.body ?? '', createdAt: i?.createdAt ?? closedFiled.get(`${fullName}#${number}`) };
  },
  commentPull: async (fullName, number) => `https://github.com/${fullName}/pull/${number}#issuecomment-${Date.now()}`,
  uploadEvidence: async (fullName, filePath) => `https://github.com/${fullName}/raw/swarm-qa-evidence/${filePath}`,
}));
