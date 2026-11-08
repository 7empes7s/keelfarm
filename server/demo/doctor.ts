// The office doctor's demo (#257): ways to break the fake world the way real ones break, from the doctor's buttons.
import { registerDemo } from './registry.ts';
import { closedIssues, fakeSha, now, repos, stalls, takeNumber } from './world.ts';

registerDemo('doctor', ({ deskRepo, installedDesks }) => ({
  demoDoctor: {
    dropDesk: (dir) => {
      deskRepo.delete(dir);
      installedDesks.delete(dir);
    },
    finishQuietly: (fullName, kind, n) => {
      const r = repos.get(fullName);
      if (!r) return;
      const pr = kind === 'pr' ? r.pulls.find((p) => p.number === n) : undefined;
      if (pr) Object.assign(pr, { state: 'MERGED', mergedAt: now() });
      for (const i of kind === 'issue' ? [n] : (pr?.closesIssues ?? [])) {
        closedIssues.add(`${fullName}#${i}`);
        r.issues = r.issues.filter((x) => x.number !== i);
      }
    },
    stall: (agentId) => {
      const stall = stalls.get(agentId);
      stall?.();
      return !!stall;
    },
    unclosedMerge: (fullName, mergedAgoMs) => {
      const r = repos.get(fullName);
      const open = r?.issues[r.issues.length - 1];
      if (!r || !open) return null;
      const n = takeNumber(r);
      r.pulls.unshift({
        number: n,
        title: open.title,
        url: `https://github.com/${fullName}/pull/${n}`,
        headRefName: `fix/issue-${open.number}`,
        state: 'MERGED',
        isDraft: false,
        mergeable: 'MERGEABLE',
        reviewDecision: null,
        closesIssues: [open.number],
        createdAt: new Date(Date.now() - mergedAgoMs - 3_600_000).toISOString(),
        mergedAt: new Date(Date.now() - mergedAgoMs).toISOString(),
        additions: 12,
        deletions: 3,
        checks: 'passing',
        headSha: fakeSha(),
        mergeState: 'CLEAN',
        failedChecks: [],
        pendingChecks: [],
      });
      return { issue: open.number, pr: n };
    },
  },
}));
