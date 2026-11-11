import { setTimeout as sleep } from 'node:timers/promises';
import { CommandError, gh, ghJson } from './exec.ts';
import { NEVER_STARTED_MS } from './mergeGate.ts';
import { PR_FILES_MAX, type GhRepoSummary, type IssueInfo, type PullInfo } from '../shared/types.ts';
import type { SurvivalSignals } from '../shared/experiments.ts';
import { TRUST_LABEL } from '../shared/trust.ts';
import { prSummary } from '../shared/prSummary.ts';
import { tryItField } from '../shared/tryIt.ts';

// All GitHub access goes through the gh CLI so it reuses the user's existing `gh auth login`.

/**
 * A read the board syncs on, tried twice: GitHub's API blips (a 502, a GraphQL timeout on the PRs' checks) and a gh
 * that hangs on the network would otherwise put an error on the Kanban until the next sync.
 */
export async function readTwice<T>(read: () => Promise<T>, pauseMs = 2_000): Promise<T> {
  try {
    return await read();
  } catch {
    await sleep(pauseMs);
    return read();
  }
}

const SYNC_READ = { timeoutMs: 60_000 };

export async function currentUser(): Promise<string> {
  return gh(['api', 'user', '--jq', '.login']);
}

export async function listMyRepos(owner?: string): Promise<GhRepoSummary[]> {
  const args = ['repo', 'list'];
  if (owner) args.push(owner);
  args.push('--limit', '200', '--json', 'nameWithOwner,description,visibility,updatedAt');
  const repos = await ghJson<GhRepoSummary[]>(args);
  return repos.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export interface RepoMeta {
  nameWithOwner: string;
  description: string;
  url: string;
  defaultBranch: string;
}

export async function repoMeta(fullName: string): Promise<RepoMeta> {
  const raw = await ghJson<{ nameWithOwner: string; description: string | null; url: string; defaultBranchRef: { name: string } | null }>([
    'repo',
    'view',
    fullName,
    '--json',
    'nameWithOwner,description,url,defaultBranchRef',
  ]);
  return {
    nameWithOwner: raw.nameWithOwner,
    description: raw.description ?? '',
    url: raw.url,
    defaultBranch: raw.defaultBranchRef?.name || 'main',
  };
}

interface RawIssue {
  number: number;
  title: string;
  body: string | null;
  url: string;
  createdAt: string;
  author: { login: string } | null;
  authorAssociation: string;
  labels: { nodes: { name: string }[] } | null;
  timelineItems: { nodes: ({ label?: { name: string } | null; actor?: { login: string } | null } | null)[] } | null;
}

const ISSUES_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    issues(states: OPEN, first: 100, orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes {
        number title body url createdAt authorAssociation
        author { login }
        labels(first: 50) { nodes { name } }
        timelineItems(itemTypes: [LABELED_EVENT], last: 50) { nodes { ... on LabeledEvent { label { name } actor { login } } } }
      }
    }
  }
}`;

/** An issue from the GraphQL list, with who last added the office-trusted label (#185). */
export function issueOf(i: RawIssue): IssueInfo {
  const trusting = (i.timelineItems?.nodes ?? []).filter((e) => e?.label?.name === TRUST_LABEL);
  return {
    number: i.number,
    title: i.title,
    body: i.body ?? '',
    url: i.url,
    labels: (i.labels?.nodes ?? []).map((l) => l.name),
    createdAt: i.createdAt,
    author: i.author?.login ?? null,
    authorAssociation: i.authorAssociation,
    trustedBy: trusting.at(-1)?.actor?.login ?? null,
  };
}

export async function listIssues(fullName: string): Promise<IssueInfo[]> {
  const [owner, name] = fullName.split('/');
  const raw = await readTwice(() =>
    ghJson<{ data: { repository: { issues: { nodes: RawIssue[] } } | null } }>(['api', 'graphql', '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `query=${ISSUES_QUERY}`], SYNC_READ),
  );
  return (raw.data.repository?.issues.nodes ?? []).map(issueOf).sort((a, b) => a.number - b.number);
}

/** The logins of the repo's collaborators with write access (#185). */
export async function writers(fullName: string): Promise<string[]> {
  const out = await gh(['api', '--paginate', `repos/${fullName}/collaborators?permission=push&per_page=100`, '--jq', '.[].login'], SYNC_READ);
  return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/** The default branch's commits (up to 100) and the issues filed (up to 200) since `since`, for the lab's survival check. */
export async function survivalSignals(fullName: string, since: number): Promise<SurvivalSignals> {
  const iso = new Date(since).toISOString();
  const [commits, issues] = await Promise.all([
    ghJson<{ commit: { message: string; committer: { date: string } | null } }[]>(['api', `repos/${fullName}/commits?since=${iso}&per_page=100`], SYNC_READ),
    ghJson<{ number: number; title: string; body: string; labels: { name: string }[]; createdAt: string }[]>(
      ['issue', 'list', '-R', fullName, '--state', 'all', '--search', `created:>=${iso.slice(0, 10)}`, '--limit', '200', '--json', 'number,title,body,labels,createdAt'],
      SYNC_READ,
    ),
  ]);
  return {
    commits: commits.map((c) => ({ at: Date.parse(c.commit.committer?.date ?? '') || 0, message: c.commit.message ?? '' })),
    issues: issues.map((i) => ({ number: i.number, at: Date.parse(i.createdAt) || 0, title: i.title, body: i.body ?? '', labels: i.labels.map((l) => l.name) })),
  };
}

interface RawPull {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  mergeable: string;
  reviewDecision: string | null;
  closingIssuesReferences: { number: number }[] | null;
  createdAt: string;
  updatedAt?: string;
  mergedAt: string | null;
  body?: string | null;
  additions: number;
  deletions: number;
  headRefOid: string;
  mergeStateStatus: string;
  files?: { path: string }[] | null;
  author?: { login: string } | null;
  isCrossRepository?: boolean;
  // check runs (GitHub Actions…) carry name/status/conclusion/detailsUrl and startedAt/completedAt; commit statuses (Vercel…) carry context/state/targetUrl
  statusCheckRollup:
    | { name?: string; context?: string; status?: string; conclusion?: string; state?: string; detailsUrl?: string; targetUrl?: string; startedAt?: string; completedAt?: string }[]
    | null;
}

const PR_FIELDS =
  'number,title,url,headRefName,headRefOid,state,isDraft,mergeable,mergeStateStatus,reviewDecision,closingIssuesReferences,createdAt,updatedAt,mergedAt,additions,deletions,statusCheckRollup,files,author,isCrossRepository,body';

type Check = NonNullable<RawPull['statusCheckRollup']>[number];
const BAD = ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'];
const failed = (c: Check) => BAD.includes(c.conclusion ?? '') || BAD.includes(c.state ?? '');
const pending = (c: Check) => (!!c.status && c.status !== 'COMPLETED') || c.state === 'PENDING' || c.state === 'EXPECTED';
const checkName = (c: Check) => c.name || c.context || 'check';

/** A check run GitHub ended without running it (#191): a startup failure, or finished within seconds of starting. */
export function neverStartedCheck(c: Check): boolean {
  if (c.conclusion === 'STARTUP_FAILURE') return true;
  const ms = Date.parse(c.completedAt ?? '') - Date.parse(c.startedAt ?? '');
  return c.status === 'COMPLETED' && Number.isFinite(ms) && ms < NEVER_STARTED_MS;
}

function checksOf(rollup: RawPull['statusCheckRollup']): PullInfo['checks'] {
  if (!rollup || rollup.length === 0) return 'none';
  if (rollup.some(failed)) return 'failing';
  if (rollup.some(pending)) return 'pending';
  return 'passing';
}

/**
 * How long the head commit's check runs took, first start to last finish, once none is running; null without times
 * (commit statuses have none). For mission control's CI numbers.
 */
export function checkRunOf(rollup: RawPull['statusCheckRollup']): PullInfo['checkRun'] {
  if (!rollup?.length || rollup.some(pending)) return null;
  const starts = rollup.map((c) => Date.parse(c.startedAt ?? '')).filter(Number.isFinite);
  const ends = rollup.map((c) => Date.parse(c.completedAt ?? '')).filter(Number.isFinite);
  if (!starts.length || !ends.length) return null;
  const doneAt = Math.max(...ends);
  return { ms: Math.max(0, doneAt - Math.min(...starts)), doneAt };
}

function toPull(p: RawPull): PullInfo {
  return {
    number: p.number,
    title: p.title,
    url: p.url,
    headRefName: p.headRefName,
    state: p.state,
    isDraft: p.isDraft,
    mergeable: p.mergeable,
    reviewDecision: p.reviewDecision || null,
    closesIssues: (p.closingIssuesReferences ?? []).map((r) => r.number),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt ?? p.createdAt,
    mergedAt: p.mergedAt,
    additions: p.additions,
    deletions: p.deletions,
    checks: checksOf(p.statusCheckRollup),
    headSha: p.headRefOid,
    mergeState: p.mergeStateStatus || 'UNKNOWN',
    failedChecks: (p.statusCheckRollup ?? []).filter(failed).map((c) => ({ name: checkName(c), url: c.detailsUrl || c.targetUrl || null, ...(neverStartedCheck(c) ? { neverStarted: true } : {}) })),
    pendingChecks: (p.statusCheckRollup ?? []).filter(pending).map(checkName),
    checkRun: checkRunOf(p.statusCheckRollup),
    files: (p.files ?? []).slice(0, PR_FILES_MAX).map((f) => f.path),
    summary: p.state === 'OPEN' ? prSummary(p.body) : undefined, // the open ones' only: a short line in the snapshot
    ...(p.state === 'OPEN' && tryItField(p.body)), // the snapshot carries the steps, never the body
    author: p.author?.login ?? null,
    isCrossRepository: p.isCrossRepository ?? true, // unknown: treated as a fork's
  };
}

export async function listPulls(fullName: string): Promise<PullInfo[]> {
  const [open, merged] = await Promise.all([
    readTwice(() => ghJson<RawPull[]>(['pr', 'list', '-R', fullName, '--state', 'open', '--limit', '50', '--json', PR_FIELDS], SYNC_READ)),
    readTwice(() => ghJson<RawPull[]>(['pr', 'list', '-R', fullName, '--state', 'merged', '--limit', '8', '--json', PR_FIELDS], SYNC_READ)),
  ]);
  return [...open, ...merged].map(toPull);
}

// gh refuses labels a repository doesn't have, so the ones the office adds are created on first use. A label that
// already exists keeps its colour and description.
const labelsMade = new Set<string>();

async function ensureLabel(fullName: string, name: string) {
  const key = `${fullName}#${name}`;
  if (labelsMade.has(key)) return;
  try {
    await gh(['label', 'create', name, '-R', fullName, '--color', 'c77dff', '--description', 'Added by cubefarm']);
  } catch (err) {
    if (!(err instanceof CommandError && /already exists/i.test(err.stderr))) throw err;
  }
  labelsMade.add(key);
}

