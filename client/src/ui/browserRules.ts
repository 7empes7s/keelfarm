// An agent's browser card (#230), as pure helpers: what the address bar says and whether it opens in the floor's
// preview, the caption ("@Grace's browser · 2 min ago"), whether they're browsing right now, and the full-screen
// viewer's zoom and pan limits.

import type { AgentView, PullInfo } from '../../../shared/types';
import { pagePath } from './prChangesRules';

export interface AddressBar {
  /** The address without its scheme, or "address unknown". */
  text: string;
  unknown: boolean;
  secure: boolean;
  /** The path to open in the floor's preview, when the address is one of the floor's apps; null: plain text. */
  previewPath: string | null;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

/** The address bar for an agent's last known address (null: none known yet). */
export function addressBar(url: string | null | undefined): AddressBar {
  if (!url) return { text: 'address unknown', unknown: true, secure: false, previewPath: null };
  let u: URL | null = null;
  try {
    u = new URL(url);
  } catch {
    // not a full address: shown as it came
  }
  const text = u ? url.replace(/^https?:\/\//, '') : url;
  // The floor's app runs on this computer (an agent's dev server, a preview) or comes through the office's /preview/<port>/.
  const preview = !!u && (u.protocol === 'http:' || u.protocol === 'https:') && (LOOPBACK.has(u.hostname) || /^\/preview\/\d+(\/|$)/.test(u.pathname));
  return { text, unknown: false, secure: u?.protocol === 'https:', previewPath: preview ? pagePath(url) : null };
}

/** Where the address link opens the app viewer: the agent's PR channel while that PR is open, else main at the path
 *  (saying so when the PR merged; agents keep their prNumber after it merges, and the viewer refuses a merged PR). */
export function previewTarget(prNumber: number | null | undefined, pulls: readonly Pick<PullInfo, 'number' | 'state' | 'headSha'>[], path: string): { pr: number | null; path: string; merged?: { pr: number; sha: string; path: string } } {
  const pull = prNumber == null ? undefined : pulls.find((p) => p.number === prNumber);
  if (pull?.state === 'OPEN') return { pr: pull.number, path };
  if (pull?.state === 'MERGED') return { pr: null, path, merged: { pr: pull.number, sha: (pull.headSha ?? '').slice(0, 7), path } };
  return { pr: null, path };
}

/** How long ago, in a few words. */
export function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : new Date(at).toLocaleDateString();
}

/** "@Grace's browser · 2 min ago". */
export const shotCaption = (name: string, at: number | null, now: number) => `@${name}'s browser${at ? ` · ${ago(at, now)}` : ''}`;

const BROWSING_MS = 60_000;

/** Their session is browsing: at work and on a browser tool now, or a screenshot in the last minute. */
export function isBrowsing(agent: Pick<AgentView, 'status' | 'currentTool' | 'screenshotAt'>, now: number): boolean {
  if (agent.status !== 'working') return false;
  const tool = agent.currentTool ?? '';
  return tool.startsWith('mcp__playwright__') || tool.startsWith('mcp__office__lab_') || (!!agent.screenshotAt && now - agent.screenshotAt < BROWSING_MS);
}

// ---------- the full-screen viewer ----------

const ZOOM = { min: 1, max: 5 } as const;

export const clampZoom = (z: number) => Math.min(ZOOM.max, Math.max(ZOOM.min, Number.isFinite(z) ? z : 1));

/** A pan (px from centred) kept so the zoomed picture still covers its box: at 1× it stays centred. */
export function clampPan(pan: { x: number; y: number }, zoom: number, box: { w: number; h: number }) {
  const mx = ((zoom - 1) * box.w) / 2;
  const my = ((zoom - 1) * box.h) / 2;
  return { x: Math.min(mx, Math.max(-mx, pan.x)), y: Math.min(my, Math.max(-my, pan.y)) };
}
