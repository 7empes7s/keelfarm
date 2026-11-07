// "What this PR changes" (#203), as pure helpers: the pages to look at (QA's screenshots, else a guess from the
// changed files), the path an agent's browser is on, and where a PR's preview opens the first time.

import type { AgentView, QaShotView } from '../../../shared/types';
import { comparePath } from './channels';

/** A page worth looking at on a PR: its path, and the QA screenshot (index, caption) that showed it, if any. */
export interface PrPage {
  path: string;
  caption: string;
  shot: number | null;
}

/**
 * The path of a page an agent's browser showed ("/settings/team?x=1#top"), from its full address. A preview seen
 * through the office (/preview/<port>/…) loses that prefix. null for nothing, about:blank, data: and file: pages.
 */
export function pagePath(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url.startsWith('/') ? comparePath(url) : null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const path = u.pathname.replace(/^\/preview\/\d+(?=\/|$)/, '') || '/';
  return comparePath(`${path}${u.search}${u.hash}`);
}

/** QA's screenshots as pages: one per path, in the order QA took them (the home page last: rarely the change), the first shot of each path kept. */
export function shotPages(shots: Pick<QaShotView, 'page' | 'caption'>[] | undefined): PrPage[] {
  const out: PrPage[] = [];
  (shots ?? []).forEach((s, i) => {
    const path = pagePath(s.page);
    if (path && !out.some((p) => p.path === path)) out.push({ path, caption: s.caption, shot: i });
  });
  return [...out.filter((p) => p.path !== '/'), ...out.filter((p) => p.path === '/')];
}

// ---------- pages guessed from the changed files ----------

/** A changed file's pattern and the route it shows ($1… from the pattern). */
type RouteRule = [RegExp, string];

// This office's screens: client/src/ui/<Screen>.tsx → the console's hash route.
const OFFICE_ROUTES: RouteRule[] = [
  [/^client\/src\/ui\/(Charter\w*)\.tsx$/, '/#company/charter'],
  [/^client\/src\/ui\/(MemoryMap|MapCanvas)\.tsx$/, '/#company/map'],
  [/^client\/src\/ui\/(CostsSection|CostCards|MissionConsole)\.tsx$/, '/#company/ops'],
  [/^client\/src\/ui\/(AgentSettings|AgentCard)\.tsx$/, '/#work/team'],
  [/^client\/src\/ui\/(CeoMemory|CeoFollowups)\.tsx$/, '/#ceo/ceo'],
  [/^client\/src\/ui\/(ToolsSettings)\.tsx$/, '/#ceo/tools'],
  [/^client\/src\/ui\/(HistoryTab)\.tsx$/, '/#history/history'],
  [/^client\/src\/ui\/(TimeLapse)\.tsx$/, '/#history/timelapse'],
  [/^client\/src\/ui\/(AccessibilitySettings)\.tsx$/, '/#settings/access'],
  [/^client\/src\/ui\/(CloudSettings)\.tsx$/, '/#settings/cloud-agents'],
  [/^client\/src\/ui\/(Notify\w*)\.tsx$/, '/#settings/notifications'],
  [/^client\/src\/ui\/(VoiceSettings)\.tsx$/, '/#settings/voice'],
];

// Any floor: file-based routers (Next.js app and pages folders, SvelteKit routes).
const COMMON_ROUTES: RouteRule[] = [
  [/^(?:src\/)?app\/(.*?)\/?page\.(?:tsx|jsx|ts|js|mdx)$/, '/$1'],
  [/^(?:src\/)?pages\/(.*?)(?:\/index)?\.(?:tsx|jsx|vue|astro|md|mdx)$/, '/$1'],
  [/^(?:src\/)?routes\/(.*?)\/?\+page\.svelte$/, '/$1'],
];

/** Each floor's own rules, by repo name (this office's own repo and its old name). */
const FLOOR_ROUTES: Record<string, RouteRule[]> = { keelfarm: OFFICE_ROUTES, cubefarm: OFFICE_ROUTES, 'office-swarm': OFFICE_ROUTES };

/** Pages a PR probably changes, from its changed files, for a PR QA hasn't screenshotted. At most `max`. */
export function routesFromFiles(repoFullName: string, files: string[] | undefined, max = 4): PrPage[] {
  const rules = [...(FLOOR_ROUTES[repoFullName.split('/').pop()?.toLowerCase() ?? ''] ?? []), ...COMMON_ROUTES];
  const out: PrPage[] = [];
  for (const file of files ?? []) {
    const f = file.replace(/\\/g, '/');
    const rule = rules.find(([re]) => re.test(f));
    if (!rule) continue;
    // route groups "(marketing)" and dynamic segments stay as written: a guess to start from
    const path = comparePath(f.replace(rule[0], rule[1]).replace(/\/\([^)]*\)/g, '').replace(/\/index$/, '') || '/');
    if (!out.some((p) => p.path === path)) out.push({ path, caption: f.split('/').pop() ?? f, shot: null });
    if (out.length >= max) break;
  }
  return out;
}

/** The pages to look at on a PR: QA's, else the guess from its files. */
export const prPages = (repoFullName: string, shots: Pick<QaShotView, 'page' | 'caption'>[] | undefined, files: string[] | undefined): PrPage[] => {
  const fromQa = shotPages(shots);
  return fromQa.length ? fromQa : routesFromFiles(repoFullName, files);
};

/** The agent testing or fixing a PR right now, if any: the card's live tile follows their browser. */
export function liveAgent<A extends Pick<AgentView, 'repoId' | 'prNumber' | 'task' | 'status'>>(agents: Record<string, A>, repoId: string, pr: number): A | null {
  for (const a of Object.values(agents)) {
    if (a.repoId === repoId && a.prNumber === pr && (a.task === 'qa' || a.task === 'fix') && (a.status === 'working' || a.status === 'preparing')) return a;
  }
  return null;
}

// ---------- opening at the change, once per PR ----------

/** What this browser remembers per PR ("owner/repo#12"): the path last shown, and whether the card was closed. */
export type PrMemory = Record<string, { path?: string; closed?: boolean; at: number }>;

const MEMORY_MAX = 60;

/**
 * The path a PR's preview opens at: where it was left, else the first page to look at (remembered from then on),
 * else "/" (not remembered, so pages found later still open it at the change).
 */
export function openingPath(memory: PrMemory, key: string, first: string | null | undefined, now: number): { path: string; memory: PrMemory } {
  const seen = memory[key];
  if (seen?.path) return { path: seen.path, memory };
  if (!first) return { path: '/', memory };
  return { path: first, memory: remember(memory, key, { path: first }, now) };
}

/** The card is open the first time a PR is viewed, then as it was left. */
export const cardOpen = (memory: PrMemory, key: string) => !memory[key]?.closed;

/** Note something about a PR, keeping the newest MEMORY_MAX PRs. */
export function remember(memory: PrMemory, key: string, patch: { path?: string; closed?: boolean }, now: number): PrMemory {
  const next: PrMemory = { ...memory, [key]: { ...memory[key], ...patch, at: now } };
  const keys = Object.keys(next);
  if (keys.length <= MEMORY_MAX) return next;
  keys.sort((a, b) => next[a].at - next[b].at);
  for (const k of keys.slice(0, keys.length - MEMORY_MAX)) delete next[k];
  return next;
}
