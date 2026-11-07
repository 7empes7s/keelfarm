// The PR theatre's channels, as pure helpers: a floor's big screen and app viewer show "main" (the floor's own
// preview) or one of its open PRs, each PR running in a preview of its own.

import type { AgentView, PreviewStatus, PreviewView, PrPreviewView, PullInfo, QaStatus, QaView } from '../../../shared/types';
import type { IconName } from './icons';

/** What a floor's screen shows: its main preview (null) or an open PR's. */
export type Channel = number | null;

export const QA_BADGE: Record<QaStatus, { icon: IconName; text: string }> = {
  queued: { icon: 'hourglass', text: 'QA queued' },
  testing: { icon: 'search', text: 'QA testing' },
  passed: { icon: 'circle-check', text: 'QA passed' },
  failed: { icon: 'circle-x', text: 'QA failed' },
  fixing: { icon: 'wrench', text: 'being fixed' },
  'needs-human': { icon: 'hand', text: 'needs you' },
};

/** A PR's QA state in a few words, '' when QA hasn't seen it. */
export const qaBadge = (qa?: Pick<QaView, 'status'> | null) => (qa ? QA_BADGE[qa.status].text : '');

/** Shorten to max characters with an ellipsis. */
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** "PR #212 · Outside 5 · ✅ QA passed" */
export function channelLabel(pull: Pick<PullInfo, 'number' | 'title'>, qa?: Pick<QaView, 'status'> | null, max = 32): string {
  return [`PR #${pull.number}`, clip(pull.title.trim(), max), qaBadge(qa)].filter(Boolean).join(' · ');
}

/** PR previews that run at once (server/prTheatre.ts MAX_PR_PREVIEWS). */
export const PR_PREVIEW_SLOTS = 2;

/** A floor's open PRs, in channel order (oldest first, like channel numbers). Never an outsider's: it isn't previewed (#185). */
export const channelPulls = (pulls: PullInfo[]) => pulls.filter((p) => p.state === 'OPEN' && !p.untrusted).sort((a, b) => a.number - b.number);

/** What decides which open PRs get a chip of their own (#204). */
export interface LiveInputs {
  busy: Set<number>; // PRs an agent is building, fixing or testing now
  previewing: Set<number>; // PRs whose preview is starting or running
  current: Channel; // the one on screen keeps its chip
  now: number;
  recentHours: number; // settings.previewRecentHours
}

/**
 * The chips: main, then the open PRs an agent works on now, that have a preview starting or running, are on screen,
 * or were updated in the last `recentHours`. Every other open PR folds under one "Older (N)" chip. Merged or closed
 * PRs never show (channelPulls).
 */
export function liveChannels(pulls: PullInfo[], x: LiveInputs): { live: PullInfo[]; older: PullInfo[] } {
  const recent = (p: PullInfo) => x.now - (Date.parse(p.updatedAt ?? p.createdAt) || 0) <= x.recentHours * 3_600_000;
  const live: PullInfo[] = [];
  const older: PullInfo[] = [];
  for (const p of channelPulls(pulls)) (x.busy.has(p.number) || x.previewing.has(p.number) || x.current === p.number || recent(p) ? live : older).push(p);
  return { live, older };
}

/** The floor's PRs an agent is on now (preparing or working on a task that has a PR). */
export const busyPrs = (agents: Pick<AgentView, 'repoId' | 'status' | 'prNumber'>[], repoId: string) =>
  new Set(agents.flatMap((a) => (a.repoId === repoId && a.prNumber != null && (a.status === 'preparing' || a.status === 'working') ? [a.prNumber] : [])));

/** The floor's PRs whose preview is being set up or running. */
export const previewingPrs = (prPreviews: Record<string, Pick<PrPreviewView, 'repoId' | 'pr' | 'status'>>, repoId: string) =>
  new Set(Object.values(prPreviews).flatMap((p) => (p.repoId === repoId && channelLed(p.status) !== 'off' && channelLed(p.status) !== 'bad' ? [p.pr] : [])));

/** "stops in 12 min" for an unwatched preview with an idle stop; '' when it won't stop by itself. */
export function stopsLabel(stopsAt: number | null | undefined, now: number): string {
  if (stopsAt == null) return '';
  const min = Math.max(1, Math.ceil((stopsAt - now) / 60_000));
  return `stops in ${min} min`;
}

/** The channel on screen: the picked PR while it's still open, otherwise main. */
export function currentChannel(picked: Channel | undefined, pulls: Pick<PullInfo, 'number' | 'state'>[]): Channel {
  return picked != null && pulls.some((p) => p.number === picked && p.state === 'OPEN') ? picked : null;
}

