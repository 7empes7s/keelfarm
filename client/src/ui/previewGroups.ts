// The Previews page's lists (#226), as pure helpers: every floor's live app (main) and its PRs' previews, grouped as
// Running now, By project, By agent and By PR, with plain status words, the filters, the page's stats bar and its
// deep link (#previews/<floor>/<main|pr-N>). PreviewsPage.tsx draws them.
import type { PreviewStatus, PrPreviewView, PullInfo, QaView, RepoView } from '../../../shared/types';
import { needsManager } from '../../../shared/ops';
import type { Agent } from '../store';
import { busyPrs, channelLed, currentChannel, liveChannels, PR_PREVIEW_SLOTS, previewingPrs } from './channels';

/** A PR's state in one plain word or two. */
export type StatusWord = 'Building' | 'Testing' | 'Being fixed' | 'Waiting for you' | 'Ready' | 'Merged' | 'Closed';

/** Where a PR stands, from its state, QA and the agent on it now. */
export function statusWord(pull: Pick<PullInfo, 'state'>, qa: Pick<QaView, 'status' | 'ceoLooking'> | undefined, agentTask?: Agent['task']): StatusWord {
  if (pull.state === 'MERGED') return 'Merged';
  if (pull.state === 'CLOSED') return 'Closed';
  if (agentTask === 'fix') return 'Being fixed';
  if (agentTask === 'qa') return 'Testing';
  if (!qa) return 'Building';
  if (qa.status === 'needs-human') return needsManager(qa) ? 'Waiting for you' : 'Testing';
  if (qa.status === 'failed' || qa.status === 'fixing') return 'Being fixed';
  if (qa.status === 'passed') return 'Ready';
  return 'Testing';
}

