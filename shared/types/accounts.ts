// Providers & accounts (#247, docs/accounts.md): every login and API key the coding agents on this computer can run
// on. The registry holds no secret: API keys and setup tokens stay in secrets.json on the server.
import type { UsageReading } from './office.ts';

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
}

/** A login's sign-in: `claude auth login` / `codex login`, or `claude setup-token` in its folder. */
export type SignInMode = 'login' | 'setup-token';

/** A sign-in in a login's terminal: running, or how it ended. */
export interface SignInRun {
  mode: SignInMode;
  running: boolean;
  ok: boolean;
  note: string; // when it's over: "Sign-in failed (400). Try again…", never anything typed
}

export interface AccountsView {
  accounts: AccountView[];
}
