// Providers & accounts (#247, docs/accounts.md): the registry of logins and keys the coding agents on this computer run
// on, in <SWARM_HOME>/accounts.json without a secret. API keys live in secrets.json (`account:<id>`); setup tokens are read from
// the office's environment and never written down (cloud.ts). A subscription login has its own folder under
// <SWARM_HOME>/accounts/<id>/, which its sign-in terminal and its sessions use as CLAUDE_CONFIG_DIR or CODEX_HOME.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HttpError } from './httpError.ts';
import { mergeSecrets, readSecrets } from './secrets.ts';
import { AgentTerminal } from './terminal.ts';
import { POLL_MS } from './usagePoll.ts';
import type { AccountCheck } from './accountCheck.ts';
import type { BoxSignIn } from './cliRunner.ts';
import {
  accountDir,
  accountSetup,
  accountSpend,
  accountStatus,
  ACCOUNT_CLIS,
  ACCOUNT_KINDS,
  applyPatch,
  builtInDir,
  cleanTags,
  ENV_NAME,
  LABEL_MAX,
  moveAccount,
  newAccountId,
  normaliseAccounts,
  pinnedTo,
  recentHits,
  removal,
  resolveAccount,
  type AccountPatch,
  type AccountSetup,
} from '../shared/accounts.ts';
import { mergeReadings } from '../shared/usage.ts';
import type { AccountCli, AccountKind, AccountsView, AccountView, ProviderAccount, UsageReading } from '../shared/types.ts';

const secretKey = (id: string) => `account:${id}`;
const hint = (s: string) => (s ? s.slice(-4) : '');

export interface AccountsDeps {
  secretsFile: string;
  home: string; // SWARM_HOME
  env: Record<string, string | undefined>;
  homedir?: string;
  /** The registry's file (<SWARM_HOME>/accounts.json): no secrets in it. */
  file: string;
  /** Test an account (accountCheck.ts; the demo's is fake). */
  check: (a: ProviderAccount, dir: string, secret: string) => Promise<AccountCheck>;
  /** A login's CLI signing in in a terminal, with its folder (cliRunner.ts startLocalSignIn; the demo's is fake). */
  signIn: (o: { cli: AccountCli; env: Record<string, string>; term: AgentTerminal }, exited: (code: number) => void) => BoxSignIn;
  /** The cost ledger's sessions, for today's spend per account. */
  spend: () => { at: number; usd: number; account?: string }[];
  /** Agents (and the CEO) with what they're pinned to. */
  agents: () => { id: string; account?: string }[];
  /** The built-in Claude login's readings: the office already keeps them (claudeUsage). */
  builtInUsage: () => UsageReading[];
  changed: (view: AccountsView) => void;
  /** The demo's made-up accounts, for a registry with only the built-in ones. */
  seed?: () => { accounts: ProviderAccount[]; keys: Record<string, string> };
  /** Check the logins now and every POLL_MS (off in tests). */
  poll?: boolean;
}

/** One session on an account: what it adds to the session's environment, and release() once it ends. */
export interface AccountUse extends AccountSetup {
  id: string;
  builtIn: boolean;
  release: () => void;
}

export interface NewAccount {
  cli?: unknown;
  kind?: unknown;
  label?: unknown;
  tags?: unknown;
  plan?: unknown;
  key?: unknown; // an API key
  tokenEnv?: unknown; // a setup token's environment variable
}

export class Accounts {
  private secrets = new Map<string, string>();
  private usage = new Map<string, UsageReading[]>();
  private signedIn = new Map<string, boolean>();
  private running = new Map<string, number>();
  private terms = new Map<string, AgentTerminal>();
  private signIns = new Map<string, BoxSignIn>();
  private timer: NodeJS.Timeout | null = null;
  private registry: ProviderAccount[] = normaliseAccounts([]);
  private writing: Promise<void> = Promise.resolve();

  constructor(private deps: AccountsDeps) {}

