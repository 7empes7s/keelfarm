// An agent session's live state, read from the session itself (#359): within a minute the office knows when an agent is
// blocked (a sign-in, setup screen, menu or error banner on screen), never started (no model turn 90 s in) or finished
// without the office noticing (its result printed, the task still open). Pure: the terminal runtime (cliRunner.ts) and
// the demo's fake sessions feed SessionWatch their screen every couple of seconds and act on what it says.

import { modelSupportMessage } from '../shared/claudeCode.ts';
import { isAccountMenu, menuDetails, menuReason, readMenu, type MenuRead } from '../shared/menuScreen.ts';

/** No model turn this long after starting: Enter is pressed once, then it's blocked. */
export const NOT_STARTED_MS = 90_000;
/** After that retry, how long it gets before it's marked blocked. */
export const RETRY_WAIT_MS = 30_000;
/** A result on screen this long with the task still open: the office completes it (or flags it). */
export const UNREGISTERED_MS = 60_000;
/** A screen read held this long before it counts (the office answers a folder-trust question by itself first). */
const HOLD_MS: Record<ScreenState, number> = { 'sign-in': 5_000, setup: 10_000, error: 30_000, menu: 60_000, ended: 0, working: 0, idle: 0 };
/** Menus and error banners count only once the session has been this quiet (the office answers its own prompts first). */
const QUIET_FOR: Partial<Record<ScreenState, number>> = { error: 30_000, menu: 60_000 };

/** A failed turn's error (StopFailure) in plain words when the office knows it, else null: a model newer than the bundled Claude Code (#546). */
export const plainTurnError = (error: string, details: string): string | null => modelSupportMessage(`${error} ${details}`);

/** Why a session isn't moving. */
export type StuckKind = 'sign-in' | 'setup' | 'menu' | 'error' | 'not-started' | 'unregistered' | 'prompt';
export interface Stuck {
  kind: StuckKind;
  /** Shown after "Blocked: ". */
  reason: string;
  /** The menu on screen, when there is one (#640). */
  menu?: MenuRead;
}

export type ScreenState = 'sign-in' | 'setup' | 'menu' | 'error' | 'ended' | 'working' | 'idle';

