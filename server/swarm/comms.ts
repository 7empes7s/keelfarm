// The Comms floor's mail (#668): the shared mailboxes read every 5 minutes through the office's mail app (entra
// mail_app_ensure), the mail tools (the CEO's, and the agents' on the floors the Comms page names), drafts sent only on
// the manager's Approve unless a mailbox's auto-replies cover them, the lead list, and the outreach rules (unsubscribe
// line, suppression list, warm-up cap). The view goes to the tabs as a `comms` event. Rules pure in shared/comms.ts,
// Graph calls in server/mail.ts; the demo's inbox is server/commsSample.ts and sends stay in memory.
import { redact } from '../../shared/journal.ts';
import { commsView, countOutreach, isEmail, loadComms, suppress, makeDraft, MAIL_LABELS, mergeInbox, recordSent, sendCheck, trimDrafts, upsertLead, type LeadInput, type MailDraft, type MailLabel } from '../../shared/comms.ts';
import type { WorldSnapshot } from '../../shared/types.ts';
import type { PersistedAgent, PersistedRepo } from './model.ts';
import { mailOfficeTools, type LeadUpdateArgs, type MailDraftArgs, type MailHandlers, type MailListArgs } from '../ceoMailTools.ts';
import { commsSample } from '../commsSample.ts';
import { HttpError } from '../httpError.ts';
import { readInbox, sendAs } from '../mail.ts';
import { SwarmEarnings } from './earnings.ts';

const SYNC_MS = 5 * 60_000;
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 60 ? `${m}m` : m < 2880 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};

export abstract class SwarmComms extends SwarmEarnings {
  private sentComms = '';
  private commsTimer: ReturnType<typeof setInterval> | null = null;
  /** The demo's sends, in memory only. */
  protected demoSent: { mailbox: string; to: string[]; subject: string }[] = [];

  protected loadCommsState(raw: unknown) {
    return loadComms(raw);
  }

  private mailConnected() {
    return !!this.mailStore.get() || !!this.backend.demo;
  }

  override snapshot(): WorldSnapshot {
    return { ...super.snapshot(), comms: commsView(this.state.comms, this.mailConnected(), Date.now()) };
  }

  /** Saved, and the view sent when it changed. */
  private commsChanged() {
    this.state.comms.drafts = trimDrafts(this.state.comms.drafts);
    this.save();
    const view = commsView(this.state.comms, this.mailConnected(), Date.now());
    const sig = JSON.stringify(view);
    if (sig === this.sentComms) return;
    this.sentComms = sig;
    this.broadcast({ type: 'comms', comms: view });
  }

  /** Every 5 minutes, each listed mailbox the mail app reaches; a fresh demo office's sample first (not in tests). */
  protected override async startUsage() {
    if (!process.env.VITEST && !this.commsTimer) {
      this.commsTimer = setInterval(() => void this.syncMail(), SYNC_MS);
      this.commsTimer.unref?.();
      setTimeout(() => {
        if (this.backend.demo && !this.state.comms.seq) {
          commsSample(this.state.comms, Date.now());
          this.commsChanged();
        }
        void this.syncMail();
      }, 4000).unref?.();
    }
    await super.startUsage();
  }

  /** The inboxes read and folded in; one that fails is skipped till next time. Returns the new messages' count. */
  protected async syncMail(): Promise<number> {
    const cred = this.mailStore.get();
    if (!cred) return 0;
    let fresh = 0;
    for (const m of this.state.comms.settings.mailboxes.filter((x) => cred.mailboxes.includes(x.address))) {
      const msgs = await readInbox(this.backend.providerHttp, cred, m.address).catch(() => null);
      if (msgs) fresh += mergeInbox(this.state.comms, m.address, msgs, Date.now()).length;
    }
    this.commsChanged();
    return fresh;
  }

  /** One email out as its mailbox: through the mail app, or (the demo without one) kept in memory. */
  private async deliver(d: MailDraft) {
    const cred = this.mailStore.get();
    if (cred) return sendAs(this.backend.providerHttp, cred, d.mailbox, d);
    if (!this.backend.demo) throw new Error("Mail isn't set up: provider_action entra mail_app_ensure first.");
    this.demoSent.push({ mailbox: d.mailbox, to: d.to, subject: d.subject });
  }

  /** A checked draft sent now (or, for a post, approved); its outcome on the draft. Whether it went. */
  private async sendNow(d: MailDraft, auto: boolean): Promise<boolean> {
    const now = Date.now();
    if (d.channel !== 'email') {
      d.status = 'approved';
      return true;
    }
    try {
      await this.deliver(d);
      d.status = 'sent';
      d.sentAt = now;
      delete d.why;
      if (auto) d.auto = true;
      countOutreach(this.state.comms, d, now);
      recordSent(this.state.comms, d, now);
      return true;
    } catch (err) {
      d.status = 'failed';
      d.why = redact((err as Error).message, this.secrets());
      return false;
    }
  }

