// IT's continuous improvement (#543): each closed ticket becomes a record (cause, minutes blocked, wasted session $ and
// QA rounds from the cost ledger, the fix, whether it came back). Every Monday from 9:00 (and on demand: it_review, or
// Review now) the records are grouped and ranked in plain code and IT gets the brief in one session; its it_improve
// proposals are cards with Approve / Not now in its chat and on Telegram. Approve files the issue on its floor, or adds
// the line through the CEO's own set_office_playbook / set_floor_profile. Nothing changes without a tap. Rules pure in
// shared/itImprove.ts.
import { addCards, addRecord, approveCard, cardPlace, cardText, fitAsk, fitLine, groupCauses, IMPROVE_CARD_ID, improveView, loadImprove, makeCard, makeRecord, openRecord, refreshCosts, reviewBrief, reviewWeek, type ImproveInput, type ItImproveCard, type ItImproveView } from '../../shared/itImprove.ts';
import type { ItTicket } from '../../shared/itTickets.ts';
import type { CostSession } from '../../shared/costs.ts';
import { OFFICE_PLAYBOOK_MAX, PLAYBOOK_MAX, type WorldSnapshot } from '../../shared/types.ts';
import { HttpError } from '../httpError.ts';
import { decisionData, type TgButton } from '../telegram.ts';
import { improveSample } from '../itImproveSample.ts';
import { wantsTicketSample } from '../itTicketSample.ts';
import { SwarmItWatch } from './itWatch.ts';

/** it_improve's arguments (server/ceoItTools.ts). */
export interface ItImproveArgs {
  proposals: ImproveInput[];
}

const DAY = 24 * 3_600_000;
const REVIEW_EVERY_MS = 60 * 60_000;
const QA_BRIEF_MAX = 2500;
const improveKeyboard = (id: string): TgButton[][] => [[{ text: 'Approve', callback_data: decisionData('approve', id) }, { text: 'Not now', callback_data: decisionData('decline', id) }]];

export abstract class SwarmItImprove extends SwarmItWatch {
  private cardSeq = 0;

  /** The saved records and cards, from the state file. */
  protected loadImproveState(raw: unknown) {
    return loadImprove(raw);
  }

  /** Started with the usage readings, once from init: the weekly review's check every hour; a fresh demo's sample. */
  protected override async startUsage() {
    setInterval(() => this.reviewTick(), REVIEW_EVERY_MS).unref();
    const s = this.state.itImprove;
    if (this.backend.demo && !s.records.length && !s.changes.length) {
      setTimeout(() => {
        if (!wantsTicketSample(this.backend.demo, this.state.repos.length, s.records.length)) return; // floors connect after this
        const r = [...this.state.repos].sort((a, b) => a.floor - b.floor)[0];
        improveSample(s, r && { floor: r.floor, fullName: r.fullName }, this.state.agents, Date.now());
        this.improveChanged();
      }, 3000).unref();
    }
    await super.startUsage();
  }

  private sessions(): CostSession[] {
    return this.spend.ledger.all().filter((r): r is CostSession => r.type === 'session');
  }

  /** Open tickets counted as if they closed now. */
  private openRecords(now: number, sessions: CostSession[] = []) {
    const s = this.state.itImprove;
    return this.state.itTickets.list.filter((t) => t.status === 'open').map((t) => openRecord(t, s.records, this.state.agents, sessions, now));
  }

  improveView(): ItImproveView {
    return improveView(this.state.itImprove, this.openRecords(Date.now()), Date.now());
  }

  /** Left out until there's a record or a card: every tab's snapshot pays for it (scale.test.ts). */
  override snapshot(): WorldSnapshot {
    const s = this.state.itImprove;
    return s.records.length || s.cards.length || s.changes.length ? { ...super.snapshot(), itImprove: this.improveView() } : super.snapshot();
  }

