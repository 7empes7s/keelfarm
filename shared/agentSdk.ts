// Keeping the agents' built-in Claude current (#569): the Agent SDK the office bundles (its Claude Code) against the
// npm registry's latest, checked daily with no AI tokens. When it's behind, the office files one bump issue on its own
// floor; an agent builds it (npm regenerates the lock in their worktree), QA and auto-merge land it, and the office's
// self-update installs it. A model the bundled Claude Code can't run starts that bump at once. Pure: the decisions.
import { versionAtLeast } from './claudeCode.ts';

export const SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk';
/** The registry is asked this often (also on start-up, and at once when a model needs a newer Claude Code). */
export const CHECK_EVERY_MS = 24 * 3600_000;
/** Behind this long with no bump in flight: the alarm card. */
export const ALARM_AFTER_MS = 7 * 24 * 3600_000;
/** The bump issues' titles start with this, so an open one is found again after a restart. */
const BUMP_PREFIX = 'Bump the Agent SDK to ';

/** One Agent SDK release: its version and the Claude Code it bundles (package.json's claudeCodeVersion). */
export interface SdkRelease {
  version: string;
  claudeCode: string | null;
}

/** What the office keeps between checks (<SWARM_HOME>/agent-sdk.json). */
export interface SdkUpdateState {
  checkedAt: number | null;
  latest: SdkRelease | null;
  /** Why the last check failed, or null. */
  error: string | null;
  /** The first check that found the office behind, while it still is. */
  behindSince: number | null;
  /** The bump issue last filed, on the office's own floor. */
  bump: { issue: number; version: string; at: number } | null;
  /** Models the manager has been told need a newer built-in Claude (said once each). */
  told: string[];
}

const emptySdkState = (): SdkUpdateState => ({ checkedAt: null, latest: null, error: null, behindSince: null, bump: null, told: [] });

/** A saved state read back, anything malformed dropped. */
export function loadSdkState(raw: unknown): SdkUpdateState {
  const s = { ...emptySdkState(), ...(raw && typeof raw === 'object' ? (raw as Partial<SdkUpdateState>) : {}) };
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const rel = (v: unknown): SdkRelease | null => {
    const r = v as Partial<SdkRelease> | null;
    return r && typeof r.version === 'string' ? { version: r.version, claudeCode: typeof r.claudeCode === 'string' ? r.claudeCode : null } : null;
  };
  const b = s.bump as SdkUpdateState['bump'];
  return {
    checkedAt: num(s.checkedAt),
    latest: rel(s.latest),
    error: typeof s.error === 'string' ? s.error : null,
    behindSince: num(s.behindSince),
    bump: b && typeof b.issue === 'number' && typeof b.version === 'string' ? { issue: b.issue, version: b.version, at: num(b.at) ?? 0 } : null,
    told: Array.isArray(s.told) ? s.told.filter((m): m is string => typeof m === 'string').slice(-20) : [],
  };
}

/** The registry's `/latest` manifest as a release; throws when it doesn't look like one. */
export function releaseOf(manifest: unknown): SdkRelease {
  const m = manifest as { version?: unknown; claudeCodeVersion?: unknown } | null;
  if (!m || typeof m.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(m.version)) throw new Error('the registry answered without a version');
  return { version: m.version, claudeCode: typeof m.claudeCodeVersion === 'string' ? m.claudeCodeVersion : null };
}

export const isBumpTitle = (title: string) => title.startsWith(BUMP_PREFIX);
export const isBehind = (installed: SdkRelease | null, latest: SdkRelease | null) => !!installed && !!latest && !versionAtLeast(installed.version, latest.version);

interface SdkInput {
  installed: SdkRelease | null;
  latest: SdkRelease | null;
  /** An open bump issue or PR, or one merged and waiting for the office's self-update. */
  inFlight: boolean;
  /** The office runs from one of its floors' checkouts, so it can file the bump there. */
  canBump: boolean;
  behindSince: number | null;
  now: number;
}

/** After a check: since when it's behind (null: up to date), and whether to file a bump issue now (behind, none in flight). */
export function sdkStep(i: SdkInput): { behindSince: number | null; bump: boolean } {
  if (!isBehind(i.installed, i.latest)) return { behindSince: null, bump: false };
  return { behindSince: i.behindSince ?? i.now, bump: !i.inFlight && i.canBump };
}

const claudeOf = (r: SdkRelease) => (r.claudeCode ? `Claude Code ${r.claudeCode}` : `Agent SDK ${r.version}`);

/** The alarm card's words: behind for more than a week with no bump in flight; else null. */
export function sdkAlarm(i: SdkInput): string | null {
  if (!isBehind(i.installed, i.latest) || i.inFlight || i.behindSince === null || i.now - i.behindSince <= ALARM_AFTER_MS) return null;
  const days = Math.floor((i.now - i.behindSince) / 86_400_000);
  return `The agents' built-in Claude is ${days} days behind ${claudeOf(i.latest!)}${i.canBump ? '' : ", and this office can't file its own update (it doesn't run from a floor's checkout)"}. New models may not run until it's updated.`;
}

/** The bump issue the office files: the package, the lock regenerated by npm, nothing else. */
export function bumpIssue(installed: SdkRelease | null, latest: SdkRelease, why: string | null): { title: string; body: string } {
  return {
    title: `${BUMP_PREFIX}${latest.version}${latest.claudeCode ? ` (Claude Code ${latest.claudeCode})` : ''}`,
    body: [
      `The agents run the Claude Code bundled in \`${SDK_PACKAGE}\`. This office has ${installed ? `${installed.version}${installed.claudeCode ? ` (Claude Code ${installed.claudeCode})` : ''}` : 'an unknown version'}; the latest is ${latest.version}.${why ? ` ${why}` : ''}`,
      '',
      `1. Run \`npm install ${SDK_PACKAGE}@^${latest.version}\` in your worktree, so npm updates package.json and regenerates package-lock.json. Never hand-edit the lock.`,
      '2. Fix only what the new version breaks; typecheck, test, lint and build stay green.',
      '',
      "The office's self-update installs it once it merges. Filed by the office's daily check (#569).",
    ].join('\n'),
  };
}

/** A failed session's errors say its model needs a newer Claude Code (the API's words, or #546's plain ones). */
export const needsNewerClaude = (errors: string[]) => errors.some((e) => /does\s+not\s+support\s+this\s+model|can't run this model/i.test(e));

/** The manager's one line when a model starts the bump. */
export const modelLine = (model: string) => `${model} needs a newer built-in Claude; updating.`;

/** "latest 2.1.330, checked 09:14" next to the bundled version, or why the check failed. */
export function latestLabel(v: Pick<SdkUpdateView, 'latest' | 'checkedAt' | 'error'>, clock: (at: number) => string): string | null {
  if (!v.checkedAt) return null;
  const when = `checked ${clock(v.checkedAt)}`;
  if (v.error) return `Couldn't check for a newer one (${v.error}), ${when}`;
  return v.latest ? `latest ${v.latest.claudeCode ?? v.latest.version}, ${when}` : null;
}

/** What Settings → Providers shows next to the bundled version. */
export interface SdkUpdateView {
  installed: SdkRelease | null;
  latest: SdkRelease | null;
  checkedAt: number | null;
  error: string | null;
  checking: boolean;
  behind: boolean;
  /** The bump on the office's own floor: its issue still open, or merged and waiting for the office's self-update. */
  bump: { issue: number; floor: number; merged: boolean } | null;
  alarm: string | null;
}