  async init() {
    const saved = await fs.readFile(this.deps.file, 'utf8').then((t) => JSON.parse(t) as unknown, () => null);
    this.registry = normaliseAccounts(saved);
    const seed = this.deps.seed && this.list().every((a) => a.builtIn) ? this.deps.seed() : null;
    if (seed) {
      this.registry = normaliseAccounts([...this.registry, ...seed.accounts]);
      await mergeSecrets(this.deps.secretsFile, Object.fromEntries(Object.entries(seed.keys).map(([id, k]) => [secretKey(id), k])));
    }
    const s = await readSecrets(this.deps.secretsFile);
    for (const a of this.list()) {
      const v = s[secretKey(a.id)];
      if (typeof v === 'string' && v) this.secrets.set(a.id, v);
    }
    if (seed || saved === null) void this.write(); // the built-ins are there from the first start
    if (!this.deps.poll) return;
    // Every login but the built-in one (the office reads that one already) is checked now, then every POLL_MS.
    void this.pollAll();
    this.timer ??= setInterval(() => void this.pollAll(), POLL_MS);
    this.timer.unref?.();
  }

  list(): ProviderAccount[] {
    return this.registry.map((a) => ({ ...a }));
  }

  private find(id: string): ProviderAccount {
    const a = this.list().find((x) => x.id === id);
    if (!a) throw new HttpError(404, 'No such account.');
    return a;
  }

  private save(list: ProviderAccount[]) {
    this.registry = normaliseAccounts(list);
    void this.write();
    this.emit();
  }

  /** The registry to its file (temp file + rename), one write after another. */
  private write(): Promise<void> {
    const text = JSON.stringify(this.registry, null, 2);
    const tmp = `${this.deps.file}.tmp`;
    this.writing = this.writing
      .then(async () => {
        await fs.mkdir(path.dirname(this.deps.file), { recursive: true });
        await fs.writeFile(tmp, text);
        await fs.rename(tmp, this.deps.file);
      })
      .catch((err) => console.warn('could not save the accounts', err));
    return this.writing;
  }

  /** Every write so far is on disk (tests). */
  flushed(): Promise<void> {
    return this.writing;
  }

  private replace(next: ProviderAccount) {
    this.save(this.list().map((a) => (a.id === next.id ? next : a)));
  }

  /** The folder a login uses: the built-in one's own, else <SWARM_HOME>/accounts/<id>/<cli>. */
  dirOf(a: ProviderAccount): string {
    return a.builtIn ? builtInDir(path.join, a.cli, this.deps.env, this.deps.homedir ?? os.homedir()) : accountDir(path.join, this.deps.home, a);
  }

  private secretOf(a: ProviderAccount): string {
    if (a.kind === 'setup-token') return (a.tokenEnv ? this.deps.env[a.tokenEnv] : '')?.trim() ?? '';
    return this.secrets.get(a.id) ?? '';
  }

  // ---------- views ----------

  view(now = Date.now()): AccountsView {
    const lines = this.deps.spend();
    const agents = this.deps.agents();
    return {
      accounts: this.list()
        .sort((a, b) => a.cli.localeCompare(b.cli) || a.priority - b.priority)
        .map((a): AccountView => {
          const usage = a.builtIn && a.cli === 'claude' ? this.deps.builtInUsage() : (this.usage.get(a.id) ?? []);
          const spend = accountSpend(lines, a, now);
          const secret = this.secretOf(a);
          const signedIn = a.kind === 'subscription-login' ? (this.signedIn.get(a.id) ?? !!a.builtIn) : !!secret && this.signedIn.get(a.id) !== false;
          return {
            ...a,
            ...accountStatus({ account: a, signedIn, usage, todayUsd: spend.usd, now }),
            usage,
            keyHint: a.kind === 'api-key' ? hint(secret) : '',
            configDir: a.kind === 'subscription-login' ? this.dirOf(a) : null,
            todayUsd: spend.usd,
            todaySessions: spend.sessions,
            limitHits7d: recentHits(a.limitHits, now).length,
            agents: agents.filter((x) => pinnedTo(a, x.account)).map((x) => x.id),
            running: this.running.get(a.id) ?? 0,
          };
        }),
    };
  }

  /** Tell the tabs (an agent's binding changed, a session started or ended). */
  emit() {
    this.deps.changed(this.view());
  }

  /** Every saved key and token, so they're scrubbed from anything the office writes or shows. */
  secretValues(): string[] {
    return this.list()
      .map((a) => this.secretOf(a))
      .filter((s) => !!s);
  }

  // ---------- sessions ----------

