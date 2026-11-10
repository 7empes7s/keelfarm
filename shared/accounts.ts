// Providers & accounts (#247, docs/accounts.md), pure: the built-in accounts, which account a session runs on (pinned
// id, tag, or the rotation), what that changes in its environment, the status chip and the manager's edits.
import { livePct } from './usage.ts';
import type { AccountCli, AccountKind, AccountStatus, ProviderAccount, UsageReading } from './types.ts';

export const ACCOUNT_CLIS: AccountCli[] = ['claude', 'codex'];
export const ACCOUNT_KINDS: AccountKind[] = ['subscription-login', 'api-key', 'setup-token'];
/** The binding that means "whichever the rotation picks" (also '' or absent). */
const ROTATION = 'rotation';
export const LABEL_MAX = 40;
const TAGS_MAX = 6;
/** Usage this full counts as "Near limit". */
const NEAR_PCT = 80;
const DAY_MS = 24 * 60 * 60_000;
const HITS_DAYS = 7;

/** Where Claude Code keeps an API key or setup token for a session: in its environment, read by apiKeyHelper. */
export const ACCOUNT_KEY_ENV = 'CUBEFARM_ANTHROPIC_KEY';

/** The logins the office ran on before accounts, so nothing changes until a second one is added. */
export const builtInAccounts = (): ProviderAccount[] => [
  { id: 'claude-login', cli: 'claude', kind: 'subscription-login', label: 'Claude login on this computer', tags: [], priority: 0, enabled: true, builtIn: true },
  { id: 'codex-login', cli: 'codex', kind: 'subscription-login', label: 'Codex login on this computer', tags: [], priority: 0, enabled: true, builtIn: true },
];

/** A saved registry with the built-in accounts put back if missing, and anything malformed dropped. */
export function normaliseAccounts(saved: unknown): ProviderAccount[] {
  const list = Array.isArray(saved) ? (saved as ProviderAccount[]).filter((a) => a && typeof a.id === 'string' && ACCOUNT_CLIS.includes(a.cli) && ACCOUNT_KINDS.includes(a.kind)) : [];
  for (const b of builtInAccounts()) if (!list.some((a) => a.id === b.id)) list.push(b);
  return list.map((a) => ({ ...a, tags: Array.isArray(a.tags) ? a.tags : [], priority: Number(a.priority) || 0, enabled: a.enabled !== false }));
}

const byPriority = (a: ProviderAccount, b: ProviderAccount) => a.priority - b.priority;

/**
 * The account a session runs on: the pinned account (by id, any state but removing), else the first enabled one with
 * the pinned tag, else the rotation (the first enabled one of its coding agent by priority). null: none of its coding
 * agent's is enabled, so it runs as before accounts.
 */
export function resolveAccount(accounts: readonly ProviderAccount[], binding: string | undefined, cli: AccountCli): ProviderAccount | null {
  const mine = accounts.filter((a) => a.cli === cli && !a.removing).sort(byPriority);
  const b = (binding ?? '').trim().toLowerCase();
  if (b && b !== ROTATION) {
    const pinned = mine.find((a) => a.id === b);
    if (pinned) return pinned;
    const tagged = mine.find((a) => a.enabled && a.tags.includes(b));
    if (tagged) return tagged;
  }
  return mine.find((a) => a.enabled) ?? null;
}

/** Checks a binding from configure_agent or Settings: '' and 'rotation' clear it. Returns what to save, or throws. */
export function checkBinding(accounts: readonly ProviderAccount[], raw: string): string | undefined {
  const b = raw.trim().toLowerCase();
  if (!b || b === ROTATION) return undefined;
  if (accounts.some((a) => a.id === b && !a.removing) || accounts.some((a) => a.tags.includes(b) && !a.removing)) return b;
  const tags = [...new Set(accounts.flatMap((a) => a.tags))];
  throw new Error(`No account or tag "${raw}". Accounts: ${accounts.map((a) => `${a.id} (${a.label})`).join(', ')}${tags.length ? `; tags: ${tags.join(', ')}` : ''}; or "rotation".`);
}

/** Who's pinned to an account: by its id or one of its tags. */
export const pinnedTo = (a: ProviderAccount, binding: string | undefined) => !!binding && (binding === a.id || a.tags.includes(binding));

// ---------- a session's environment ----------

/** A subscription login's own folder: <SWARM_HOME>/accounts/<id>/<claude|codex>. */
export const accountDir = (join: (...p: string[]) => string, home: string, a: Pick<ProviderAccount, 'id' | 'cli'>) => join(home, 'accounts', a.id, a.cli);

/** The login folder a built-in account is: what Claude Code and Codex use on their own. */
export function builtInDir(join: (...p: string[]) => string, cli: AccountCli, env: Record<string, string | undefined>, homedir: string): string {
  if (cli === 'claude') return env.CLAUDE_CONFIG_DIR?.trim() || join(homedir, '.claude');
  return env.CODEX_HOME?.trim() || join(homedir, '.codex');
}

