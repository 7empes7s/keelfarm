// IT monitoring (#525): the office's health checks every 5 minutes in plain code (server/itChecks.ts), no model call.
// A check getting worse wakes the IT lead with the facts (once per level, at most once an hour per check); IT answers
// with it_recommend's card of ranked options, in its chat and on Telegram. The manager's pick runs through the IT desk's
// approved path (never-list again), the checks are read again, and the before/after is posted; Not now snoozes a day.
// A daily digest line. Rules pure in shared/itWatch.ts.
import os from 'node:os';
import path from 'node:path';
import { addDiskSample, beforeAfter, digestDay, digestLine, IT_OPTIONS_MAX, IT_WATCH_DEFAULTS, itWatchSettings, loadItWatch, recText, SNOOZE_MS, snoozedChecks, WAKE_EVERY_MS, wakeFacts, wakes, type ItCheck, type ItCheckId, type ItOption, type ItRecommendation, type ItWatchSettings, type ItWatchView } from '../../shared/itWatch.ts';
import type { ItRisk } from '../../shared/itDesk.ts';
import { uniqueDisks } from '../../shared/disk.ts';
import type { WorldSnapshot } from '../../shared/types.ts';
import { itOfficeTools } from '../ceoItTools.ts';
import type { OfficeTools } from '../ceo.ts';
import { HttpError } from '../httpError.ts';
import { neverRefusal } from '../itDesk.ts';
import { readItChecks } from '../itChecks.ts';
import { recKeyboard } from '../telegram.ts';
import { FILES_DIR, oneLine, QA_SHOTS_DIR } from './model.ts';
import { SwarmItDept } from './itDept.ts';

/** it_recommend's arguments (server/ceoItTools.ts). */
export interface ItRecommendArgs {
  check: ItCheckId;
  title: string;
  evidence: string;
  options: ItOption[];
}

const WATCH_EVERY_MS = 5 * 60_000;
/** du over agents' machines, QA screenshots and the files store: heavy, so once an hour. */
const MEASURE_EVERY_MS = 60 * 60_000;
const CHECK_IDS: readonly ItCheckId[] = ['disk', 'memory', 'load', 'units', 'failed', 'docker', 'leftovers', 'qaShots', 'logs', 'files', 'backups', 'certs'];
const RISKS: readonly ItRisk[] = ['low', 'medium', 'high'];
const REC_ID = /^(r-[a-z0-9]+-\d+)(?:_(\d))?$/; // a Telegram button's id: <rec> (Not now) or <rec>_<option> (telegram.ts recKeyboard)

export abstract class SwarmItWatch extends SwarmItDept {
  private watchChain: Promise<void> = Promise.resolve();
  private watching = false;
  private recSeq = 0;
  private measured: { at: number; leftoversMb: number; sizes: number[] } | null = null;

  protected get itWatch(): ItWatchSettings {
    return itWatchSettings(IT_WATCH_DEFAULTS, this.state.settings.itWatch);
  }

  /** Started with the usage readings, once from init: the checks every 5 minutes, the first soon after start. */
  protected override async startUsage() {
    setInterval(() => void this.itWatchTick(), WATCH_EVERY_MS).unref();
    setTimeout(() => void this.itWatchTick(), 20_000).unref();
    await super.startUsage();
  }

  /** The saved monitoring, from the state file. */
  protected loadItWatchState(raw: unknown) {
    return loadItWatch(raw);
  }

  itWatchView(): ItWatchView {
    const w = this.state.itWatch;
    return { on: this.itWatch.on, checks: w.checks, recs: w.recs, running: this.watching };
  }

  /** Left out until the first check: every tab's snapshot pays for it (scale.test.ts). */
  override snapshot(): WorldSnapshot {
    const w = this.state.itWatch;
    return w.checks.length || w.recs.length ? { ...super.snapshot(), itWatch: this.itWatchView() } : super.snapshot();
  }

  private itWatchChanged() {
    this.save();
    this.broadcast({ type: 'itWatch', itWatch: this.itWatchView() });
  }

  /** IT's office tools: it_run, it_propose, it_recommend and it_health. */
  protected itTools(): OfficeTools {
    return itOfficeTools({ itRun: (a) => this.itRun(a), itPropose: (a) => this.itPropose(a), itRecommend: (a) => this.itRecommend(a), itHealth: () => this.itHealth() });
  }

