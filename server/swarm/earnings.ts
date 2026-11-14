// Earnings vs. spend (#666): each floor's earnings feed read every hour (through the Access service token when the app
// is one app_call may reach, else plain), manual entries and fixed costs from the Company page, and each day's spend
// rolled up from the cost ledger and the providers every 5 minutes. The view goes to the tabs as an `earnings` event
// when it changes; company_status reads the same state (ceoTools.ts). Rules pure in shared/earnings.ts and server/earnings.ts.
import { readFile } from 'node:fs/promises';
import { addEntry, addFixed, applyFeedRead, earningsBlock, earningsView, loadEarnings, readFeed, setFeed, type EarningsFeed } from '../../shared/earnings.ts';
import type { WorldSnapshot } from '../../shared/types.ts';
import { APP_CALL_HOSTS } from '../appCall.ts';
import { envAccessPair } from '../cfSecretFile.ts';
import { providerSpend, rollSpend } from '../earnings.ts';
import { earningsSample } from '../earningsSample.ts';
import { HttpError } from '../httpError.ts';
import { SwarmResearcher } from './researcher.ts';

const ROLL_MS = 5 * 60_000;
const FEED_MS = 60 * 60_000;

export abstract class SwarmEarnings extends SwarmResearcher {
  private sentEarnings = '';
  private earningsTimers: ReturnType<typeof setInterval>[] = [];

  protected loadEarningsState(raw: unknown) {
    return loadEarnings(raw);
  }

  private earningsNow() {
    return earningsView(this.state.earnings, Date.now());
  }

  /** company_status's `earnings` block: the week the CEO plans against (#666). */
  protected earningsStatus() {
    return earningsBlock(this.earningsNow(), (id) => this.state.repos.find((r) => r.id === id)?.floor ?? null);
  }

  override snapshot(): WorldSnapshot {
    return { ...super.snapshot(), earnings: this.earningsNow() };
  }

  /** The rollup brought up to date, saved, and the view sent when it changed. */
  private earningsChanged() {
    const e = this.state.earnings;
    e.spend = rollSpend(e.spend, this.spend.ledger.all(), providerSpend(this.usageSources()), Date.now());
    const view = this.earningsNow();
    const sig = JSON.stringify(view);
    this.save(); // the rollup keeps spend past the ledger's 30 days
    if (sig === this.sentEarnings) return view;
    this.sentEarnings = sig;
    this.broadcast({ type: 'earnings', earnings: view });
    return view;
  }

  /** One feed read: an app behind Access gets its service token in the headers (as app_call), anything else none. */
  private async readOneFeed(f: EarningsFeed) {
    const host = new URL(f.url).hostname;
    let res: { status: number; body?: unknown };
    try {
      if (APP_CALL_HOSTS[host]) {
        const token = envAccessPair(await readFile(await this.appTokenFile(host), 'utf8').catch(() => ''));
        res = token ? await this.backend.providerHttp(token, { method: 'GET', url: f.url, auth: 'cf-access' }) : { status: 0 };
      } else res = await this.backend.providerHttp('', { method: 'GET', url: f.url, auth: 'none' });
    } catch {
      res = { status: 0 }; // no token file: no data, never 0
    }
    const now = this.state.earnings.feeds.find((x) => x.repoId === f.repoId);
    if (!now || now.url !== f.url) return; // changed meanwhile
    this.state.earnings.feeds = this.state.earnings.feeds.map((x) => (x === now ? applyFeedRead(x, readFeed(res.status, res.body), Date.now()) : x));
  }

  private async readEarningFeeds() {
    await Promise.all(this.state.earnings.feeds.map((f) => this.readOneFeed(f)));
    this.earningsChanged();
  }

  /** The rollup every 5 minutes and the feeds every hour, a fresh demo office's sample first (not in tests). */
  protected override async startUsage() {
    if (!process.env.VITEST && !this.earningsTimers.length) {
      this.earningsTimers = [setInterval(() => this.earningsChanged(), ROLL_MS), setInterval(() => void this.readEarningFeeds(), FEED_MS)];
      for (const t of this.earningsTimers) t.unref?.();
      setTimeout(() => {
        const e = this.state.earnings; // a fresh demo's sample, once its floors are connected
        if (this.backend.demo && !e.seq) earningsSample(e, this.state.repos.map((r) => r.id), Date.now());
        void this.readEarningFeeds();
      }, 4000).unref?.();
    }
    await super.startUsage();
  }

  // ---------- the Company page's commands ----------

  private earningsEdit<T>(edit: () => T): T {
    try {
      const out = edit();
      this.earningsChanged();
      return out;
    } catch (e) {
      throw e instanceof HttpError ? e : new HttpError(400, (e as Error).message);
    }
  }

  /** POST /api/earnings/entries: a manual earning. */
  addEarning(body: Record<string, unknown>) {
    if (typeof body.repoId === 'string' && body.repoId && !this.state.repos.some((r) => r.id === body.repoId)) throw new HttpError(404, 'No such floor');
    return this.earningsEdit(() => addEntry(this.state.earnings, body, Date.now()));
  }

  /** DELETE /api/earnings/entries/:id */
  removeEarning(id: string) {
    if (!this.state.earnings.entries.some((x) => x.id === id)) throw new HttpError(404, 'That entry is gone already.');
    return this.earningsEdit(() => {
      this.state.earnings.entries = this.state.earnings.entries.filter((x) => x.id !== id);
      return { ok: true };
    });
  }

  /** POST /api/earnings/fixed: a monthly cost spread per day. */
  addFixedCost(body: Record<string, unknown>) {
    return this.earningsEdit(() => addFixed(this.state.earnings, body));
  }

  /** DELETE /api/earnings/fixed/:id */
  removeFixedCost(id: string) {
    if (!this.state.earnings.fixed.some((x) => x.id === id)) throw new HttpError(404, 'That cost is gone already.');
    return this.earningsEdit(() => {
      this.state.earnings.fixed = this.state.earnings.fixed.filter((x) => x.id !== id);
      return { ok: true };
    });
  }

  /** PUT /api/earnings/feeds/:repo: a floor's feed URL (empty removes it), read straight away. */
  setEarningsFeed(repoId: string, url: unknown) {
    if (!this.state.repos.some((r) => r.id === repoId)) throw new HttpError(404, 'No such floor');
    const f = this.earningsEdit(() => setFeed(this.state.earnings, repoId, String(url ?? '')));
    if (f) void this.readOneFeed(f).then(() => this.earningsChanged());
    return { ok: true };
  }
}