  private improveChanged() {
    this.save();
    this.broadcast({ type: 'itImprove', itImprove: this.improveView() });
  }

  /** Closed tickets become records (itTickets.ts calls this on every close). */
  protected recordTickets(closed: ItTicket[]) {
    if (!closed.length) return;
    const sessions = this.sessions();
    const now = Date.now();
    for (const t of closed) addRecord(this.state.itImprove, makeRecord(t, this.state.itImprove.records, this.state.agents, sessions), now);
    this.improveChanged();
  }

  // ---------- the review ----------

  /** The causes of the last `days` days, ranked, with the records' costs read again from the ledger. */
  private reviewRows(days: number, now = Date.now()) {
    const s = this.state.itImprove;
    const sessions = this.sessions();
    s.records = refreshCosts(s.records, sessions, now);
    return groupCauses([...this.openRecords(now, sessions), ...s.records], now - days * DAY, now + 1, s.changes);
  }

  private reviewText(days: number) {
    return reviewBrief(this.reviewRows(days), { days, floors: this.state.repos.map((r) => ({ floor: r.floor, fullName: r.fullName })) });
  }

  /** it_review: the brief, for IT's on-demand answer to "what keeps going wrong?". */
  protected itReview(a: { days?: number }): string {
    const days = Math.min(56, Math.max(1, Math.round(Number(a.days) || 7)));
    return this.reviewText(days);
  }

  /** Once a week (Monday from 9:00) when the week had tickets: one IT session with the brief. */
  private reviewTick(now = Date.now()) {
    const week = reviewWeek(now);
    const s = this.state.itImprove;
    if (!week || week === s.reviewWeek || !this.state.settings.itDept.on) return;
    s.reviewWeek = week;
    this.save();
    if (this.reviewRows(7, now).length) this.startReview(now);
  }

  private startReview(now: number) {
    this.state.itImprove.reviewedAt = now;
    this.enqueueIt({ kind: 'review', text: this.reviewText(7), at: now });
    this.improveChanged();
  }

  /** POST /api/it/improve/review: Review now. */
  improveReviewNow() {
    if (!this.state.settings.itDept.on) throw new HttpError(409, 'The IT department is off: turn it on in Settings → The IT department.');
    this.startReview(Date.now());
    return { queued: true };
  }

  // ---------- the cards ----------

  /** it_improve: IT's proposals from a review, each a card with Approve / Not now. */
  protected itImprove(a: ItImproveArgs): string {
    const raw = Array.isArray(a.proposals) ? a.proposals.slice(0, 5) : [];
    if (!raw.length) throw new Error('Give 1-5 proposals, the costliest cause first.');
    const now = Date.now();
    const rows = this.reviewRows(26 * 7, now);
    const floors = this.state.repos.map((r) => r.floor);
    const cards = raw.map((p, i) => {
      try {
        return makeCard(p, { id: `i-${now.toString(36)}-${++this.cardSeq}`, at: now, by: this.itName, rows, floors });
      } catch (err) {
        throw new Error(`Proposal ${i + 1}: ${(err as Error).message}`);
      }
    });
    addCards(this.state.itImprove, cards);
    this.improveChanged();
    for (const c of cards) void this.itTelegram(cardText(c), improveKeyboard(c.id));
    this.notice({ kind: 'it', title: `${this.itName}: ${cards.length} improvement${cards.length === 1 ? '' : 's'} to approve`, text: cards.map((c) => c.title).join('\n'), actions: ['openIt'] }, { event: 'decisions' });
    return `${cards.length} card${cards.length === 1 ? '' : 's'} for the manager with Approve / Not now. Nothing changes until they approve: an issue is filed on its floor, a line goes into the playbook or QA brief.`;
  }

  private card(id: string) {
    const c = this.state.itImprove.cards.find((x) => x.id === id);
    if (!c) throw new HttpError(404, 'That proposal has been handled or replaced already.');
    return c;
  }