// What each screen says, checked in this order: a working indicator means any sign-in words, error line or list above
// it are history (a curl's 401, a diff of this file), since a sign-in or setup screen never shows one.
const SIGN_IN = /Select login method|Not logged in|run \/login|Sign in with ChatGPT|Please login|Invalid API key|OAuth token has expired|Paste code here if prompted|401 Unauthorized/i;
const SETUP: [RegExp, string][] = [
  [/Choose the text style/i, 'the theme screen'],
  [/Do you trust the files in this folder|Is this a project you created or one you trust|allow Codex to work in this folder|Do you trust the contents of this directory/i, 'the folder-trust screen'],
  [/Bypass Permissions mode|Settings Error|Press Enter to continue/i, 'a first-run screen'],
];
const ENDED = /To continue this session, run codex resume/i;
const WORKING = /esc to interrupt/i;
const ERRORS: [RegExp, string][] = [
  [/credit balance is too low|insufficient_quota|out of credits?/i, 'out of credit'],
  [/usage limit|rate limit|limit reached|hit your limit|API Error:? \(?429/i, 'a rate limit'],
  [/API Error|stream error/i, 'an API error'],
];

/** A numbered list with a selection marker: Claude Code's and Codex's menus (permission, approval, choices). */
const menuOnScreen = (screen: string) => /^\s*[❯›]\s*1\.\s+\S/m.test(screen) && /^\s*2\.\s+\S/m.test(screen);

/** What a CLI's visible screen shows. reason: the words for a stuck state. */
export function classifyScreen(screen: string): { state: ScreenState; reason: string } {
  if (ENDED.test(screen)) return { state: 'ended', reason: 'the session ended' };
  if (WORKING.test(screen)) return { state: 'working', reason: '' };
  if (SIGN_IN.test(screen)) return { state: 'sign-in', reason: 'needs sign-in' };
  for (const [re, what] of SETUP) if (re.test(screen)) return { state: 'setup', reason: `needs setup (${what})` };
  if (menuOnScreen(screen)) {
    const menu = readMenu(screen);
    return { state: 'menu', reason: menu ? menuReason(menu) : 'a menu on screen' };
  }
  const unsupported = modelSupportMessage(screen);
  if (unsupported) return { state: 'error', reason: unsupported };
  for (const [re, what] of ERRORS) if (re.test(screen)) return { state: 'error', reason: what };
  return { state: 'idle', reason: '' };
}

const STUCK_STATES: Partial<Record<ScreenState, StuckKind>> = { 'sign-in': 'sign-in', setup: 'setup', menu: 'menu', error: 'error' };

/** Whether the watchdog may type a nudge into this screen: never into a menu, a sign-in or setup screen, or a finished one. */
export function canNudge(screen: string, tail: readonly string[] = [], required: readonly string[] | null = null): boolean {
  const { state } = classifyScreen(screen);
  return (state === 'working' || state === 'idle' || state === 'error') && !printedResult(tail, required);
}

/** A schema's own `properties` object has every key too, but a report's verdict is a string. */
const isReport = (obj: object) => !('verdict' in obj) || typeof obj.verdict === 'string';

const PR_URL = /https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/;

/** The closing brace matching the one at `from`, skipping strings; -1 if it isn't there. */
function closing(s: string, from: number): number {
  let depth = 0;
  let str = false;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (str) {
      if (c === '\\') i++;
      else if (c === '"') str = false;
    } else if (c === '"') str = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

/**
 * The session's final result read off its terminal, or null. A session that ends with a report (required: its schema's
 * keys) must show a JSON object with all of them: rows are trimmed of the TUI's borders and joined with spaces, so a
 * report the CLI wrapped still parses. Others show the pull request they opened or pushed to, or a session that ended.
 * text: what goes to the office as the session's last message (a report in a ```json block).
 */
export function printedResult(tail: readonly string[], required: readonly string[] | null): { text: string } | null {
  const rows = tail.map((l) => l.replace(/^[\s│┃|]+|[\s│┃|]+$/g, '')).filter(Boolean);
  if (required) {
    const flat = rows.join(' ');
    for (let i = flat.lastIndexOf('{'), tries = 0; i >= 0 && tries < 200; i = flat.lastIndexOf('{', i - 1), tries++) {
      const end = closing(flat, i);
      if (end < 0) continue;
      try {
        const obj = JSON.parse(flat.slice(i, end + 1)) as unknown;
        if (obj && typeof obj === 'object' && !Array.isArray(obj) && required.every((k) => k in obj) && isReport(obj)) return { text: `\`\`\`json\n${JSON.stringify(obj)}\n\`\`\`` };
      } catch {
        // not this brace: an inner or partial object
      }
      if (i === 0) break;
    }
    return null;
  }
  return rows.some((r) => PR_URL.test(r) || ENDED.test(r)) ? { text: rows.slice(-30).join('\n') } : null;
}

export interface WatchTick {
  now: number;
  /** The CLI took a model turn (a hook said so); a working indicator on screen counts too. */
  begun: boolean;
  /** The visible rows. */
  screen: string;
  /** The last rows of scrollback and screen. */
  tail: readonly string[];
  /** Since the session's last output or hook. */
  quietMs: number;
}

export type WatchAction = { do: 'none' } | { do: 'blocked'; stuck: Stuck } | { do: 'clear' } | { do: 'retry' } | { do: 'complete'; text: string };

/**
 * One session's live state, fed a tick every couple of seconds. It says when the session turns blocked (once per
 * state) and when that's over, when to press Enter once on a session that hasn't started, and when to complete a
 * session whose result is on screen. checkStart false: a CLI with no reliable sign of a model turn (OpenCode).
 */
export class SessionWatch {
  begun = false;
  private stuck: Stuck | null = null;
  private held: { state: ScreenState; since: number } | null = null;
  private retriedAt: number | null = null;
  private resultSince: number | null = null;

  constructor(
    private readonly started: number,
    private readonly required: readonly string[] | null = null,
    private readonly checkStart = true,
  ) {}

  get state(): Stuck | null {
    return this.stuck;
  }

  tick(t: WatchTick): WatchAction {
    const read = classifyScreen(t.screen);
    if (t.begun || read.state === 'working') this.begun = true;
    if (this.held?.state !== read.state) this.held = { state: read.state, since: t.now };
    const kind = STUCK_STATES[read.state];
    const menu = kind === 'menu' || kind === 'setup' ? readMenu(t.screen) : null; // a sign-in screen is its own
    if (kind && t.now - this.held.since >= HOLD_MS[read.state] && t.quietMs >= (QUIET_FOR[read.state] ?? 0)) return this.become({ kind, reason: read.reason, ...(menu && { menu }) });
    // A result on screen with the CLI no longer working: the turn ended without the office hearing of it.
    const result = this.begun && (read.state === 'idle' || read.state === 'ended') ? printedResult(t.tail, this.required) : null;
    if (!result && read.state === 'ended' && this.begun) return this.become({ kind: 'unregistered', reason: "finished, but the office couldn't read its result" });
    if (result) {
      this.resultSince ??= t.now;
      if (t.now - this.resultSince >= UNREGISTERED_MS) return { do: 'complete', text: result.text };
    } else this.resultSince = null;
    if (!this.begun && this.checkStart && t.now - this.started >= NOT_STARTED_MS) {
      if (this.retriedAt === null && read.state !== 'menu' && !isAccountMenu(menu)) {
        this.retriedAt = t.now;
        return { do: 'retry' };
      }
      if (t.now - (this.retriedAt ?? this.started) >= RETRY_WAIT_MS) return this.become({ kind: 'not-started', reason: "hasn't started: no model turn in 2 minutes" });
      return { do: 'none' };
    }
    // Moving again (or never got that far): whatever held it is over.
    const over = this.stuck && (this.stuck.kind === 'not-started' ? this.begun : this.stuck.kind === 'unregistered' ? read.state === 'working' : !kind);
    if (over) {
      this.stuck = null;
      return { do: 'clear' };
    }
    return { do: 'none' };
  }

  private become(s: Stuck): WatchAction {
    if (this.stuck?.kind === s.kind && this.stuck.reason === s.reason) return { do: 'none' };
    this.stuck = s;
    return { do: 'blocked', stuck: s };
  }
}

interface WatchHands {
  log(text: string, error: boolean): void;
  blocked(s: Stuck | null): void;
  retry(): void;
  complete(text: string): void;
}

/** Act on a watch's step, the same for a real CLI (cliRunner.ts) and the demo's fake sessions. label: the CLI's name. */
export function actOn(act: WatchAction, label: string, h: WatchHands) {
  if (act.do === 'blocked') {
    h.log(`⛔ Blocked: ${act.stuck.reason}. Open the terminal to answer it.`, true);
    h.blocked(act.stuck);
  } else if (act.do === 'clear') h.blocked(null);
  else if (act.do === 'retry') {
    h.log(`↻ ${label} hasn't started after 90 seconds: the office pressed Enter once.`, false);
    h.retry();
  } else if (act.do === 'complete') {
    h.log(`✓ ${label} printed its result a minute ago, but the office never heard it finish: completing the task.`, false);
    h.complete(act.text);
  }
}

// ---------- telling the manager and the CEO ----------

/** A prompt the office may still answer (or the manager is answering) is told after this long; anything else at once. */
export const NOTIFY_PROMPT_MS = 5 * 60_000;

/** The blocked state an agent's runtime keeps (swarm/model.ts). */
export interface BlockedState {
  reason: string;
  since: number;
  told: boolean;
  kind?: StuckKind;
  menu?: MenuRead;
}

/** Whether to tell the manager and the CEO about this blocked state now: once per state, a prompt only after 5 minutes. */
export function alertDue(b: BlockedState | null | undefined, now: number): boolean {
  return !!b && !b.told && ((b.kind ?? 'prompt') !== 'prompt' || now - b.since >= NOTIFY_PROMPT_MS);
}

/**
 * Whether to tell the manager and the CEO now, recording it: due, and this state not told yet for this task (a state
 * that clears and comes back is told once). task: the agent and their task's start; told: what was told.
 */
export function alertOnce(told: Set<string>, task: string, b: BlockedState | null | undefined, now: number): boolean {
  if (!b || !alertDue(b, now)) return false;
  b.told = true;
  const key = `${task}:${b.kind ?? 'prompt'}`;
  if (told.has(key)) return false;
  told.add(key);
  return true;
}

/** Forget what was told about tasks that are over. tasks: every agent's current task. */
export function forgetTold(told: Set<string>, tasks: ReadonlySet<string>) {
  for (const key of told) if (!tasks.has(key.slice(0, key.lastIndexOf(':')))) told.delete(key);
}

/** The manager's notification for it: words and the action that fixes it. */
export function stuckNotice(name: string, b: BlockedState, now: number, floor?: number): { title: string; body: string; who: string; actions: ('terminal' | 'retry')[]; details?: string } {
  const n = stuckWords(name, b, now, floor);
  return b.menu ? { ...n, details: menuDetails(b.menu) } : n;
}

function stuckWords(name: string, b: BlockedState, now: number, floor?: number): { title: string; body: string; who: string; actions: ('terminal' | 'retry')[] } {
  const kind = b.kind ?? 'prompt';
  const on = floor === undefined ? '' : ` on floor ${floor}`;
  const who = floor === undefined ? name : `${name} (floor ${floor})`;
  const reason = b.reason.replace(/\.$/, '').slice(0, 200);
  // An account's state, not a stuck agent: the office never presses its options (#640).
  if (isAccountMenu(b.menu)) return { title: `${name}'s account: ${b.menu!.class.slice('account/'.length)}`, body: `Their coding agent shows its account menu${on}: ${reason}. The office won't pick an option for them; open their terminal to choose.`, who, actions: ['terminal'] };
  if (kind === 'sign-in') return { title: `${name} needs sign-in`, body: `Their coding agent is on its sign-in screen${on}. Open their terminal and sign in there.`, who, actions: ['terminal'] };
  if (kind === 'not-started') return { title: `${name} hasn't started`, body: `No model turn in 2 minutes${on}, even after the office pressed Enter. Open their terminal, or retry.`, who, actions: ['terminal', 'retry'] };
  if (kind === 'unregistered') return { title: `${name} finished, but it didn't register`, body: `Their session ended${on} without a result the office could read. Open their terminal, or retry.`, who, actions: ['terminal', 'retry'] };
  if (kind === 'prompt') return { title: `${name} is blocked`, body: `Waiting ${Math.round((now - b.since) / 60_000)} minutes on ${reason}${on}. Open their terminal to answer it.`, who, actions: ['terminal'] };
  return { title: `${name} is blocked`, body: `Blocked: ${reason}${on}. Open their terminal to answer it.`, who, actions: kind === 'error' ? ['terminal', 'retry'] : ['terminal'] };
}

/** The keys a session's report must have (its output schema's `required`), or null for a session without one. */
export function requiredKeys(schema: Record<string, unknown> | undefined): string[] | null {
  if (!schema) return null;
  return Array.isArray(schema.required) ? schema.required.map(String) : [];
}