/** A PR preview in the floor preview's shape, for the screen and the viewer's stage. None yet reads as stopped. */
export function prAsPreview(p: PrPreviewView | undefined, pr: number): PreviewView {
  return {
    status: p?.status ?? 'stopped',
    port: p?.port ?? 0,
    url: p?.url ?? null,
    ref: `PR #${pr}`,
    pr,
    commit: p?.commit ?? null,
    startedAt: p?.startedAt ?? null,
    error: p?.error ?? null,
    logTail: p?.logTail ?? [],
    stopsAt: p?.stopsAt ?? null,
    heldBy: p?.heldBy ?? null,
  };
}

/** A channel chip's light: live, getting ready, failed, or off. */
export function channelLed(status: PreviewStatus | undefined): 'live' | 'busy' | 'bad' | 'off' {
  if (status === 'running') return 'live';
  if (status === 'preparing' || status === 'installing' || status === 'starting') return 'busy';
  return status === 'error' ? 'bad' : 'off';
}

/** Where a QA screenshot is served (v: the QA record's update time, so a new round's shots aren't cached). */
export const qaShotUrl = (repoId: string, pr: number, index: number, v: number) => `/api/repos/${encodeURIComponent(repoId)}/pulls/${pr}/qa-shots/${index}?v=${v}`;

/** A path typed in compare mode, as both frames load it: always starting with "/". */
export function comparePath(input: string): string {
  const t = input.trim().replace(/^https?:\/\/[^/]+/i, '');
  return t.startsWith('/') ? t : `/${t}`;
}

/** Load `path` from a preview's address (its url ends with "/"). */
export const atPath = (url: string, path: string) => `${url.replace(/\/+$/, '')}${comparePath(path)}`;

/** The office is open on its own computer, where a preview's http://localhost:<port>/ is the app. */
export const onOfficeComputer = (at: Pick<Location, 'hostname'>) => /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(at.hostname);

/**
 * A preview's address as this browser can open it: as it is on the office's computer; from anywhere else (a tablet
 * over Tailscale) through the office's own address at /preview/<port>/ (server/previewGateway.ts).
 */
export function reachable(url: string, at: Pick<Location, 'hostname' | 'origin'>): string {
  if (onOfficeComputer(at)) return url;
  const m = url.match(/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d+)(\/.*)?$/i);
  return m ? `${at.origin}/preview/${m[1]}${m[2] || '/'}` : url;
}

// ---------- the big screen's channel strip ----------

/** The PRs that get a chip on the big screen: all of them up to `max`, else the newest, the one on screen always kept. */
export function stripPulls(prs: number[], current: Channel, max = 6): number[] {
  if (prs.length <= max) return prs;
  const out = prs.slice(-max);
  if (current != null && prs.includes(current) && !out.includes(current)) out[0] = current;
  return out.sort((a, b) => a - b);
}

export interface ChipRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where `count` channel chips sit on the big screen's canvas (w × h px): a centred row along the bottom. */
export function chipRects(count: number, w: number, h: number): ChipRect[] {
  const gap = 16;
  const ch = 64;
  const cw = Math.min(190, (w - 80 - gap * (count - 1)) / count);
  const x0 = (w - (count * cw + (count - 1) * gap)) / 2;
  return Array.from({ length: count }, (_, i) => ({ x: x0 + i * (cw + gap), y: h - ch - 18, w: cw, h: ch }));
}

// ---------- compare mode's path sync ----------

export type Side = 'main' | 'pr';

/** What compare mode remembers to sync paths: where each side last said it was, and where it was last sent. */
export interface PathSync {
  at: Record<Side, string | null>;
  asked: Record<Side, string | null>;
  relays: number[]; // when paths were passed on lately
}

export const newPathSync = (): PathSync => ({ at: { main: null, pr: null }, asked: { main: null, pr: null }, relays: [] });

/**
 * A side reports its path: whether to send the other side there (and note it). Not when it's the echo of where we
 * sent this side, not when the other side is already there, and at most 4 times in 3 s, so two apps that redirect
 * each other around can't bounce forever.
 */
export function relayPath(s: PathSync, from: Side, path: string, now: number): boolean {
  const to: Side = from === 'main' ? 'pr' : 'main';
  s.at[from] = path;
  if (s.asked[from] === path) {
    s.asked[from] = null;
    return false;
  }
  if (s.at[to] === path) return false;
  s.relays = s.relays.filter((t) => now - t < 3000);
  if (s.relays.length >= 4) return false;
  s.relays.push(now);
  s.asked[to] = path;
  return true;
}