/** A PR's title without its "feat(x):" prefix or "(#123)" suffix: the words the manager reads. */
export const plainTitle = (title: string) =>
  title
    .trim()
    .replace(/^[a-z]+(\([^)]*\))?!?:\s+/i, '')
    .replace(/\s*\(#\d+\)$/, '')
    .trim() || title.trim();

/** One preview in the lists: a floor's main app, or one of its PRs. */
export interface PreviewRow {
  key: string; // "<repoId>:main" or "<repoId>:pr-<n>"
  repoId: string;
  floor: number;
  project: string; // the repo's short name
  pr: number | null;
  title: string; // "Live app (main)", or the PR's plain title
  word: StatusWord | null; // a PR's status word
  status: PreviewStatus;
  led: ReturnType<typeof channelLed>;
  startedAt: number | null; // while running or starting
  stopsAt: number | null;
  usedAt: number; // a PR preview's last use (viewedAt), 0 for main or none
  live: boolean; // in #204's live set (main always is)
  needsYou: boolean;
  mine: boolean; // passed QA on a floor that doesn't merge by itself: the manager's to check and merge
}

interface AgentRow {
  id: string;
  name: string;
  /** "testing PR #202" */
  doing: string;
  row: PreviewRow;
}

export interface PreviewLists {
  running: PreviewRow[];
  projects: { repo: RepoView; rows: PreviewRow[] }[];
  agents: AgentRow[];
  prs: PreviewRow[];
  /** Rows outside the live set, hidden until "Show older (N)". */
  older: number;
}

export interface ListInputs {
  repos: RepoView[];
  agents: Agent[];
  prPreviews: Record<string, PrPreviewView>;
  qa: Record<string, QaView>;
  now: number;
  recentHours: number;
  current: string | null; // the selected row's key keeps its place in the live set
  first?: string | null; // what the page opened on: first in Running now (#414)
}

/** store.ts qaKey, which can't be imported here: the store needs a browser. */
const qaKey = (repoId: string, pr: number) => `${repoId}#${pr}`;
const prKey = (repoId: string, pr: number) => `${repoId}:pr-${pr}`;
const mainKey = (repoId: string) => `${repoId}:main`;
const shortName = (fullName: string) => fullName.split('/')[1] ?? fullName;
const up = (led: PreviewRow['led']) => led === 'live' || led === 'busy';

/** Every floor's previews, grouped. `showOlder`: include PRs outside the live set (and merged ones). */
export function previewLists(x: ListInputs, showOlder: boolean): PreviewLists {
  const projects: PreviewLists['projects'] = [];
  const all: PreviewRow[] = [];
  let older = 0;
  for (const repo of x.repos) {
    const project = shortName(repo.fullName);
    const mainLed = channelLed(repo.preview.status);
    const main: PreviewRow = {
      key: mainKey(repo.id),
      repoId: repo.id,
      floor: repo.floor,
      project,
      pr: null,
      title: `Live app (${repo.defaultBranch})`,
      word: null,
      status: repo.preview.status,
      led: mainLed,
      startedAt: up(mainLed) ? repo.preview.startedAt : null,
      stopsAt: repo.preview.stopsAt ?? null,
      usedAt: 0,
      live: true,
      needsYou: false,
      mine: false,
    };
    const currentPr = x.current?.startsWith(`${repo.id}:pr-`) ? Number(x.current.slice(repo.id.length + 4)) : null;
    const { live, older: old } = liveChannels(repo.pulls, { busy: busyPrs(x.agents, repo.id), previewing: previewingPrs(x.prPreviews, repo.id), current: currentPr, now: x.now, recentHours: x.recentHours });
    const merged = repo.pulls.filter((p) => p.state === 'MERGED').sort((a, b) => b.number - a.number);
    older += old.length + merged.length;
    const pulls = showOlder ? [...live, ...old, ...merged] : live;
    const rows = [main];
    for (const pull of pulls) {
      const qa = x.qa[qaKey(repo.id, pull.number)];
      const p = x.prPreviews[qaKey(repo.id, pull.number)];
      const on = x.agents.find((a) => a.repoId === repo.id && a.prNumber === pull.number && (a.status === 'preparing' || a.status === 'working'));
      const word = statusWord(pull, qa, on?.task);
      const led = channelLed(p?.status);
      rows.push({
        key: prKey(repo.id, pull.number),
        repoId: repo.id,
        floor: repo.floor,
        project,
        pr: pull.number,
        title: plainTitle(pull.title),
        word,
        status: p?.status ?? 'stopped',
        led,
        startedAt: up(led) ? (p?.startedAt ?? null) : null,
        stopsAt: p?.stopsAt ?? null,
        usedAt: p?.viewedAt ?? 0,
        live: live.includes(pull),
        needsYou: word === 'Waiting for you',
        mine: word === 'Ready' && !repo.autoMerge,
      });
    }
    projects.push({ repo, rows });
    all.push(...rows);
  }
  const byKey = new Map(all.map((r) => [r.key, r]));
  const agents: AgentRow[] = [];
  for (const a of x.agents) {
    if (a.prNumber == null || (a.status !== 'preparing' && a.status !== 'working')) continue;
    const row = byKey.get(prKey(a.repoId, a.prNumber));
    if (!row) continue;
    const verb = a.task === 'qa' ? 'testing' : a.task === 'fix' ? 'fixing' : 'building';
    agents.push({ id: a.id, name: a.name, doing: `${verb} PR #${a.prNumber}`, row });
  }
  agents.sort((a, b) => a.name.localeCompare(b.name));
  return {
    running: runningOrder(all.filter((r) => up(r.led)), x.first ?? null),
    projects,
    agents,
    prs: all.filter((r) => r.pr != null).sort((a, b) => (b.pr ?? 0) - (a.pr ?? 0)),
    older,
  };
}

/** Running now, like the viewer's strip (#414): what the page opened on, the live apps, then PRs by last use. */
const runningOrder = (rows: PreviewRow[], first: string | null) =>
  rows.map((r, i) => ({ r, i })).sort((a, b) => Number(b.r.key === first) - Number(a.r.key === first) || Number(b.r.pr == null) - Number(a.r.pr == null) || b.r.usedAt - a.r.usedAt || a.i - b.i).map(({ r }) => r);

// ---------- search and filters ----------

export type PreviewFilter = 'running' | 'needs' | 'mine';

export const FILTERS: [PreviewFilter, string][] = [
  ['running', 'Running'],
  ['needs', 'Needs you'],
  ['mine', 'Mine to check'],
];

/** Whether a row passes the filter chips that are on and every word typed (its project, PR number, title or word). */
export function rowMatches(r: PreviewRow, filters: Set<PreviewFilter>, query: string): boolean {
  if (filters.has('running') && !up(r.led)) return false;
  if (filters.has('needs') && !r.needsYou) return false;
  if (filters.has('mine') && !r.mine) return false;
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${r.project} ${r.pr == null ? 'main live app' : `pr #${r.pr} ${r.pr}`} ${r.title} ${r.word ?? ''}`.toLowerCase();
  return words.every((w) => text.includes(w));
}

// ---------- stats and times ----------

export interface PreviewsStats {
  used: number; // PR previews starting or running
  slots: number;
  mainUp: number; // floors whose live app is starting or running
  lastStarted: number | null;
}

export function previewsStats(repos: Pick<RepoView, 'preview'>[], prPreviews: Record<string, Pick<PrPreviewView, 'status' | 'startedAt'>>): PreviewsStats {
  const prs = Object.values(prPreviews).filter((p) => up(channelLed(p.status)));
  const mains = repos.filter((r) => up(channelLed(r.preview.status)));
  const starts = [...prs.map((p) => p.startedAt), ...mains.map((r) => r.preview.startedAt)].filter((t): t is number => t != null);
  return { used: prs.length, slots: PR_PREVIEW_SLOTS, mainUp: mains.length, lastStarted: starts.length ? Math.max(...starts) : null };
}

/** "4 min", "2 h 5 min": how long ago `since` was. */
export function ago(since: number, now: number): string {
  const min = Math.max(0, Math.floor((now - since) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

// ---------- the deep link ----------

/** `#previews/3/pr-12` → floor 3, PR 12; `#previews/3/main` → floor 3, main; `#previews` → the page with nothing picked. */
export function parsePreviewsHash(hash: string): { floor: number | null; pr: number | null } | null {
  const [page, floor, which] = hash.replace(/^#/, '').split('/');
  if (page !== 'previews') return null;
  const f = floor && /^\d+$/.test(floor) ? Number(floor) : null;
  const m = which?.match(/^pr-(\d+)$/);
  return { floor: f, pr: f != null && m ? Number(m[1]) : null };
}

export const previewsHash = (floor: number | null, pr: number | null) => (floor == null ? '#previews' : `#previews/${floor}/${pr == null ? 'main' : `pr-${pr}`}`);

/** A phone's switcher (#382): what is really on stage, main when the PR asked for is merged or gone, and its light. */
export function stageName(repo: Pick<RepoView, 'id' | 'fullName' | 'pulls' | 'preview'>, pr: number | null, prPreviews: Record<string, Pick<PrPreviewView, 'status'>>): { name: string; led: ReturnType<typeof channelLed> } {
  const project = repo.fullName.split('/')[1];
  const on = currentChannel(pr ?? undefined, repo.pulls);
  if (on == null) return { name: `${project} · live app`, led: channelLed(repo.preview.status) };
  return { name: `${project} · PR #${on}`, led: channelLed(prPreviews[`${repo.id}#${on}`]?.status) };
}
