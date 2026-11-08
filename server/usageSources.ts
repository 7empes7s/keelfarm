// Usage for every account and provider (#361): the sources the accounts don't read themselves (ElevenLabs, Upstash
// Boxes, Admin keys' cost reports), each polled on its own interval with backoff and never awaited by anything an agent
// waits on; every source's history for its detail; and the 90% notifications, told once per window across restarts.
// Keys travel only in the providers' request headers: never into a source, a note, a log line or the alerts file.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { accountSource, anthropicCosts, boxSource, elevenLabsSource, openaiCosts, orgSource, pushHistory, shownAccounts, usageAlerts, worstFirst, worstPct, type UsageAlert } from '../shared/usageSources.ts';
import type { AccountView, UsageSource } from '../shared/types.ts';

/** The providers' own APIs (usageApi.ts; the demo's are fake). Each answers the provider's JSON, or throws a UsageFetchError. */
export interface UsageApi {
  elevenLabs(key: string): Promise<unknown>;
  costs(provider: 'anthropic' | 'openai', key: string, now: number): Promise<unknown>;
  /** The demo only: made-up keys, so its office shows every provider. */
  demoKeys?: Partial<UsageKeys>;
}

export interface UsageKeys {
  elevenlabs: string;
  anthropic: string; // an Anthropic Admin key (sk-ant-admin…)
  openai: string; // an OpenAI Admin key
}

/** A provider said no, or couldn't be reached (status 0): only the status, never the request. */
export class UsageFetchError extends Error {
  constructor(readonly status: number) {
    super(`usage fetch failed (${status})`);
  }
}

export interface UsageBoardDeps {
  api: UsageApi;
  keys: () => UsageKeys;
  /** Boxes on the Upstash account and the plan's limit; null without an Upstash key. */
  boxes: () => { total: number; running: number; limit: number } | null;
  /** The cost ledger's sessions, for API keys' spend this week. */
  spend: () => readonly { at: number; usd: number; account?: string }[];
  /** Where the told notifications are kept (<SWARM_HOME>/usage-alerts.json). */
  alertsFile: string;
  changed: () => void;
}

/** How often each fetched source is read: a subscription's meter every 5 minutes, billing reports hourly. */
export const POLL_EVERY: Record<'elevenlabs' | 'anthropic-org' | 'openai-org', number> = { elevenlabs: 5 * 60_000, 'anthropic-org': 60 * 60_000, 'openai-org': 60 * 60_000 };
/** Failed reads back off, doubling up to this. */
const MAX_WAIT_MS = 4 * 60 * 60_000;
const DAY = 24 * 60 * 60_000;

/** When a source's next read is due: its interval, doubled per failure in a row, at most MAX_WAIT_MS. */
export const nextRead = (last: number, every: number, failures: number) => last + Math.min(MAX_WAIT_MS, every * 2 ** failures);

/** The note on a source whose read failed: the status in plain words. */
const failNote = (status: number) => (status === 401 || status === 403 ? `The key was turned away (${status})` : status ? `Couldn't read it (${status}); trying again later` : "Couldn't reach it; trying again later");

type Fetched = keyof typeof POLL_EVERY;

export class UsageBoard {
  private fetched = new Map<Fetched, UsageSource>();
  private polls = new Map<Fetched, { last: number; failures: number }>();
  private reading = false;
  private history = new Map<string, [number, number][]>();
  private sent: string[] = [];
  private loaded: Promise<void> | null = null;

  constructor(private deps: UsageBoardDeps) {}

  /** Every source, worst first: the accounts' rows from their view, Boxes now, the fetched ones as last read. */
  sources(accounts: readonly AccountView[], now = Date.now()): UsageSource[] {
    const week = new Map<string, number>();
    for (const l of this.deps.spend()) if (l.account && now - l.at < 7 * DAY) week.set(l.account, (week.get(l.account) ?? 0) + l.usd);
    const rows = shownAccounts(accounts).map((a) => accountSource(a, Math.round((week.get(a.id) ?? 0) * 100) / 100, now));
    const b = this.deps.boxes();
    if (b) rows.push(boxSource(b, b.limit, now));
    rows.push(...this.fetched.values());
    return worstFirst(rows).map((s) => ({ ...s, history: this.history.get(s.id) ?? [] }));
  }