/** What a session on an account adds to its environment. `keyEnv`: Claude Code reads its key from it through apiKeyHelper. */
export interface AccountSetup {
  env: Record<string, string>;
  keyEnv: string | null;
}

/**
 * What a session on an account runs with. A built-in account changes nothing; another login points the CLI at its own
 * folder; a Claude API key goes through apiKeyHelper (never ANTHROPIC_API_KEY, never on disk); a setup token through
 * CLAUDE_CODE_OAUTH_TOKEN; an OpenAI key through OPENAI_API_KEY / CODEX_API_KEY. `secret` is the key ('' for logins).
 */
export function accountSetup(a: ProviderAccount, dir: string, secret: string): AccountSetup {
  if (a.builtIn) return { env: {}, keyEnv: null };
  if (a.kind === 'subscription-login') return { env: a.cli === 'claude' ? { CLAUDE_CONFIG_DIR: dir } : { CODEX_HOME: dir }, keyEnv: null };
  if (a.cli === 'codex') return { env: secret ? { OPENAI_API_KEY: secret, CODEX_API_KEY: secret } : {}, keyEnv: null };
  if (a.kind === 'setup-token') return { env: secret ? { CLAUDE_CODE_OAUTH_TOKEN: secret } : {}, keyEnv: null };
  return secret ? { env: { [ACCOUNT_KEY_ENV]: secret }, keyEnv: ACCOUNT_KEY_ENV } : { env: {}, keyEnv: null };
}

// ---------- status ----------

export interface StatusInput {
  account: ProviderAccount;
  signedIn: boolean; // a login on file, or a key saved
  usage: readonly UsageReading[];
  todayUsd: number;
  now: number;
}

/** The chip on its card, and until when it's limited. */
export function accountStatus(x: StatusInput): { status: AccountStatus; until: number | null } {
  const { account: a, now } = x;
  if (!a.enabled || a.removing) return { status: 'paused', until: null };
  if (!x.signedIn) return { status: 'signed-out', until: null };
  const full = x.usage.filter((r) => r.pct >= 100 && r.resetsAt && r.resetsAt > now).map((r) => r.resetsAt!);
  if (a.limitedUntil && a.limitedUntil > now) full.push(a.limitedUntil);
  if (a.dailyCostCap && x.todayUsd >= a.dailyCostCap) full.push(startOfDay(now) + DAY_MS);
  if (full.length) return { status: 'limited', until: Math.max(...full) };
  if (x.usage.some((r) => livePct(r, now) >= NEAR_PCT)) return { status: 'near', until: null };
  return { status: 'ready', until: null };
}

// ---------- the plan a login really has (#442) ----------

const PLAN_WORDS = ['pro', 'max', 'ultra', 'team', 'enterprise'];
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/** A Claude login's plan from its .credentials.json fields: subscriptionType "max" and rateLimitTier "default_claude_max_20x" → "Max 20x". */
export function loginPlanName(subscriptionType: unknown, rateLimitTier: unknown): string | null {
  const type = typeof subscriptionType === 'string' ? subscriptionType.trim().toLowerCase() : '';
  if (!/^[a-z_]{1,20}$/.test(type)) return null;
  const tier = typeof rateLimitTier === 'string' ? /_(\d{1,2}x)$/i.exec(rateLimitTier)?.[1].toLowerCase() : undefined;
  return `${cap(type.replace(/_/g, ' '))}${tier ? ` ${tier}` : ''}`;
}

/**
 * A warning when the plan a login really has isn't the one its name, plan field or tags say ("Claude Ultra" signed in
 * with a Pro account); null when they agree or none names a plan. An Ultra login read Max until 2026-11-08, so Max passes for Ultra.
 */
export function planWarning(a: Pick<ProviderAccount, 'label' | 'plan' | 'tags'>, loginPlan: string | null | undefined): string | null {
  if (!loginPlan) return null;
  const words = [a.plan ?? '', a.label, ...a.tags].join(' ').toLowerCase().split(/[^a-z]+/);
  const claimed = words.find((w) => PLAN_WORDS.includes(w));
  const real = loginPlan.split(' ')[0].toLowerCase();
  if (!claimed || claimed === real || (claimed === 'ultra' && real === 'max')) return null;
  return `This login is ${loginPlan}, not ${cap(claimed)}: sign in with the ${cap(claimed)} account.`;
}