export async function createIssue(fullName: string, title: string, body: string, labels: string[] = []): Promise<number> {
  for (const l of labels) await ensureLabel(fullName, l);
  const args = ['issue', 'create', '-R', fullName, '--title', title, '--body-file', '-'];
  for (const l of labels) args.push('--label', l);
  const out = await gh(args, { input: body || ' ' });
  const match = out.match(/\/issues\/(\d+)/);
  if (!match) throw new Error(`Could not read the new issue number from gh output: ${out}`);
  return Number(match[1]);
}

/** OPEN or CLOSED; null when the repo has no such issue. */
export async function issueState(fullName: string, number: number): Promise<'OPEN' | 'CLOSED' | null> {
  try {
    const raw = await ghJson<{ state: string }>(['issue', 'view', String(number), '-R', fullName, '--json', 'state']);
    return raw.state === 'OPEN' ? 'OPEN' : 'CLOSED';
  } catch {
    return null;
  }
}

/** Close an issue as completed (or not planned), with a comment saying why. */
export async function closeIssue(fullName: string, number: number, comment: string, reason: 'completed' | 'not planned' = 'completed'): Promise<void> {
  await gh(['issue', 'close', String(number), '-R', fullName, '--reason', reason, '--comment', comment]);
}

/** Replace an issue's body and/or add and remove labels. */
export async function editIssue(fullName: string, number: number, edit: { body?: string; addLabels?: string[]; removeLabels?: string[] }): Promise<void> {
  const args = ['issue', 'edit', String(number), '-R', fullName];
  if (edit.body !== undefined) args.push('--body-file', '-');
  for (const l of edit.addLabels ?? []) {
    await ensureLabel(fullName, l);
    args.push('--add-label', l);
  }
  for (const l of edit.removeLabels ?? []) args.push('--remove-label', l);
  if (args.length === 5) return;
  await gh(args, edit.body !== undefined ? { input: edit.body || ' ' } : undefined);
}