  private draft(id: string) {
    const d = this.state.comms.drafts.find((x) => x.id === id);
    if (!d) throw new HttpError(404, `No draft ${id}: mail_list shows the waiting ones.`);
    return d;
  }

  // ---------- the mail tools ----------

  protected mailList(a: MailListArgs): string {
    const c = this.state.comms;
    const threads = c.threads.filter((t) => (!a.mailbox || t.mailbox === a.mailbox.toLowerCase()) && (!a.unread || t.unread) && (!a.label || t.label === a.label)).slice(0, 30);
    const waiting = c.drafts.filter((d) => d.status === 'waiting');
    const v = commsView(c, this.mailConnected(), Date.now());
    return [
      this.mailConnected() ? `Mailboxes: ${c.settings.mailboxes.map((m) => `${m.address}${m.autoReplies ? ' (auto-replies on)' : ''}`).join(', ')}. Outreach today ${v.outreach.today}/${v.outreach.cap}.` : "Mail isn't set up yet: provider_action entra mail_app_ensure (one card for the manager).",
      ...threads.map((t) => `${t.id} · ${t.mailbox} · ${t.withName ? `${t.withName} <${t.with}>` : t.with} · "${t.subject}"${t.label ? ` [${t.label}]` : ''}${t.unread ? ' · unread' : ''} · ${ago(t.last)} ago`),
      ...(threads.length ? [] : ['No threads.']),
      ...(waiting.length ? [`Waiting for the manager: ${waiting.map((d) => `${d.id} (${d.channel === 'email' ? `to ${d.to.join(', ')}` : d.channel})`).join(', ')}`] : []),
    ].join('\n');
  }

  protected mailRead(a: { thread: string }): string {
    const t = this.state.comms.threads.find((x) => x.id === a.thread);
    if (!t) throw new Error(`No thread ${a.thread}: mail_list shows them.`);
    if (t.unread) {
      t.unread = false;
      this.commsChanged();
    }
    return [`"${t.subject}" in ${t.mailbox} with ${t.with}${t.label ? ` [${t.label}]` : ''}`, ...t.messages.map((m) => `--- ${m.out ? 'us' : m.fromName || m.from}, ${new Date(m.at).toISOString().slice(0, 16).replace('T', ' ')}\n${m.text.slice(0, 4000)}`)].join('\n');
  }

  protected mailDraft(a: MailDraftArgs, by: string): string {
    const d = makeDraft(this.state.comms, { ...a, threadId: a.reply_to }, by, Date.now());
    this.state.comms.drafts.push(d);
    this.commsChanged();
    return `Draft ${d.id}${d.channel === 'email' ? ` from ${d.mailbox} to ${d.to.join(', ')}, "${d.subject}"` : ` (${d.channel})`}. Send it with mail_send.\n\n${d.text}`;
  }

  /** mail_send: refused when a rule says no; sent at once under an auto-reply rule; else on the manager's card. */
  protected async mailSend(a: { draft: string }): Promise<string> {
    const d = this.draft(a.draft);
    if (d.status === 'sent' || d.status === 'approved') return `${d.id} is ${d.status} already.`;
    if (d.status === 'discarded') throw new Error(`The manager discarded ${d.id}.`);
    const check = sendCheck(this.state.comms, d, Date.now());
    if (!check.ok) {
      d.why = check.why;
      this.commsChanged();
      throw new Error(check.why);
    }
    if (check.auto) {
      const sent = await this.sendNow(d, true);
      this.commsChanged();
      return sent ? `Sent ${d.id} to ${d.to.join(', ')} (${d.mailbox}'s auto-replies are on).` : `Couldn't send ${d.id}: ${d.why}`;
    }
    d.status = 'waiting';
    delete d.why;
    this.commsChanged();
    const what = d.channel === 'email' ? `${d.mailbox} → ${d.to.join(', ')}: ${d.subject}` : `${d.channel} post`;
    this.notice({ kind: 'approval', title: d.channel === 'email' ? 'An email is waiting for you' : 'A post is waiting for you', text: `${what}. Open Comms to Approve, Edit or Discard.` }, { event: 'question', line: what });
    return `${d.id} is on the manager's phone for Approve (${what}). mail_list shows when it's sent.`;
  }

  protected leadUpdate(a: LeadUpdateArgs): string {
    const l = upsertLead(this.state.comms, a);
    this.commsChanged();
    return `Lead ${l.name} <${l.email}>${l.company ? `, ${l.company}` : ''}: ${l.stage}${l.nextStep ? `, next: ${l.nextStep}` : ''}.`;
  }

