// Providers & accounts (#247, docs/accounts.md): every login and API key the coding agents on this computer can run
// on. The registry holds no secret: API keys and setup tokens stay in secrets.json on the server.
import type { UsageReading } from './office.ts';
import type { UsageSource } from './usage.ts';

/** The coding agents an account can be for. */
export type AccountCli = 'claude' | 'codex';
/** A subscription signed in in its own config folder, an API key billed per token, or a `claude setup-token` token. */
export type AccountKind = 'subscription-login' | 'api-key' | 'setup-token';

export interface ProviderAccount {
  id: string;
  cli: AccountCli;
  kind: AccountKind;
  label: string;
  tags: string[]; // lowercase words an agent or the CEO can be pinned to ("max", "api", "backup")
  priority: number; // lower runs first
  enabled: boolean; // false: paused, out of the rotation
  plan?: string; // 'Max', 'Pro', 'API', …
  dailyCostCap?: number; // USD a day (API keys)
  tokenEnv?: string; // setup tokens: the office's environment variable holding it (never written down, as cloud.ts says)
  /** The login the office ran on before accounts: CLAUDE_CONFIG_DIR or ~/.claude (CODEX_HOME or ~/.codex). */
  builtIn?: boolean;
  /** Removed while sessions still ran on it: it goes once they finish. */
  removing?: boolean;
  limitHits?: number[]; // when it hit its usage limit, the last 7 days
  limitedUntil?: number | null; // a session hit its limit: until then
  limitSpans?: [number, number][]; // when it was limited (from, until), the last 7 days: its timeline bar (#248)
}

/** Ready / Near limit / Limited until … / Signed out / Paused, for the chip on its card. */
export type AccountStatus = 'ready' | 'near' | 'limited' | 'signed-out' | 'paused';

/** An account as Settings shows it: never its key, only the last 4 characters. */
export interface AccountView extends ProviderAccount {
  status: AccountStatus;
  until: number | null; // 'limited': when it's free again
  usage: UsageReading[]; // 5-hour and weekly, for subscriptions
  keyHint: string; // last 4 of the key or token, '' for a login
  configDir: string | null; // the login's folder on this computer (subscription logins)
  todayUsd: number;
  todaySessions: number;
  limitHits7d: number;
  agents: string[]; // ids of the agents (and the CEO) pinned to it, or to one of its tags
  running: number; // sessions on it right now
  signIn: SignInRun | null; // its last sign-in in its terminal since the office started (#302)
  loginPlan?: string; // the plan a Claude login really has, from its .credentials.json ("Max 20x"), never a token (#442)
  planWarning?: string; // that plan isn't the one its name, plan field or tags say
  tokenRefresh?: boolean; // its access token expired: still signed in, its next session refreshes it
}

/** A login's sign-in: `claude auth login` / `codex login`, or `claude setup-token` in its folder. */
export type SignInMode = 'login' | 'setup-token';

/** A sign-in in a login's terminal: running, or how it ended. */
export interface SignInRun {
  mode: SignInMode;
  running: boolean;
  ok: boolean;
  note: string; // when it's over: "Sign-in failed (400). Try again…", never anything typed
  // What its terminal shows, for the guided sign-in (#350):
  url?: string; // the sign-in page it printed
  deviceCode?: string; // Codex's one-time code for that page
  waiting?: boolean; // Claude Code's prompt waits for the code
  question?: { text: string; options: string[] }; // a menu the office didn't answer by itself
}

export interface AccountsView {
  accounts: AccountView[];
  rotation?: RotationStats; // absent in old journals
  sources?: UsageSource[]; // usage for every account and provider (#361), worst first: in the snapshot, then usageSources events
}

/** Settings → Providers & accounts → Rotation (#248): automatic fallback when an account is limited or signed out. */
export interface RotationSettings {
  on: boolean; // a session that hits a limit or a sign-out restarts on the next account
  apiLast: boolean; // API keys only once every subscription is out
  ceoClis: AccountCli[]; // other coding agents the CEO may fall back to when every account of its own is out
  agentsSwitchCli: boolean; // agents fall back to another coding agent when every account of theirs is out
}

/** One automatic switch: a session moved off an account that was out. Labels only, never a key. */
export interface AccountSwitch {
  at: number;
  agentId: string;
  agentName: string;
  fromId: string;
  from: string;
  toId: string;
  to: string;
  why: 'limited' | 'signed-out';
  until: number | null; // when the account it left is back, if known
  api: boolean; // it went to an API key
  usd: number; // what its session cost on that API key
}

/** Rotation's numbers for Providers & accounts and Mission control. */
export interface RotationStats {
  switchesToday: number;
  minutesSaved: number; // sessions that would otherwise have waited for the limit to reset
  apiUsd: number; // spent on API keys because of fallback, today
  recent: AccountSwitch[]; // the latest few, newest first
}