/** Merge a PR. With headSha, GitHub refuses if anything was pushed after that commit (e.g. after QA signed it off). */
export async function mergePull(fullName: string, number: number, method: 'squash' | 'merge' | 'rebase', headSha?: string): Promise<void> {
  const pr = await ghJson<{ headRefName: string; isCrossRepository: boolean }>(['pr', 'view', String(number), '-R', fullName, '--json', 'headRefName,isCrossRepository']);
  await gh(['pr', 'merge', String(number), '-R', fullName, `--${method}`, ...(headSha ? ['--match-head-commit', headSha] : [])], { timeoutMs: 60_000 });
  // Tidy up the swarm branch on the remote; the local worktree is cleaned when the agent takes its next issue.
  if (!pr.isCrossRepository && pr.headRefName.startsWith('swarm/')) {
    await gh(['api', '-X', 'DELETE', `repos/${fullName}/git/refs/heads/${pr.headRefName}`]).catch(() => undefined);
  }
}

/** Merge the base branch into a PR's branch on GitHub, for repos that only merge up-to-date branches. */
export async function updateBranch(fullName: string, number: number): Promise<void> {
  await gh(['pr', 'update-branch', String(number), '-R', fullName], { timeoutMs: 60_000 });
}

/** How many commits of `base` a PR's head doesn't have yet (up to date before merge, #24). */
export async function behindBy(fullName: string, base: string, headSha: string): Promise<number> {
  const raw = await ghJson<{ behind_by: number }>(['api', `repos/${fullName}/compare/${encodeURIComponent(base)}...${headSha}`], { timeoutMs: 30_000 });
  return Number(raw.behind_by) || 0;
}

