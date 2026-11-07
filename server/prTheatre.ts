// The PR theatre's decisions, kept pure for tests: which slot, worktree and port a PR preview gets, which one makes
// room for a new one, and when one stops on its own (nobody watching, or its PR is no longer open). A preview an
// agent's QA lab or fix session is using (held) never stops for room or idleness (#204); nor does a floor's main
// preview, which also stops after its own idle time.

/** PR previews at once, besides each floor's main preview. */
export const MAX_PR_PREVIEWS = 2;
/** How often an open viewer says what it has on screen. */
export const WATCH_EVERY_MS = 30_000;
/** A viewer that hasn't said so for this long has closed. */
export const WATCH_MS = 75_000;

/** A slot's worktree (desks/<slug>) and the branch it checks the PR out on. Slots are reused, so installs can be skipped. */
export const prSlug = (slot: number) => `preview-pr-${slot}`;
export const prBranch = (slot: number) => `swarm-preview-pr-${slot}`;
export const prKey = (repoId: string, pr: number) => `${repoId}#${pr}`;
/** A floor's main preview, as viewers watch it and agents hold it. */
export const mainKey = (repoId: string) => `${repoId}#main`;

/** Settings: an open PR updated within this many hours gets a channel chip of its own (#204). */
export const DEFAULT_PREVIEW_RECENT_HOURS = 48;
/** Settings: a floor's main preview stops after this many minutes with nobody watching; 0 = never. */
export const DEFAULT_MAIN_PREVIEW_IDLE_MIN = 30;

export function clampRecentHours(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(1, Math.min(24 * 90, n)) : DEFAULT_PREVIEW_RECENT_HOURS;
}

export function clampMainIdleMin(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(24 * 60, n)) : DEFAULT_MAIN_PREVIEW_IDLE_MIN;
}

/** Both preview settings, clamped: the patch's where it has them, else the current ones. */
export function previewSettings(s: { previewRecentHours?: unknown; mainPreviewIdleMin?: unknown }, patch: { previewRecentHours?: unknown; mainPreviewIdleMin?: unknown }) {
  return { previewRecentHours: clampRecentHours(patch.previewRecentHours ?? s.previewRecentHours), mainPreviewIdleMin: clampMainIdleMin(patch.mainPreviewIdleMin ?? s.mainPreviewIdleMin) };
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
}

/** The lowest slot no PR preview holds, or null when they're all taken. */
export function freeSlot(runs: Pick<PrRunInfo, 'slot'>[], slots = MAX_PR_PREVIEWS): number | null {
  for (let s = 1; s <= slots; s++) if (!runs.some((r) => r.slot === s)) return s;
  return null;
}

/** The PR previews some viewer has on screen: each viewer's latest word, if it's recent enough. */
export function onScreen(watches: Iterable<{ key: string | null; at: number }>, now: number, watchMs = WATCH_MS): Set<string> {
  const out = new Set<string>();
  for (const w of watches) if (w.key && now - w.at <= watchMs) out.add(w.key);
  return out;
}

/**
 * Which PR preview stops to make room for a new one: never one on screen or held by an agent; a failed one first, then
 * the one unwatched the longest. Null: every one is on screen or held.
 */
export function pickEviction(runs: PrRunInfo[], screen: Set<string>): string | null {
  const idle = runs.filter((r) => !screen.has(r.key) && !r.held);
  idle.sort((a, b) => Number(a.active) - Number(b.active) || a.viewedAt - b.viewedAt);
  return idle[0]?.key ?? null;
}

/** PR previews nobody has had on screen for idleMs, and no agent holds. */
export function expired(runs: PrRunInfo[], screen: Set<string>, now: number, idleMs: number): string[] {
  return runs.filter((r) => !screen.has(r.key) && !r.held && now - r.viewedAt >= idleMs).map((r) => r.key);
}

/** When an unwatched preview stops for being idle; null while it's on screen or held, or with no idle stop (idleMs 0). */
export function stopsAt(x: { active: boolean; viewedAt: number; watched: boolean; held: boolean }, idleMs: number): number | null {
  return x.active && idleMs > 0 && !x.watched && !x.held ? x.viewedAt + idleMs : null;
}

/** Does a floor's main preview stop now? Set up or running, idle stop on, nobody watching, no agent on it, idle long enough. */
export function mainExpired(x: { active: boolean; viewedAt: number; watched: boolean; held: boolean }, now: number, idleMs: number): boolean {
  const at = stopsAt(x, idleMs);
  return at !== null && now >= at;
}

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