  /**
   * The account a new session of an agent pinned to `binding` runs on, with what it adds to the session's
   * environment; null: it runs as before accounts. Its running count goes up until release().
   */
  use(binding: string | undefined, cli: AccountCli): AccountUse | null {
    const a = resolveAccount(this.list(), binding, cli);
    if (!a) return null;
    this.running.set(a.id, (this.running.get(a.id) ?? 0) + 1);
    let done = false;
    return {
      id: a.id,
      builtIn: !!a.builtIn,
      ...accountSetup(a, this.dirOf(a), this.secretOf(a)),
      release: () => {
        if (done) return;
        done = true;
        this.running.set(a.id, Math.max(0, (this.running.get(a.id) ?? 1) - 1));
        this.settle();
      },
    };
  }

  /** A session on an account reported its usage. */
  readings(id: string, readings: UsageReading[]) {
    this.usage.set(id, mergeReadings(this.usage.get(id) ?? [], readings));
    this.emit();
  }

  /** A session on an account hit its usage limit. */
  limited(id: string, resetsAt: number | null, now = Date.now()) {
    const a = this.list().find((x) => x.id === id);
    if (!a) return;
    this.replace({ ...a, limitedUntil: resetsAt ?? now + 60 * 60_000, limitHits: [...recentHits(a.limitHits, now), now] });
  }

  /** Accounts removed while sessions ran on them go once those have finished. */
  private settle() {
    const gone = this.list().filter((a) => a.removing && !(this.running.get(a.id) ?? 0));
    for (const a of gone) void this.drop(a);
    if (!gone.length) this.emit();
  }

  // ---------- the manager's actions ----------

  /** POST /api/accounts: a new login (signed in next), API key (tested first) or setup token. */
  async add(x: NewAccount): Promise<{ id: string; note: string }> {
    const cli = String(x.cli ?? '') as AccountCli;
    const kind = String(x.kind ?? '') as AccountKind;
    if (!ACCOUNT_CLIS.includes(cli)) throw new HttpError(400, 'Pick Claude Code or Codex.');
    if (!ACCOUNT_KINDS.includes(kind) || (cli === 'codex' && kind === 'setup-token')) throw new HttpError(400, 'Pick a subscription login, an API key or (Claude) a setup token.');
    const list = this.list();
    const label = String(x.label ?? '').trim().slice(0, LABEL_MAX) || (kind === 'api-key' ? `${cli === 'claude' ? 'Anthropic' : 'OpenAI'} API key` : `${cli === 'claude' ? 'Claude' : 'Codex'} account ${list.filter((a) => a.cli === cli).length + 1}`);
    const a: ProviderAccount = {
      id: newAccountId(cli),
      cli,
      kind,
      label,
      tags: cleanTags(x.tags),
      priority: Math.max(-1, ...list.filter((o) => o.cli === cli).map((o) => o.priority)) + 1,
      enabled: true,
      ...(x.plan ? { plan: String(x.plan).trim().slice(0, 20) } : kind === 'api-key' ? { plan: 'API' } : {}),
    };
    if (kind === 'api-key') {
      const key = checkKey(cli, x.key);
      const check = await this.deps.check(a, '', key);
      if (!check.signedIn) throw new HttpError(400, check.note);
      this.secrets.set(a.id, key);
      await mergeSecrets(this.deps.secretsFile, { [secretKey(a.id)]: key });
      this.signedIn.set(a.id, true);
    } else if (kind === 'setup-token') {
      const name = String(x.tokenEnv ?? '').trim();
      if (!ENV_NAME.test(name)) throw new HttpError(400, 'Name the environment variable that holds the token, e.g. CUBEFARM_CLAUDE_TOKEN_2.');
      a.tokenEnv = name;
    } else await fs.mkdir(this.dirOf(a), { recursive: true });
    this.save([...list, a]);
    return { id: a.id, note: kind === 'subscription-login' ? 'Added: sign it in next.' : kind === 'setup-token' && !this.secretOf(a) ? `Added: set ${a.tokenEnv} in the office's environment and restart it.` : '✓ Added.' };
  }