/** The failed steps' log of a GitHub Actions run (gh run view --log-failed), for a checks fix. */
export async function failedRunLog(fullName: string, runId: string): Promise<string> {
  return gh(['run', 'view', runId, '-R', fullName, '--log-failed'], { timeoutMs: 60_000 });
}

/** Re-run the failed jobs of these GitHub Actions runs (a flaky check or an outage). */
export async function rerunFailedJobs(fullName: string, runIds: number[]): Promise<void> {
  for (const id of runIds) await gh(['run', 'rerun', String(id), '--failed', '-R', fullName], { timeoutMs: 60_000 });
}

/** The annotations' messages on GitHub Actions jobs, from their log URLs (…/job/<id>: a job is a check run), e.g. why GitHub wouldn't run them. */
export async function checkAnnotations(fullName: string, urls: string[]): Promise<string[]> {
  const ids = [...new Set(urls.map((u) => u.match(/\/job\/(\d+)/)?.[1]).filter((id): id is string => !!id))].slice(0, 3);
  const out: string[] = [];
  for (const id of ids) out.push(...(await ghJson<{ message?: string }[]>(['api', `repos/${fullName}/check-runs/${id}/annotations`], { timeoutMs: 30_000 })).map((a) => a.message ?? ''));
  return out;
}

