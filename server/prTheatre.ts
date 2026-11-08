// The PR theatre's decisions, kept pure for tests: which slot, worktree and port a PR preview gets, which one makes
// room for a new one, and when one stops on its own (no use for its idle time, past its lifetime, or its PR is no
// longer open). A preview an agent's QA lab or fix session is using (held) never stops for room or idleness (#204),
// nor does one the manager keeps running (📌). Use is any real use (#252): the app viewer on screen, traffic or an open
// socket through the preview gateway, or the heartbeat the gateway puts in its pages; idle time counts from the last.

import type { PreviewPin } from '../shared/types.ts';

/** PR previews at once, besides each floor's main preview. */
export const MAX_PR_PREVIEWS = 2;
/** A viewer that hasn't said what it has on screen for this long has closed (it says so every 15 s while visible). */
export const WATCH_MS = 40_000;
/** The least idle time after the last use of any kind: a reload, a reconnect or a tab switch never stops a preview in use. */
const USE_GRACE_MS = 60_000;
/** The lifetime banner ("Still using it?") shows this long before a preview reaches its max lifetime. */
const LIFE_WARN_MS = 60_000;

/** A slot's worktree (desks/<slug>) and the branch it checks the PR out on. Slots are reused, so installs can be skipped. */
export const prSlug = (slot: number) => `preview-pr-${slot}`;
export const prBranch = (slot: number) => `swarm-preview-pr-${slot}`;
export const prKey = (repoId: string, pr: number) => `${repoId}#${pr}`;
/** A floor's main preview, as viewers watch it and agents hold it. */
export const mainKey = (repoId: string) => `${repoId}#main`;

/** Settings: an open PR updated within this many hours gets a channel chip of its own (#204). */
const DEFAULT_PREVIEW_RECENT_HOURS = 48;
/** Settings: a floor's main preview (and a PR's, unless SWARM_PR_PREVIEW_IDLE_MIN says otherwise) stops this many minutes after its last use; 0 = never. */
const DEFAULT_MAIN_PREVIEW_IDLE_MIN = 1;
/** Settings: no max lifetime by default. */
const DEFAULT_PREVIEW_MAX_LIFE_HOURS = 0;

export function clampRecentHours(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(1, Math.min(24 * 90, n)) : DEFAULT_PREVIEW_RECENT_HOURS;
}

/** Minutes of no use before a preview stops: 0 (never) or 1 to a day. */
export function clampMainIdleMin(v: unknown, fallback = DEFAULT_MAIN_PREVIEW_IDLE_MIN): number {
  const n = Number(v);
  if (v === null || v === '' || !Number.isFinite(n)) return fallback;
  return n <= 0 ? 0 : Math.max(1, Math.min(24 * 60, Math.round(n)));
}

/** Hours a preview may run at most before asking "Still using it?": 0 (off) or 1 to a week. */
export function clampMaxLifeHours(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(24 * 7, n)) : DEFAULT_PREVIEW_MAX_LIFE_HOURS;
}

type PreviewSettingKeys = 'previewRecentHours' | 'mainPreviewIdleMin' | 'prPreviewIdleMin' | 'previewMaxLifeHours';

/** The preview settings, clamped: the patch's where it has them, else the current ones. prDefault: the PR idle stop's fallback (SWARM_PR_PREVIEW_IDLE_MIN). */
export function previewSettings(s: Partial<Record<PreviewSettingKeys, unknown>>, patch: Partial<Record<PreviewSettingKeys, unknown>>, prDefault = DEFAULT_MAIN_PREVIEW_IDLE_MIN) {
  return {
    previewRecentHours: clampRecentHours(patch.previewRecentHours ?? s.previewRecentHours),
    mainPreviewIdleMin: clampMainIdleMin(patch.mainPreviewIdleMin ?? s.mainPreviewIdleMin),
    prPreviewIdleMin: clampMainIdleMin(patch.prPreviewIdleMin ?? s.prPreviewIdleMin, clampMainIdleMin(prDefault)),
    previewMaxLifeHours: clampMaxLifeHours(patch.previewMaxLifeHours ?? s.previewMaxLifeHours),
  };
}