const startOfDay = (now: number) => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Today's sessions and spend on an account, from the cost ledger's lines (ones from before accounts were the built-in Claude login's). */
export function accountSpend(lines: readonly { at: number; usd: number; account?: string }[], a: Pick<ProviderAccount, 'id' | 'builtIn' | 'cli'>, now: number) {
  const from = startOfDay(now);
  const mine = lines.filter((l) => l.at >= from && (l.account ? l.account === a.id : a.builtIn && a.cli === 'claude'));
  return { usd: Math.round(mine.reduce((s, l) => s + l.usd, 0) * 100) / 100, sessions: mine.length };
}

/** Limit hits kept: the last 7 days. */
export const recentHits = (hits: readonly number[] | undefined, now: number) => (hits ?? []).filter((t) => now - t <= HITS_DAYS * DAY_MS);

// ---------- the manager's edits ----------

export interface AccountPatch {
  label?: unknown;
  tags?: unknown;
  enabled?: unknown;
  plan?: unknown;
  dailyCostCap?: unknown;
}

/** Tags as saved: lowercase words (letters, digits, - and _), no duplicates, at most TAGS_MAX. */
export function cleanTags(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\s]+/) : [];
  const tags = list.map((t) => String(t).trim().toLowerCase()).filter((t) => /^[a-z0-9][a-z0-9_-]{0,23}$/.test(t) && t !== ROTATION);
  return [...new Set(tags)].slice(0, TAGS_MAX);
}

/** An account with the manager's edit applied; throws a message the manager can act on. */
export function applyPatch(a: ProviderAccount, p: AccountPatch): ProviderAccount {
  const next = { ...a };
  if (p.label !== undefined) {
    const label = String(p.label).trim().slice(0, LABEL_MAX);
    if (!label) throw new Error('An account needs a name.');
    next.label = label;
  }
  if (p.tags !== undefined) next.tags = cleanTags(p.tags);
  if (p.enabled !== undefined) next.enabled = !!p.enabled;
  if (p.plan !== undefined) next.plan = String(p.plan).trim().slice(0, 20) || undefined;
  if (p.dailyCostCap !== undefined) {
    const cap = p.dailyCostCap === null || p.dailyCostCap === '' ? 0 : Number(p.dailyCostCap);
    if (!Number.isFinite(cap) || cap < 0 || cap > 10_000) throw new Error('A daily cost cap is a number of dollars, 0 for none.');
    next.dailyCostCap = cap || undefined;
  }
  return next;
}

/** Move an account one place up (-1) or down (+1) among its coding agent's, renumbering their priorities 0, 1, 2… */
export function moveAccount(accounts: readonly ProviderAccount[], id: string, by: -1 | 1): ProviderAccount[] {
  const a = accounts.find((x) => x.id === id);
  if (!a) return [...accounts];
  const mine = accounts.filter((x) => x.cli === a.cli).sort(byPriority);
  const at = mine.indexOf(a);
  const to = Math.max(0, Math.min(mine.length - 1, at + by));
  mine.splice(at, 1);
  mine.splice(to, 0, a);
  const prio = new Map(mine.map((x, i) => [x.id, i]));
  return accounts.map((x) => (prio.has(x.id) ? { ...x, priority: prio.get(x.id)! } : x));
}

/** Removing an account: at once when nothing runs on it, else it's paused and goes when its sessions finish. Built-ins stay. */
export function removal(a: ProviderAccount, running: number): 'now' | 'wait' | 'refused' {
  if (a.builtIn) return 'refused';
  return running > 0 ? 'wait' : 'now';
}

/** A setup token's environment variable name: letters, digits and _, as shells allow. */
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** A new account's id: its coding agent and a short random part, e.g. claude-k3x9q2. */
export const newAccountId = (cli: AccountCli, rand: () => number = Math.random) => `${cli}-${rand().toString(36).slice(2, 8).padEnd(6, '0')}`;

/** Where the manager sees each account's bill and usage. */
export const BILLING_LINKS: Record<AccountCli, Partial<Record<AccountKind, string>>> = {
  claude: { 'subscription-login': 'https://claude.ai/settings/usage', 'setup-token': 'https://claude.ai/settings/usage', 'api-key': 'https://console.anthropic.com/settings/billing' },
  codex: { 'subscription-login': 'https://chatgpt.com/codex/settings/usage', 'api-key': 'https://platform.openai.com/usage' },
};

/** One plain sentence per kind: what it's billed to and what it touches. */
export function kindSentence(cli: AccountCli, kind: AccountKind): string {
  const plan = cli === 'claude' ? 'Claude subscription (Pro or Max)' : 'ChatGPT plan';
  if (kind === 'subscription-login') return `Uses a ${plan}'s usage limits, signed in in its own folder. Nothing is billed per token.`;
  if (kind === 'setup-token') return `A year-long token from claude setup-token: uses that subscription's limits, like its login.`;
  return `Billed per token to that ${cli === 'claude' ? 'Anthropic' : 'OpenAI'} API account. It never uses or changes your subscription.`;
}