  /** POST /api/it/improve/:id/approve: the change, made: an issue on its floor, or the line through the CEO's tools. */
  async improveApprove(id: string) {
    const c = this.card(id);
    const s = this.state.itImprove;
    const ref: { issue?: number; url?: string } = {};
    let done: string;
    if (c.kind === 'issue') {
      const repo = this.floorRepo(c.floor!);
      s.cards = s.cards.filter((x) => x !== c); // off the list while it's filed, so a second tap can't file it twice
      const n = await this.createIssue(repo.id, c.title, `${c.body}\n\n---\n_Proposed by ${c.by} (IT) from the review of "${c.cause}"; approved by the manager._`).catch((err: unknown) => {
        s.cards = [c, ...s.cards];
        throw err;
      });
      Object.assign(ref, { issue: n, url: `https://github.com/${repo.fullName}/issues/${n}` });
      done = `filed #${n} on floor ${repo.floor}: ${c.title}`;
    } else {
      const line = this.lineTarget(c);
      const fit = fitLine(c, line.text, line.max);
      if ('full' in fit) {
        // not an error: the card says so and offers Ask the CEO to fit it (#580)
        c.full = fit.full;
        this.improveChanged();
        return { full: fit.full };
      }
      if (fit.next !== null) line.set(fit.next);
      done = fit.next === null ? `${cardPlace(c)} has that line already` : `added a line to ${cardPlace(c)}`;
    }
    const change = approveCard(s, c, Date.now(), ref);
    const line = `🔁 Approved for "${c.cause}": ${done}.`;
    this.postIt('office', line);
    void this.itTelegram(line);
    this.improveChanged();
    return { change };
  }

  /** The text a line card adds to, its limit and how it's saved (the CEO's own set_office_playbook / set_floor_profile). */
  private lineTarget(c: ItImproveCard) {
    if (c.kind === 'office_playbook') return { text: this.state.settings.officePlaybook ?? '', max: OFFICE_PLAYBOOK_MAX, set: (t: string) => this.setOfficePlaybook(t) };
    const repo = this.floorRepo(c.floor!);
    const brief = c.kind === 'qa_brief';
    return { text: (brief ? repo.qaBrief : repo.playbook) ?? '', max: brief ? QA_BRIEF_MAX : PLAYBOOK_MAX, set: (t: string) => this.setFloorProfile({ floor: repo.floor, ...(brief ? { qa_brief: t } : { playbook: t }) }) };
  }

  /** POST /api/it/improve/:id/fit: Ask the CEO to fit it: the manager's message to the CEO, and the card is the CEO's now. */
  async improveFit(id: string) {
    const c = this.card(id);
    if (c.kind === 'issue') throw new HttpError(400, 'That proposal files an issue: Approve it instead.');
    const line = this.lineTarget(c);
    const { id: message } = await this.messageCeo(fitAsk(c, line.text.length, line.max));
    this.state.itImprove.cards = this.state.itImprove.cards.filter((x) => x !== c);
    this.improveChanged();
    return { message };
  }

  /** POST /api/it/improve/:id/dismiss: Not now; the next review may propose it again. */
  improveDismiss(id: string) {
    const c = this.card(id);
    this.state.itImprove.cards = this.state.itImprove.cards.filter((x) => x !== c);
    this.improveChanged();
    return { ok: true };
  }

  /** An improvement card's Telegram button; the rest as before. */
  protected override async itDecide(verdict: 'approve' | 'decline', id: string): Promise<string> {
    if (!IMPROVE_CARD_ID.test(id)) return super.itDecide(verdict, id);
    if (verdict === 'decline') {
      this.improveDismiss(id);
      return '✋ Not now.';
    }
    const r = await this.improveApprove(id);
    if ('full' in r) return `✋ ${r.full}`;
    const { change } = r;
    return change.issue ? `✅ Filed #${change.issue}.` : '✅ Added.';
  }
}