/** A state file from before #252 still on the old 30-minute main idle stop moves to the new 1-minute default; a value the manager chose stays. */
export function upgradePreviewIdle(saved: { mainPreviewIdleMin?: unknown; prPreviewIdleMin?: unknown } | undefined): number | null {
  return saved && saved.prPreviewIdleMin === undefined && saved.mainPreviewIdleMin === 30 ? DEFAULT_MAIN_PREVIEW_IDLE_MIN : null;
}

/**
 * The ports a slot's preview may use, in order: one lane per slot in the hundred above the floor previews' base
 * (6401, 6403 … for slot 1 and 6402, 6404 … for slot 2 by default), never the floor previews' own hundred.
 */
export function prPortCandidates(base: number, slot: number, slots = MAX_PR_PREVIEWS): number[] {
  const out: number[] = [];
  for (let p = base + 100 + slot; p < base + 200; p += slots) out.push(p);
  return out;
}

/** What the rules need to know about a running (or failed) PR preview. */
export interface PrRunInfo {
  key: string;
  repoId: string;
  pr: number;
  slot: number;
  /** Being set up or running; false once it failed. */
  active: boolean;
  viewedAt: number;
  /** An agent's QA lab or fix session is using it. */
  held?: boolean;
  /** The manager keeps it running (📌). */
  pinned?: boolean;
}

/** The lowest slot no PR preview holds, or null when they're all taken. */
export function freeSlot(runs: Pick<PrRunInfo, 'slot'>[], slots = MAX_PR_PREVIEWS): number | null {
  for (let s = 1; s <= slots; s++) if (!runs.some((r) => r.slot === s)) return s;
  return null;
}

/** The previews some viewer has on screen: each viewer's latest word, if it's recent enough. */
export function onScreen(watches: Iterable<{ key: string | null; at: number }>, now: number, watchMs = WATCH_MS): Set<string> {
  const out = new Set<string>();
  for (const w of watches) if (w.key && now - w.at <= watchMs) out.add(w.key);
  return out;
}

/**
 * Which PR preview stops to make room for a new one: never one in use, held by an agent or kept running; a failed one
 * first, then the one unused the longest. Null: every one is in use, held or kept.
 */
export function pickEviction(runs: PrRunInfo[], screen: Set<string>): string | null {
  const idle = runs.filter((r) => !screen.has(r.key) && !r.held && !r.pinned);
  idle.sort((a, b) => Number(a.active) - Number(b.active) || a.viewedAt - b.viewedAt);
  return idle[0]?.key ?? null;
}

/** The previews' stats after one more stopped for no use, its lifetime or memory: what it used, added to what's been freed. */
export function addFreed(freed: { mb: number; count: number } | null | undefined, mb: number): { mb: number; count: number } {
  return { mb: (freed?.mb ?? 0) + Math.round(mb), count: (freed?.count ?? 0) + 1 };
}

/** What the idle and lifetime stops need to know about a preview. */
export interface PreviewUse {
  /** Being set up or running. */
  active: boolean;
  /** Its last use of any kind (or its start). */
  viewedAt: number;
  /** In use now: a visible app viewer has it on screen, or a request or socket to it is open through the gateway. */
  inUse: boolean;
  held: boolean;
  /** Kept running (📌) until then; Infinity: until the manager stops it; null: not kept. */
  pinnedUntil: number | null;
  /** Its lifetime counts from here: its start, or the last "Keep it running". */
  lifeFrom: number;
}

/** The settings the stops go by, in ms; 0: that stop is off. */
export interface StopRules {
  idleMs: number;
  maxLifeMs: number;
}

export const isPinned = (x: Pick<PreviewUse, 'pinnedUntil'>, now: number) => x.pinnedUntil !== null && x.pinnedUntil > now;

