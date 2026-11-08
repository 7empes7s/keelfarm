// The demo's fake GitHub (#257): its repos, issue and PR numbers that carry on across restarts, and fake CI, shared by
// every server/demo module. `npm run demo`: a fake GitHub and fake Claude Code sessions, so the office (including the
// build → QA → fix loop) can be explored without spending any usage or touching real repos.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { IssueInfo, PullInfo } from '../../shared/types.ts';
import { HOME_DIR } from '../config.ts';

export interface FakeRepo {
  fullName: string;
  description: string;
  issues: IssueInfo[];
  pulls: PullInfo[];
  nextNumber: number;
}

export const now = () => new Date().toISOString();

export function issue(n: number, title: string, body: string, fullName: string, labels: string[] = []): IssueInfo {
  return { number: n, title, body, url: `https://github.com/${fullName}/issues/${n}`, labels, createdAt: now() };
}

export const repos = new Map<string, FakeRepo>();
/** Repos made in the demo (new projects, published folders): empty, so no package.json for the preview to fall back on. */
export const bareRepos = new Set<string>();
export const mergedSinceSync = new Map<string, number>(); // merges the fake project folder hasn't pulled yet
export const closedIssues = new Set<string>(); // `${fullName}#${n}`: issues closed by a merge
export const stalls = new Map<string, () => void>(); // agent id -> silences their running fake session (the office doctor's demo)
export const signOuts = new Map<string, { boxId: string; end: (credit?: boolean) => void }>(); // agent id -> ends their cloud session as an expired sign-in (or a key out of credit) would

export const fakeSha = () => crypto.randomBytes(20).toString('hex');

// GitHub never gives two PRs the same number, and the office's ledger (coins, careers) counts each PR once by it, so
// the fake's numbers carry on across restarts (the issues and PRs themselves start over).
const NUMBERS_FILE = path.join(HOME_DIR, 'demo-github.json');

export function restoreNumbers() {
  try {
    const saved = JSON.parse(fs.readFileSync(NUMBERS_FILE, 'utf8')) as Record<string, number>;
    for (const r of repos.values()) if (Number.isInteger(saved[r.fullName])) r.nextNumber = Math.max(r.nextNumber, saved[r.fullName]);
  } catch {
    // first run
  }
}

/** The repo's next issue or PR number, remembered for the next start. */
export function takeNumber(r: FakeRepo) {
  const n = r.nextNumber++;
  try {
    fs.mkdirSync(HOME_DIR, { recursive: true });
    fs.writeFileSync(`${NUMBERS_FILE}.tmp`, JSON.stringify(Object.fromEntries([...repos.values()].map((x) => [x.fullName, x.nextNumber]))));
    fs.renameSync(`${NUMBERS_FILE}.tmp`, NUMBERS_FILE);
  } catch (err) {
    console.warn('could not save the demo PR numbers', err);
  }
  return n;
}

/**
 * An issue or PR number the fake GitHub handed out before the office restarted: it starts over on every start (only
 * its numbers carry on), so what it forgot was closed while the office was down, as far as the office can tell.
 */
export function forgotten(fullName: string, n: number) {
  const r = repos.get(fullName);
  return !!r && n > 0 && n < r.nextNumber && !r.issues.some((i) => i.number === n) && !r.pulls.some((p) => p.number === n);
}

let runSeq = 1000; // fake Actions run ids, so the office can re-run a failed one
export const nextRunId = () => ++runSeq;
/**
 * Fake CI: checks run for a while after every push, and now and then one fails so the fix loop shows. They say they
 * took a few minutes, like real CI, though the demo doesn't make you wait that long.
 */
export function runChecks(pr: PullInfo, fail = Math.random() < 0.2) {
  Object.assign(pr, { checks: 'pending', pendingChecks: ['CI / build', 'Vercel'], failedChecks: [], checkRun: null });
  if (ciDown(pr.url)) return void setTimeout(() => Object.assign(pr, refusedChecks(pr.url)), 3_000);
  setTimeout(() => {
    Object.assign(pr, {
      checks: fail ? 'failing' : 'passing',
      pendingChecks: [],
      failedChecks: fail ? [{ name: 'CI / build', url: `${pr.url.replace(/\/pull\/\d+$/, '')}/actions/runs/${nextRunId()}/job/1` }] : [],
      checkRun: { ms: Math.round((2.5 + Math.random() * 5) * 60_000), doneAt: Date.now() },
    });
  }, 12_000 + Math.random() * 10_000);
}

// A CI outage (#191): GitHub refuses to start recipe-box's checks for the demo's first 20 minutes, with a QA-passed
// PR parked at the start, so the floor's banner shows and then clears as its PRs merge by themselves.
export const CI_DOWN_REPO = 'demo-co/recipe-box';
const CI_DOWN_UNTIL = Date.now() + 20 * 60_000;
export const CI_DOWN_NOTE = "The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings.";
export const ciDown = (url: string) => url.includes(`/${CI_DOWN_REPO}/`) && Date.now() < CI_DOWN_UNTIL;
export const refusedChecks = (url: string): Partial<PullInfo> => ({
  checks: 'failing',
  pendingChecks: [],
  failedChecks: [{ name: 'CI / build', url: `${url.replace(/\/pull\/\d+$/, '')}/actions/runs/${nextRunId()}/job/1`, neverStarted: true }],
  checkRun: { ms: 1_000, doneAt: Date.now() },
});

export const closedFiled = new Map<string, string>(); // `${fullName}#${n}` → when a seeded plan's closed issue was filed