  /** it_health with the checks' latest levels. */
  protected override itHealth(): string {
    const lines = this.state.itWatch.checks.map((c) => `${c.label}: ${c.level} · ${c.line}${c.trend ? ` · ${c.trend}` : ''}`);
    return `${super.itHealth()}\nChecks: ${lines.join(' | ') || 'not read yet'}`;
  }

  // ---------- the checks ----------

  /** One round of checks (one at a time; POST /api/it/watch/check runs one now). */
  itWatchTick(): Promise<ItWatchView> {
    const next = this.watchChain.then(() => this.watchOnce());
    this.watchChain = next.catch((err) => console.warn('IT checks failed:', oneLine(err)));
    return next.then(() => this.itWatchView());
  }

  private async measureSlow(now: number) {
    if (this.measured && now - this.measured.at < MEASURE_EVERY_MS) return this.measured;
    const [leftoversMb, sizes] = await Promise.all([
      this.diskPlan(false).then((p) => p.go.reduce((n, i) => n + i.mb, 0), () => NaN),
      this.backend.disk.measure([QA_SHOTS_DIR, FILES_DIR]).catch(() => [NaN, NaN]),
    ]);
    return (this.measured = { at: now, leftoversMb, sizes });
  }

  private async watchOnce() {
    const s = this.itWatch;
    if (!s.on) return;
    this.watching = true;
    this.itWatchChanged();
    try {
      const w = this.state.itWatch;
      const now = Date.now();
      const slow = await this.measureSlow(now);
      const root = path.parse(os.homedir()).root || '/';
      const disks = uniqueDisks(await this.backend.disk.read([{ label: 'System disk', path: root }, ...this.diskDirs()]).catch(() => []));
      const checks = await readItChecks({
        exec: (argv, ms) => this.backend.itExec(argv, ms),
        disks: async () => disks,
        memory: () => this.health.view().memory,
        leftoversMb: async () => slow.leftoversMb,
        measure: async () => slow.sizes,
        certExpiry: (host) => this.backend.certExpiry(host),
        settings: s,
        samples: w.samples,
        dirs: { qaShots: QA_SHOTS_DIR, files: FILES_DIR },
        now,
      });
      w.checks = checks;
      if (disks.length) w.samples = addDiskSample(w.samples, { at: now, freeMb: Math.min(...disks.map((d) => d.freeMb)) });
      // A check back to good closes its recommendation.
      w.recs = w.recs.filter((r) => checks.find((c) => c.id === r.check)?.level !== 'good');
      if (this.state.settings.itDept.on) {
        const r = wakes(checks, w.marks, snoozedChecks(w.recs, now), now, this.backend.demo ? 0 : WAKE_EVERY_MS); // the demo's low disk is pretend: it may cross again at once
        w.marks = r.marks;
        if (r.woken.length) {
          this.postIt('office', `🩺 ${r.woken.map((c) => `${c.label} is ${c.level}: ${c.line}`).join(' · ')}. ${this.itName} is looking.`);
          this.enqueueIt({ kind: 'watch', facts: wakeFacts(r.woken), at: now });
        }
        const day = digestDay(now);
        if (day && day !== w.digestDay) {
          w.digestDay = day;
          const line = digestLine(checks);
          this.postIt('office', line);
          void this.itTelegram(line);
        }
      }
    } finally {
      this.watching = false;
      this.itWatchChanged();
    }
  }

  // ---------- recommendations ----------