  /** An agent's mail tools, on the floors the Comms page names (#668). */
  protected commsToolsFor(a: PersistedAgent, repo: PersistedRepo) {
    if (!this.state.comms.settings.floors.includes(repo.id)) return undefined;
    const h: MailHandlers = { mailList: (x) => this.mailList(x), mailRead: (x) => this.mailRead(x), mailDraft: (x) => this.mailDraft(x, a.name), mailSend: (x) => this.mailSend(x), leadUpdate: (x) => this.leadUpdate(x) };
    return mailOfficeTools(h);
  }

  // ---------- the manager's commands (the Comms page) ----------

  private edit<T>(fn: () => T): T {
    try {
      const out = fn();
      this.commsChanged();
      return out;
    } catch (e) {
      throw e instanceof HttpError ? e : new HttpError(400, (e as Error).message);
    }
  }

  private applyEdits(d: MailDraft, b: Record<string, unknown>) {
    if (typeof b.text === 'string' && b.text.trim()) d.text = b.text.slice(0, 20_000);
    if (typeof b.subject === 'string' && d.channel === 'email' && b.subject.trim()) d.subject = b.subject.slice(0, 200);
  }

  /** POST /api/comms/drafts/:id/approve: its edits kept, the rules checked again, sent. */
  async approveDraft(id: string, body: Record<string, unknown>) {
    const d = this.draft(id);
    if (d.status !== 'waiting' && d.status !== 'draft' && d.status !== 'failed') throw new HttpError(409, `That draft is ${d.status} already.`);
    this.applyEdits(d, body);
    const check = sendCheck(this.state.comms, d, Date.now());
    if (!check.ok) {
      d.why = check.why;
      this.commsChanged();
      throw new HttpError(400, check.why);
    }
    const sent = await this.sendNow(d, false);
    this.commsChanged();
    if (!sent) throw new HttpError(502, `Couldn't send it: ${d.why}`);
    return d;
  }

  /** POST /api/comms/drafts/:id: its text or subject changed, still waiting. */
  editDraft(id: string, body: Record<string, unknown>) {
    return this.edit(() => {
      const d = this.draft(id);
      if (d.status === 'sent' || d.status === 'approved') throw new HttpError(409, `That draft is ${d.status} already.`);
      this.applyEdits(d, body);
      return d;
    });
  }

  /** DELETE /api/comms/drafts/:id */
  discardDraft(id: string) {
    return this.edit(() => {
      const d = this.draft(id);
      if (d.status === 'sent') throw new HttpError(409, 'That email is sent already.');
      d.status = 'discarded';
      return { ok: true };
    });
  }

  /** PUT /api/comms/threads/:id/label */
  labelThread(id: string, label: unknown) {
    return this.edit(() => {
      const t = this.state.comms.threads.find((x) => x.id === id);
      if (!t) throw new HttpError(404, 'That thread is gone.');
      if (label === null || label === '') delete t.label;
      else if ((MAIL_LABELS as readonly unknown[]).includes(label)) t.label = label as MailLabel;
      else throw new HttpError(400, `label is one of ${MAIL_LABELS.join(', ')}.`);
      return { ok: true };
    });
  }

  /** POST /api/comms/leads: a lead added or changed by email. */
  saveLead(body: Record<string, unknown>) {
    return this.edit(() => upsertLead(this.state.comms, body as LeadInput));
  }

  /** PUT /api/comms/settings: auto-replies and signatures per mailbox, the floors with mail tools, the outreach cap. */
  setCommsSettings(body: Record<string, unknown>) {
    return this.edit(() => {
      const s = this.state.comms.settings;
      if (Array.isArray(body.mailboxes)) {
        for (const m of body.mailboxes as Record<string, unknown>[]) {
          const box = s.mailboxes.find((x) => x.address === m.address);
          if (!box) throw new HttpError(400, `${String(m.address)} isn't one of the shared mailboxes.`);
          if (typeof m.autoReplies === 'boolean') box.autoReplies = m.autoReplies;
          if (typeof m.signature === 'string') box.signature = m.signature.slice(0, 500);
        }
      }
      if (Array.isArray(body.floors)) s.floors = body.floors.filter((f): f is string => typeof f === 'string' && this.state.repos.some((r) => r.id === f));
      if (body.dailyOutreach !== undefined) {
        const n = Number(body.dailyOutreach);
        if (!Number.isInteger(n) || n < 1 || n > 2000) throw new HttpError(400, 'The daily outreach cap is 1 to 2000.');
        s.dailyOutreach = n;
      }
      return s;
    });
  }

  /** POST /api/comms/suppress: an address added to the suppression list by hand. */
  suppressAddress(email: unknown) {
    return this.edit(() => {
      const e = String(email ?? '').trim().toLowerCase();
      if (!isEmail(e)) throw new HttpError(400, `"${e}" isn't an email address.`);
      suppress(this.state.comms, e, 'added by the manager', Date.now());
      return { ok: true };
    });
  }
}