  /** Forget a fetched source's schedule, so it's read on the next tick (a key was saved or removed). */
  reset(id: Fetched) {
    this.polls.delete(id);
    this.fetched.delete(id);
  }

  /** Read whatever is due, one after another, in the background; tell the tabs when a source changed. */
  tick(now = Date.now()) {
    if (this.reading) return;
    const keys = { ...this.deps.keys(), ...this.deps.api.demoKeys };
    const due = (Object.keys(POLL_EVERY) as Fetched[]).filter((id) => {
      if (!keyFor(id, keys)) {
        if (this.fetched.delete(id)) this.deps.changed(); // its key was removed
        return false;
      }
      const p = this.polls.get(id);
      return !p || now >= nextRead(p.last, POLL_EVERY[id], p.failures);
    });
    if (!due.length) return;
    this.reading = true;
    void (async () => {
      for (const id of due) await this.read(id, keyFor(id, keys));
    })().finally(() => (this.reading = false));
  }

  private async read(id: Fetched, key: string) {
    const now = Date.now();
    const failures = this.polls.get(id)?.failures ?? 0;
    try {
      const body = id === 'elevenlabs' ? await this.deps.api.elevenLabs(key) : await this.deps.api.costs(id === 'anthropic-org' ? 'anthropic' : 'openai', key, now);
      this.fetched.set(id, id === 'elevenlabs' ? elevenLabsSource(body, now) : orgSource(id === 'anthropic-org' ? 'anthropic' : 'openai', (id === 'anthropic-org' ? anthropicCosts : openaiCosts)(body), now));
      this.polls.set(id, { last: now, failures: 0 });
    } catch (err) {
      const status = err instanceof UsageFetchError ? err.status : 0;
      this.polls.set(id, { last: now, failures: failures + 1 });
      const was = this.fetched.get(id);
      this.fetched.set(id, { ...(was ?? blank(id)), status: 'error', note: failNote(status) });
    }
    this.deps.changed();
  }

  /** Each source's history and the notifications due now (each window once, remembered in the alerts file). */
  async check(list: readonly UsageSource[], now = Date.now()): Promise<UsageAlert[]> {
    this.loaded ??= fs.readFile(this.deps.alertsFile, 'utf8').then(
      (t) => {
        const v = JSON.parse(t) as unknown;
        if (Array.isArray(v)) this.sent = v.filter((k): k is string => typeof k === 'string');
      },
      () => undefined,
    );
    await this.loaded;
    for (const s of list) this.history.set(s.id, pushHistory(this.history.get(s.id) ?? [], worstPct(s.windows), now));
    const ids = new Set(list.map((s) => s.id));
    for (const id of this.history.keys()) if (!ids.has(id)) this.history.delete(id);
    const { alerts, sent } = usageAlerts(list, this.sent, now);
    if (sent.join('\n') !== this.sent.join('\n')) {
      this.sent = sent;
      await fs.mkdir(path.dirname(this.deps.alertsFile), { recursive: true });
      const tmp = `${this.deps.alertsFile}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(sent));
      await fs.rename(tmp, this.deps.alertsFile);
    }
    return alerts;
  }
}

/** The rows as the tabs see them, without their read times: equal signatures need no new event. */
export const sourcesSignature = (list: readonly UsageSource[]) => JSON.stringify(list, (k, v: unknown) => (k === 'checkedAt' ? undefined : v));

const keyFor = (id: Fetched, k: Partial<UsageKeys>) => (id === 'elevenlabs' ? k.elevenlabs : id === 'anthropic-org' ? k.anthropic : k.openai) ?? '';

const LABELS: Record<Fetched, Pick<UsageSource, 'provider' | 'category' | 'label' | 'plan'>> = {
  elevenlabs: { provider: 'elevenlabs', category: 'audio', label: 'ElevenLabs', plan: '' },
  'anthropic-org': { provider: 'anthropic', category: 'text', label: 'Anthropic API · organisation', plan: 'API' },
  'openai-org': { provider: 'openai', category: 'text', label: 'OpenAI API · organisation', plan: 'API' },
};

/** A source that has never been read. */
const blank = (id: Fetched): UsageSource => ({ id, ...LABELS[id], windows: [], status: 'error', checkedAt: null });