  /** it_recommend: a card for the manager with 1-4 ranked options; each must pass the never-list now (and again at the pick). */
  protected itRecommend(a: ItRecommendArgs): string {
    if (!this.itOn) throw new HttpError(403, 'The IT desk is off (Settings → CEO settings → IT desk): tell the manager what you would run instead.');
    if (!CHECK_IDS.includes(a.check)) throw new HttpError(400, `check is one of ${CHECK_IDS.join(', ')}.`);
    const raw = Array.isArray(a.options) ? a.options.slice(0, IT_OPTIONS_MAX) : [];
    if (!raw.length) throw new HttpError(400, 'Give 1-4 options, best first.');
    const options = raw.map((o, i): ItOption => {
      const argv = (Array.isArray(o.argv) ? o.argv : []).map(String);
      const never = neverRefusal(argv, { protectedDirs: this.itProtected });
      if (never) throw new HttpError(403, `Option ${i + 1}: ${never}`);
      const t = (x: unknown, n: number) => String(x ?? '').trim().slice(0, n);
      return { argv, does: t(o.does, 120), frees: t(o.frees, 120), risk: RISKS.includes(o.risk) ? o.risk : 'medium', undo: t(o.undo, 160) };
    });
    const at = Date.now();
    const rec: ItRecommendation = { id: `r-${at.toString(36)}-${++this.recSeq}`, check: a.check, title: String(a.title ?? '').trim().slice(0, 160), evidence: String(a.evidence ?? '').trim().slice(0, 600), options, at, by: this.itName, snoozedUntil: null };
    const w = this.state.itWatch;
    w.recs = [...w.recs.filter((r) => r.check !== a.check), rec];
    this.itWatchChanged();
    void this.itTelegram(recText(rec), recKeyboard(rec.id, rec.options));
    this.notifier.notify('decisions', `${this.itName}: ${rec.title}`, `${options.length} option${options.length === 1 ? '' : 's'} to pick from`);
    return `On the manager's card with ${options.length} option${options.length === 1 ? '' : 's'}. Nothing runs until they pick one; the office then measures again and posts the before/after.`;
  }

  /** POST /api/it/recs/:id/pick: the manager's pick runs through the IT desk (never-list again), then the checks again. */
  async itPick(id: string, option: number) {
    const w = this.state.itWatch;
    const rec = w.recs.find((r) => r.id === id);
    const o = rec?.options[option];
    if (!rec || !o) throw new HttpError(404, 'That recommendation has been handled or replaced already.');
    if (!this.itOn) throw new HttpError(403, 'The IT desk is off: turn it on in Settings → CEO settings.');
    const before = w.checks.find((c) => c.id === rec.check);
    const at = Date.now();
    // Off the card at once, so a second tap can't run it twice.
    w.recs = w.recs.filter((r) => r !== rec);
    this.itWatchChanged();
    const p = { id: `it-${at.toString(36)}-${rec.id}`, argv: o.argv, why: `${rec.title}: ${o.does}`, affects: o.frees, undo: o.undo, risk: o.risk, at, by: rec.by, rec: rec.id };
    this.state.itDesk.waiting.push(p);
    const { results } = await this.itRunProposals([p.id]);
    const code = results[0]?.code ?? null;
    this.measured = null; // a pick usually frees space: measure the folders again
    await this.itWatchTick();
    const after: ItCheck | undefined = this.state.itWatch.checks.find((c) => c.id === rec.check);
    const line = `🩺 ${o.does} ${code === 0 ? 'ran' : code === null ? "didn't run" : `exited ${code}`}. ${beforeAfter(before, after)}`.trim();
    this.postIt('office', line);
    void this.itTelegram(line);
    // Still not good: the rest of the options stay on the card.
    const rest = rec.options.filter((x) => x !== o);
    if (after && after.level !== 'good' && rest.length && !this.state.itWatch.recs.some((r) => r.check === rec.check)) {
      this.state.itWatch.recs.push({ ...rec, options: rest });
      this.itWatchChanged();
    }
    return { code, before: before ?? null, after: after ?? null };
  }

  /** POST /api/it/recs/:id/snooze: Not now, for a day: hidden, and the check wakes nobody until then. */
  itSnooze(id: string) {
    const rec = this.state.itWatch.recs.find((r) => r.id === id);
    if (!rec) throw new HttpError(404, 'That recommendation has been handled or replaced already.');
    rec.snoozedUntil = Date.now() + SNOOZE_MS;
    this.itWatchChanged();
    return { snoozedUntil: rec.snoozedUntil };
  }

  /** A recommendation's Telegram button: an option runs it, Not now snoozes it; the IT desk's cards as before. */
  protected override async itDecide(verdict: 'approve' | 'decline', id: string): Promise<string> {
    const m = id.match(REC_ID);
    if (!m) return super.itDecide(verdict, id);
    if (verdict === 'decline') {
      this.itSnooze(m[1]);
      return '✋ Not now: snoozed for a day.';
    }
    const r = await this.itPick(m[1], Number(m[2] ?? 0));
    return r.code === 0 ? `✅ Done. ${beforeAfter(r.before ?? undefined, r.after ?? undefined)}`.slice(0, 180) : r.code === null ? "⚠️ It didn't run: the IT chat says why." : `⚠️ Exit ${r.code}: the output is in the IT chat.`;
  }
}