export async function closePull(fullName: string, number: number): Promise<void> {
  await gh(['pr', 'close', String(number), '-R', fullName]);
}

export async function prForBranch(fullName: string, branch: string): Promise<{ number: number; url: string } | null> {
  const list = await ghJson<{ number: number; url: string }[]>(['pr', 'list', '-R', fullName, '--head', branch, '--state', 'all', '--json', 'number,url', '--limit', '1']);
  return list[0] ?? null;
}

/** A pull request's changed files and, when asked, its diff (the CEO's pr_diff). */
export interface PrDiff {
  files: { path: string; additions: number; deletions: number }[];
  diff: string | null;
}

export async function prDiff(fullName: string, number: number, patch: boolean): Promise<PrDiff> {
  const raw = await ghJson<{ files: { path: string; additions: number; deletions: number }[] | null }>(['pr', 'view', String(number), '-R', fullName, '--json', 'files']);
  const diff = patch ? await gh(['pr', 'diff', String(number), '-R', fullName], { timeoutMs: 60_000 }) : null;
  return { files: (raw.files ?? []).map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })), diff };
}

// ---------- QA support ----------

export interface PrDetails {
  number: number;
  title: string;
  body: string;
  url: string;
  headRefName: string;
  headSha: string;
  isCrossRepository: boolean;
  closesIssues: number[];
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  mergeable: string;
  mergeState: string;
  checks: PullInfo['checks'];
  checkNames: string[]; // every check on the head commit, once each
  failedChecks: string[];
  pendingChecks: string[];
}

const uniqueNames = (checks: Check[]) => [...new Set(checks.map(checkName))];

export async function prDetails(fullName: string, number: number): Promise<PrDetails> {
  const raw = await ghJson<{
    number: number;
    title: string;
    body: string;
    url: string;
    headRefName: string;
    headRefOid: string;
    isCrossRepository: boolean;
    closingIssuesReferences: { number: number }[] | null;
    state: PrDetails['state'];
    mergeable: string;
    mergeStateStatus: string;
    statusCheckRollup: RawPull['statusCheckRollup'];
  }>(['pr', 'view', String(number), '-R', fullName, '--json', 'number,title,body,url,headRefName,headRefOid,isCrossRepository,closingIssuesReferences,state,mergeable,mergeStateStatus,statusCheckRollup']);
  const rollup = raw.statusCheckRollup ?? [];
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body ?? '',
    url: raw.url,
    headRefName: raw.headRefName,
    headSha: raw.headRefOid,
    isCrossRepository: raw.isCrossRepository,
    closesIssues: (raw.closingIssuesReferences ?? []).map((r) => r.number),
    state: raw.state,
    mergeable: raw.mergeable,
    mergeState: raw.mergeStateStatus || 'UNKNOWN',
    checks: checksOf(rollup),
    checkNames: uniqueNames(rollup),
    failedChecks: uniqueNames(rollup.filter(failed)),
    pendingChecks: uniqueNames(rollup.filter(pending)),
  };
}

export async function issueDetails(fullName: string, number: number): Promise<{ title: string; body: string; createdAt: string }> {
  const raw = await ghJson<{ title: string; body: string; createdAt: string }>(['issue', 'view', String(number), '-R', fullName, '--json', 'title,body,createdAt']);
  return { title: raw.title, body: raw.body ?? '', createdAt: raw.createdAt };
}

export async function commentPull(fullName: string, number: number, body: string): Promise<string> {
  const out = await gh(['pr', 'comment', String(number), '-R', fullName, '--body-file', '-'], { input: body });
  return out.match(/https:\/\/github\.com\/\S+/)?.[0] ?? '';
}

// QA screenshots live on an orphan branch so evidence never lands in the default branch when a PR is merged.
export const EVIDENCE_BRANCH = 'swarm-qa-evidence';
const evidenceReady = new Set<string>();

