// The demo's stuck PR (#155): a fresh demo office opens with a PR QA failed and left with the manager, so the details
// page shows a full report: nine checks of every result, a charter violation and a merge conflict.
import type { PullInfo, QaCheck, TryStep } from '../shared/types.ts';

export interface DemoQaReport {
  pull: PullInfo;
  summary: string;
  checks: QaCheck[];
  fixInstructions: string;
  tryIt: TryStep[]; // QA's version of the PR's "Try it" (#381): the last step fails
}

/** The issue the stuck PR closes: a title long enough to wrap on a phone, as the details header's must (#155). */
export const DEMO_QA_ISSUE = {
  title: 'Checkout steps on a phone: a sticky action bar and a stepper that wraps at 390px',
  body: 'At phone width the stepper is cut off and the Pay button scrolls out of view. Keep the action bar on screen and let the steps wrap.\n\nObjective: O1',
};

/** The PR (opened `agoMs` ago, closing `issue`) and QA's report on it. */
export function demoQaReport(fullName: string, number: number, issue: { number: number; title: string }, agoMs: number, sha: string): DemoQaReport {
  return {
    pull: {
      number,
      title: `${issue.title}, on every screen`,
      url: `https://github.com/${fullName}/pull/${number}`,
      headRefName: `swarm/issue-${issue.number}-demo`,
      state: 'OPEN',
      isDraft: false,
      mergeable: 'CONFLICTING',
      reviewDecision: null,
      closesIssues: [issue.number],
      createdAt: new Date(Date.now() - agoMs).toISOString(),
      mergedAt: null,
      additions: 214,
      deletions: 37,
      checks: 'passing',
      headSha: sha,
      mergeState: 'DIRTY',
      failedChecks: [],
      pendingChecks: [],
      tryIt: [
        { text: 'Open the checkout at /checkout.', path: '/checkout' },
        { text: 'Add two items, then tap Next.' },
        { text: 'You should see the steps wrap and Pay stay on screen.' },
      ],
    },
    summary: 'The page reads well on a desktop, but at 390px the stepper is cut off and the page scrolls sideways. The branch also conflicts with main.',
    checks: [
      { name: 'Unit tests', result: 'pass', details: '58 passed, 0 failed' },
      { name: 'Lint and build', result: 'pass', details: 'No lint errors; the production build succeeds' },
      { name: 'Phone layout at 390px', result: 'fail', details: 'The stepper overflows the card by 36px, so the page scrolls sideways and its + button is cut off.' },
      { name: 'Feature works on desktop', result: 'pass', details: 'Clicked through the new flow at 1280x800' },
      { name: 'Sticky action bar', result: 'fail', details: 'It covers the last item on an iPhone: the page has no bottom padding for it.' },
      { name: 'Console errors', result: 'pass', details: 'None' },
      { name: 'Screen reader labels', result: 'pass', details: 'The stepper buttons say "More" and "Fewer"' },
      { name: 'Offline mode', result: 'skip', details: 'The service worker is not built in preview mode, so it could not be checked.' },
      { name: 'Charter check', result: 'fail', details: "violation: 'Screens work at 390px': the page scrolls sideways and the stepper is cut off" },
    ],
    tryIt: [
      { text: 'Open the checkout at /checkout.', path: '/checkout', result: 'pass' },
      { text: 'Add two items with +, then tap Next.', result: 'pass' },
      { text: 'You should see the steps wrap and Pay stay on screen.', result: 'fail', note: 'At 390 px the stepper overflows and the page scrolls sideways' },
    ],
    fixInstructions: 'Let the stepper wrap under the title below 480px, and give the page bottom padding the height of the sticky action bar. Then merge main and keep both changes working.',
  };
}