  /** PATCH /api/accounts/:id: name, tags, plan, daily cost cap, pause or resume. */
  update(id: string, p: AccountPatch): AccountsView {
    try {
      this.replace(applyPatch(this.find(id), p));
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, (err as Error).message);
    }
    return this.view();
  }

  /** POST /api/accounts/:id/move: one place up or down. */
  move(id: string, by: number): AccountsView {
    this.find(id);
    this.save(moveAccount(this.list(), id, by < 0 ? -1 : 1));
    return this.view();
  }

  /** PUT /api/accounts/:id/key: a new key for an API key account, tested first. */
  async setKey(id: string, raw: unknown): Promise<string> {
    const a = this.find(id);
    if (a.kind !== 'api-key') throw new HttpError(400, 'Only API key accounts take a key.');
    const key = checkKey(a.cli, raw);
    const check = await this.deps.check(a, '', key);
    if (!check.signedIn) throw new HttpError(400, check.note);
    this.secrets.set(id, key);
    this.signedIn.set(id, true);
    await mergeSecrets(this.deps.secretsFile, { [secretKey(id)]: key });
    this.emit();
    return check.note;
  }

  /** POST /api/accounts/:id/test: is it signed in (and its usage), or does the provider take the key. */
  async test(id: string): Promise<string> {
    const a = this.find(id);
    const r = await this.deps.check(a, this.dirOf(a), this.secretOf(a));
    this.signedIn.set(id, r.signedIn);
    if (r.readings.length) this.usage.set(id, mergeReadings(this.usage.get(id) ?? [], r.readings));
    this.emit();
    return r.note;
  }

  private async pollAll() {
    for (const a of this.list()) if (!a.builtIn && a.kind !== 'api-key' && a.enabled) await this.test(a.id).catch(() => undefined);
  }

  /** The terminal a login signs in in (/ws/term?agent=account:<id>), made when it's first asked for. */
  terminal(id: string): AgentTerminal | null {
    if (!this.list().some((a) => a.id === id)) return null;
    let t = this.terms.get(id);
    if (!t) this.terms.set(id, (t = new AgentTerminal()));
    return t;
  }

  /** POST /api/accounts/:id/signin: the CLI's own login, in the account's terminal, with the account's folder. */
  signIn(id: string): void {
    const a = this.find(id);
    if (a.kind !== 'subscription-login') throw new HttpError(400, a.kind === 'api-key' ? 'An API key account has no sign-in: paste a new key.' : `A setup token comes from ${a.tokenEnv}: run claude setup-token and set it there.`);
    this.signIns.get(id)?.stop();
    const dir = this.dirOf(a);
    const env: Record<string, string> = a.builtIn ? {} : a.cli === 'claude' ? { CLAUDE_CONFIG_DIR: dir } : { CODEX_HOME: dir };
    const run = this.deps.signIn({ cli: a.cli, env, term: this.terminal(id)! }, () => {
      if (this.signIns.get(id) === run) this.signIns.delete(id);
      void this.test(id).catch(() => undefined);
    });
    this.signIns.set(id, run);
  }

  /** DELETE /api/accounts/:id: at once, or once the sessions on it finish (paused meanwhile). */
  async remove(id: string): Promise<'removed' | 'waiting'> {
    const a = this.find(id);
    const r = removal(a, this.running.get(id) ?? 0);
    if (r === 'refused') throw new HttpError(400, "The login on this computer stays: pause it instead, and the other accounts take its place.");
    if (r === 'wait') {
      this.replace({ ...a, removing: true, enabled: false });
      return 'waiting';
    }
    await this.drop(a);
    return 'removed';
  }

  private async drop(a: ProviderAccount) {
    this.signIns.get(a.id)?.stop();
    this.signIns.delete(a.id);
    this.terms.delete(a.id);
    this.secrets.delete(a.id);
    this.usage.delete(a.id);
    this.signedIn.delete(a.id);
    this.running.delete(a.id);
    this.save(this.list().filter((x) => x.id !== a.id));
    await mergeSecrets(this.deps.secretsFile, { [secretKey(a.id)]: undefined });
    // The login's folder (its credentials) goes with it.
    if (a.kind === 'subscription-login') await fs.rm(path.join(this.deps.home, 'accounts', a.id), { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
  }
}

/** An API key as pasted: trimmed, the right provider's, never a setup token. */
function checkKey(cli: AccountCli, raw: unknown): string {
  const key = String(raw ?? '').trim();
  if (!key || key.length > 400 || /\s/.test(key)) throw new HttpError(400, "That doesn't look like an API key.");
  if (cli === 'claude') {
    if (key.startsWith('sk-ant-oat')) throw new HttpError(400, "That's a claude setup-token token: add it as a setup token account (it's read from your environment, never saved).");
    if (!key.startsWith('sk-ant-')) throw new HttpError(400, 'Anthropic API keys start with sk-ant-.');
  } else if (!key.startsWith('sk-')) throw new HttpError(400, 'OpenAI API keys start with sk-.');
  return key;
}