const ghApiJson = <T>(method: string, endpoint: string, body: unknown) =>
  gh(['api', '-X', method, endpoint, '-H', 'Content-Type: application/json', '--input', '-'], { input: JSON.stringify(body), timeoutMs: 120_000 }).then(
    (out) => (out ? JSON.parse(out) : null) as T,
  );

async function ensureEvidenceBranch(fullName: string) {
  if (evidenceReady.has(fullName)) return;
  try {
    await gh(['api', `repos/${fullName}/git/ref/heads/${EVIDENCE_BRANCH}`]);
  } catch {
    const readme =
      '# QA evidence\n\nScreenshots attached to pull request QA reports by cubefarm QA agents.\nThis branch has no shared history with the code and is never merged.\n';
    const newTree = await ghApiJson<{ sha: string }>('POST', `repos/${fullName}/git/trees`, {
      tree: [{ path: 'README.md', mode: '100644', type: 'blob', content: readme }],
    });
    const commit = await ghApiJson<{ sha: string }>('POST', `repos/${fullName}/git/commits`, { message: 'QA evidence branch (cubefarm)', tree: newTree.sha, parents: [] });
    await ghApiJson('POST', `repos/${fullName}/git/refs`, { ref: `refs/heads/${EVIDENCE_BRANCH}`, sha: commit.sha });
  }
  evidenceReady.add(fullName);
}

/** Upload one evidence file and return a URL that renders inside PR comments (also for private repos). */
export async function uploadEvidence(fullName: string, filePath: string, data: Buffer): Promise<string> {
  await ensureEvidenceBranch(fullName);
  await ghApiJson('PUT', `repos/${fullName}/contents/${filePath}`, {
    message: `QA evidence: ${filePath}`,
    content: data.toString('base64'),
    branch: EVIDENCE_BRANCH,
  });
  return `https://github.com/${fullName}/raw/${EVIDENCE_BRANCH}/${filePath}`;
}

// ---------- the charter's export (#48) ----------

/** The office's branch for docs/CHARTER.md. Not swarm/…, so QA leaves its pull request to the manager. */
const CHARTER_BRANCH = 'cubefarm/charter';
const CHARTER_FILE = 'docs/CHARTER.md';

/** Commit docs/CHARTER.md on CHARTER_BRANCH (made from `base` the first time) and open its pull request, or reuse it. */
export async function exportCharter(fullName: string, base: string, markdown: string): Promise<string> {
  try {
    await gh(['api', `repos/${fullName}/git/ref/heads/${CHARTER_BRANCH}`]);
  } catch {
    const head = await ghJson<{ object: { sha: string } }>(['api', `repos/${fullName}/git/ref/heads/${base}`]);
    await ghApiJson('POST', `repos/${fullName}/git/refs`, { ref: `refs/heads/${CHARTER_BRANCH}`, sha: head.object.sha });
  }
  const sha = await ghJson<{ sha: string }>(['api', `repos/${fullName}/contents/${CHARTER_FILE}?ref=${encodeURIComponent(CHARTER_BRANCH)}`]).then(
    (f) => f.sha,
    () => undefined, // not there yet
  );
  await ghApiJson('PUT', `repos/${fullName}/contents/${CHARTER_FILE}`, { message: 'Update the project charter (cubefarm)', content: Buffer.from(markdown).toString('base64'), branch: CHARTER_BRANCH, sha });
  const open = await ghJson<{ url: string }[]>(['pr', 'list', '-R', fullName, '--head', CHARTER_BRANCH, '--state', 'open', '--json', 'url']);
  if (open[0]) return open[0].url;
  const out = await gh(['pr', 'create', '-R', fullName, '--base', base, '--head', CHARTER_BRANCH, '--title', 'Project charter (docs/CHARTER.md)', '--body-file', '-'], {
    input: 'The project charter as the manager keeps it in the cubefarm office: mission, objectives, standards, non-goals and current focus.\n\nExported from the office; merge it to keep a copy in the repository.',
  });
  return out.match(/https:\/\/github\.com\/\S+/)?.[0] ?? `https://github.com/${fullName}/pulls`;
}