/** What a running preview keeps about its use. */
export interface PreviewUseState {
  viewedAt: number; // its last use of any kind (or its start), kept in previews.json too
  tabAt: number; // its last use through the gateway (its own tab): requests, sockets, the page's heartbeat
  open: number; // requests and sockets to it open through the gateway now
  pinnedUntil: number | null; // kept running (📌) until then; Infinity: until the manager stops it
  lifeFrom: number; // its lifetime counts from here: its start, or the last "Keep it running"
  stoppedIdle: boolean; // the office stopped it for no use or lifetime
}

export const freshUse = (now: number): PreviewUseState => ({ viewedAt: now, tabAt: 0, open: 0, pinnedUntil: null, lifeFrom: now, stoppedIdle: false });

/** In use in its own tab: a request or socket open through the gateway, or a use through it lately (the page's heartbeat comes every 15 s). */
export const inTab = (x: Pick<PreviewUseState, 'open' | 'tabAt'>, now: number) => x.open > 0 || (x.tabAt > 0 && now - x.tabAt <= WATCH_MS);

/** Until when a 📌 keeps a preview: an hour, until stopped (Infinity), or not at all. */
export const pinUntil = (how: 'hour' | 'forever' | 'off', now: number): number | null => (how === 'off' ? null : how === 'forever' ? Infinity : now + 3_600_000);

/** A preview's pin as the clients see it. */
export const pinView = (x: Pick<PreviewUseState, 'pinnedUntil'>, now: number): PreviewPin => (!isPinned(x, now) ? null : x.pinnedUntil === Infinity ? 'forever' : x.pinnedUntil);

/** When a preview stops for no use: never while in use, held or kept, and never sooner than the grace after its last use. Null: it won't. */
export function stopsAt(x: PreviewUse, rules: StopRules, now: number): number | null {
  if (!x.active || rules.idleMs <= 0 || x.inUse || x.held || isPinned(x, now)) return null;
  return x.viewedAt + Math.max(rules.idleMs, USE_GRACE_MS);
}

/** When a preview reaches its max lifetime (in use or not); null with no max lifetime, or while held or kept. */
export function lifeEndsAt(x: PreviewUse, rules: StopRules, now: number): number | null {
  if (!x.active || rules.maxLifeMs <= 0 || x.held || isPinned(x, now)) return null;
  return x.lifeFrom + rules.maxLifeMs;
}

/** Does a preview stop now, and why. */
export function stopWhy(x: PreviewUse, rules: StopRules, now: number): 'idle' | 'lifetime' | null {
  const idle = stopsAt(x, rules, now);
  if (idle !== null && now >= idle) return 'idle';
  const life = lifeEndsAt(x, rules, now);
  return life !== null && now >= life ? 'lifetime' : null;
}

/** "Still using it?": the lifetime banner shows in its last minute. */
export const lifeWarning = (x: PreviewUse, rules: StopRules, now: number) => {
  const end = lifeEndsAt(x, rules, now);
  return end !== null && end - now <= LIFE_WARN_MS;
};

/** The PR slot desks (desks/preview-pr-N) left in a floor's desks folder that no PR preview runs from: to remove. */
export function leftoverPrDesks(folders: string[], inUse: string[]): string[] {
  return folders.filter((f) => /^preview-pr-\d+$/.test(f) && !inUse.includes(f));
}

/**
 * The floor's PR previews whose PR merged or closed. A PR missing from the list counts as closed too (closed PRs
 * drop out of it), unless the open list was cut off at its limit.
 */
export function closedPrs(runs: PrRunInfo[], repoId: string, pulls: { number: number; state: string }[], openLimit = 50): string[] {
  const full = pulls.filter((p) => p.state === 'OPEN').length >= openLimit;
  return runs
    .filter((r) => r.repoId === repoId)
    .filter((r) => {
      const p = pulls.find((x) => x.number === r.pr);
      return p ? p.state !== 'OPEN' : !full;
    })
    .map((r) => r.key);
}
