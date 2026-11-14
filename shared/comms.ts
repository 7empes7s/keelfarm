// The Comms floor's mail (#668), pure: the office's shared mailboxes, threads read from them, drafts that wait for the
// manager's Approve (unless a mailbox's auto-replies are on), the lead list, and the outreach rules: every new email
// carries an unsubscribe line, nobody on the suppression list gets one, and a warm-up cap per day. The server's side is
// server/swarm/comms.ts (Graph calls in server/mail.ts); the screen is client/src/ui/CommsPage.tsx.

export const MAIL_LABELS = ['lead', 'customer', 'support', 'spam'] as const;
export type MailLabel = (typeof MAIL_LABELS)[number];
export const LEAD_STAGES = ['new', 'contacted', 'replied', 'qualified', 'won', 'lost'] as const;
type LeadStage = (typeof LEAD_STAGES)[number];
/** Marketing beyond mail joins the same queue: social posts and newsletters are approved here too. */
type DraftChannel = 'email' | 'social' | 'newsletter';
type DraftStatus = 'draft' | 'waiting' | 'approved' | 'sent' | 'discarded' | 'failed';

interface Mailbox {
  address: string;
  name: string;
  signature: string;
  /** Replies from this mailbox send without the manager's Approve (the manager turns it on). Never new emails. */
  autoReplies: boolean;
}
export interface MailMessage {
  id: string;
  from: string;
  fromName?: string;
  to: string[];
  subject: string;
  text: string;
  at: number;
  out?: true; // sent by the office
}
export interface MailThread {
  id: string;
  mailbox: string;
  subject: string;
  with: string; // the other side's address
  withName?: string;
  label?: MailLabel;
  unread: boolean;
  last: number;
  messages: MailMessage[];
}
export interface MailDraft {
  id: string;
  channel: DraftChannel;
  mailbox: string; // '' for a social post
  to: string[];
  subject: string;
  text: string;
  threadId?: string; // a reply in this thread; without one it's outreach
  status: DraftStatus;
  by: string;
  at: number;
  sentAt?: number;
  why?: string; // a refusal or failure, in plain words
  auto?: true; // sent by a mailbox's auto-reply rule
}
export interface Lead {
  id: string;
  name: string;
  email: string;
  company?: string;
  source: string; // 'mail', 'agency', 'referral'…
  stage: LeadStage;
  lastContact?: number;
  nextStep?: string;
}
interface Suppressed {
  email: string;
  at: number;
  why: string;
}
export interface CommsSettings {
  domain: string;
  mailboxes: Mailbox[];
  /** Floors whose agents get the mail tools (the Comms floor). */
  floors: string[];
  /** Outreach emails a day once warmed up. */
  dailyOutreach: number;
}
export interface CommsState {
  seq: number;
  settings: CommsSettings;
  threads: MailThread[];
  drafts: MailDraft[];
  leads: Lead[];
  suppressed: Suppressed[];
  /** Each outreach send's time, for the daily cap (the last 2 days kept). */
  outreachSent: number[];
  warmupFrom: number; // the first outreach send, 0 before
}
export interface CommsView {
  connected: boolean; // mail_app_ensure has run (the demo always is)
  settings: CommsSettings;
  threads: MailThread[];
  drafts: MailDraft[];
  leads: Lead[];
  suppressed: number;
  outreach: { today: number; cap: number };
}

export const DEFAULT_DOMAIN = 'techinsiderbytes.com';
const DAY = 86_400_000;
const THREADS_MAX = 200;
const DRAFTS_KEPT = 60;
const TEXT_MAX = 20_000;
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const LOCAL = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const normEmail = (s: unknown) => String(s ?? '').trim().toLowerCase();
export const isEmail = (s: string) => EMAIL.test(s) && s.length <= 254;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A mailbox on the domain from "sales" or "sales@domain"; throws on anything else. */
export function mailboxAddress(input: string, domain: string): string {
  const s = normEmail(input);
  const local = s.includes('@') ? s.slice(0, s.indexOf('@')) : s;
  if (!LOCAL.test(local) || (s.includes('@') && s !== `${local}@${domain}`)) throw new Error(`"${input}" isn't a mailbox on ${domain} like sales or sales@${domain}.`);
  return `${local}@${domain}`;
}

const defaultMailbox = (address: string): Mailbox => {
  const local = address.split('@')[0];
  return { address, name: cap(local), signature: `${cap(local)} · Tech Insider Bytes\n${address}`, autoReplies: false };
};

export function defaultComms(): CommsState {
  return {
    seq: 0,
    settings: { domain: DEFAULT_DOMAIN, mailboxes: ['hello', 'sales', 'support'].map((l) => defaultMailbox(`${l}@${DEFAULT_DOMAIN}`)), floors: [], dailyOutreach: 200 },
    threads: [],
    drafts: [],
    leads: [],
    suppressed: [],
    outreachSent: [],
    warmupFrom: 0,
  };
}

/** The saved state, anything malformed dropped. */
export function loadComms(raw: unknown): CommsState {
  const d = defaultComms();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<CommsState>;
  const arr = <T>(v: unknown, ok: (x: T) => boolean): T[] => (Array.isArray(v) ? (v as T[]).filter((x) => x && typeof x === 'object' && ok(x)) : []);
  const s = (r.settings ?? {}) as Partial<CommsSettings>;
  const mailboxes = arr<Mailbox>(s.mailboxes, (m) => typeof m.address === 'string' && isEmail(m.address));
  return {
    seq: Number.isInteger(r.seq) ? r.seq! : 0,
    settings: {
      domain: typeof s.domain === 'string' && s.domain ? s.domain : d.settings.domain,
      mailboxes: mailboxes.length ? mailboxes.map((m) => ({ ...defaultMailbox(m.address), ...m, autoReplies: m.autoReplies === true })) : d.settings.mailboxes,
      floors: Array.isArray(s.floors) ? s.floors.filter((x): x is string => typeof x === 'string') : [],
      dailyOutreach: Number.isFinite(s.dailyOutreach) && s.dailyOutreach! > 0 ? Math.min(2000, Math.round(s.dailyOutreach!)) : d.settings.dailyOutreach,
    },
    threads: arr<MailThread>(r.threads, (t) => typeof t.id === 'string' && Array.isArray(t.messages)),
    drafts: arr<MailDraft>(r.drafts, (x) => typeof x.id === 'string' && typeof x.text === 'string'),
    leads: arr<Lead>(r.leads, (l) => typeof l.id === 'string' && typeof l.email === 'string'),
    suppressed: arr<Suppressed>(r.suppressed, (x) => typeof x.email === 'string'),
    outreachSent: Array.isArray(r.outreachSent) ? r.outreachSent.filter((n) => Number.isFinite(n)) : [],
    warmupFrom: Number.isFinite(r.warmupFrom) ? r.warmupFrom! : 0,
  };
}

// ---------- the mailbox scope ----------

/** The listed mailbox with this address; nothing else can be read or sent as. */
const listedMailbox = (s: CommsSettings, address: string) => s.mailboxes.find((m) => m.address === normEmail(address));

/** Why a mailbox can't be used, or null: it must be one of the office's shared mailboxes. */
function mailboxRefusal(s: CommsSettings, address: string): string | null {
  return listedMailbox(s, address) ? null : `${address || 'That mailbox'} isn't one of the office's shared mailboxes (${s.mailboxes.map((m) => m.address).join(', ')}): mail can only be read and sent as those.`;
}

// ---------- outreach: unsubscribe, suppression, warm-up ----------

const unsubLink = (mailbox: string) => `mailto:${mailbox}?subject=unsubscribe`;

/** The line every outreach email ends with (GDPR / ePrivacy): a reply "unsubscribe" puts the sender on the suppression list. */
const unsubscribeLine = (mailbox: string) => `Don't want these emails? Reply "unsubscribe" or write to ${unsubLink(mailbox)} and you won't hear from us again.`;

export const hasUnsubscribe = (text: string, mailbox: string) => text.includes(unsubLink(mailbox));

/** A message asking to be left alone: its subject or first line says unsubscribe or stop. */
export function isUnsubscribeRequest(m: Pick<MailMessage, 'subject' | 'text'>): boolean {
  const first = m.text.trim().split(/\r?\n/)[0] ?? '';
  return /^\s*((re|aw|fw|fwd):\s*)*(unsubscribe|stop)\b/i.test(m.subject) || /^\s*(unsubscribe|stop|remove me)\b[.!]?\s*$/i.test(first);
}

const isSuppressed = (state: Pick<CommsState, 'suppressed'>, email: string) => state.suppressed.some((x) => x.email === normEmail(email));

export function suppress(state: CommsState, email: string, why: string, now: number): boolean {
  const e = normEmail(email);
  if (!isEmail(e) || isSuppressed(state, e)) return false;
  state.suppressed.push({ email: e, at: now, why });
  for (const l of state.leads) if (l.email === e && l.stage !== 'won') l.stage = 'lost';
  return true;
}

/** Outreach a day during warm-up: 20 the first week, doubling each week, up to the setting. */
export function outreachCap(warmupFrom: number, now: number, max: number): number {
  if (!warmupFrom) return Math.min(20, max);
  const week = Math.max(0, Math.floor((now - warmupFrom) / (7 * DAY)));
  return Math.min(max, 20 * 2 ** Math.min(week, 10));
}

const startOfDay = (now: number) => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const outreachToday = (state: CommsState, now: number) => state.outreachSent.filter((t) => t >= startOfDay(now)).length;

// ---------- drafts and sending ----------

const isOutreach = (d: Pick<MailDraft, 'channel' | 'threadId'>) => d.channel === 'email' && !d.threadId;

export type SendCheck = { ok: true; auto: boolean } | { ok: false; why: string };

/**
 * Whether a draft may go out, and whether it goes without the manager: only a listed mailbox; outreach never to a
 * suppressed address, always with the unsubscribe line and under the day's cap; auto only for a reply from a mailbox
 * whose auto-replies the manager turned on.
 */
export function sendCheck(state: CommsState, d: MailDraft, now: number): SendCheck {
  if (d.channel !== 'email') return { ok: true, auto: false };
  const no = mailboxRefusal(state.settings, d.mailbox);
  if (no) return { ok: false, why: no };
  if (!d.to.length || d.to.some((t) => !isEmail(t))) return { ok: false, why: `Not an email address: ${d.to.find((t) => !isEmail(t)) ?? '(none)'}.` };
  if (isOutreach(d)) {
    const off = d.to.filter((t) => isSuppressed(state, t));
    if (off.length) return { ok: false, why: `${off.join(', ')} asked not to be emailed (suppression list).` };
    if (!hasUnsubscribe(d.text, d.mailbox)) return { ok: false, why: 'Outreach needs its unsubscribe line: keep the last paragraph.' };
    const max = outreachCap(state.warmupFrom, now, state.settings.dailyOutreach);
    if (outreachToday(state, now) + d.to.length > max) return { ok: false, why: `Today's outreach cap is reached (${max} a day while warming up): it can go tomorrow.` };
  }
  return { ok: true, auto: !isOutreach(d) && listedMailbox(state.settings, d.mailbox)!.autoReplies };
}

/** A sent outreach counted toward the cap (and the warm-up started). */
export function countOutreach(state: CommsState, d: MailDraft, now: number) {
  if (!isOutreach(d)) return;
  if (!state.warmupFrom) state.warmupFrom = now;
  state.outreachSent = [...state.outreachSent.filter((t) => t > now - 2 * DAY), ...d.to.map(() => now)];
}

/** Templates the mail tools fill: {name} and {company} from the lead. */
export const MAIL_TEMPLATES: Record<string, { subject: string; text: string }> = {
  intro: { subject: 'Short clips for {company}', text: 'Hi {name},\n\nWe turn long videos into short clips for creators and teams like {company}. Would a free sample from one of your videos help?' },
  followup: { subject: 'Re: Short clips for {company}', text: 'Hi {name},\n\nJust following up on my note last week: happy to make a free sample clip if that is useful.' },
  support: { subject: 'Re: your message', text: 'Hi {name},\n\nThanks for writing in: we have your message and will get back to you within one working day.' },
};

const fill = (s: string, v: { name?: string; company?: string }) => s.replace(/\{name\}/g, v.name || 'there').replace(/\{company\}/g, v.company || 'your team');

export interface DraftInput {
  channel?: DraftChannel;
  mailbox?: string;
  to?: string[];
  subject?: string;
  text?: string;
  template?: string;
  threadId?: string;
}

/** A new draft: a reply goes to its thread's sender; the mailbox's signature added, and outreach's unsubscribe line. Throws in plain words. */
export function makeDraft(state: CommsState, a: DraftInput, by: string, now: number): MailDraft {
  const channel = a.channel ?? 'email';
  const thread = a.threadId ? state.threads.find((t) => t.id === a.threadId) : undefined;
  if (a.threadId && !thread) throw new Error(`No thread ${a.threadId}: mail_list shows them.`);
  const lead = state.leads.find((l) => l.email === normEmail(a.to?.[0] ?? thread?.with));
  const tpl = a.template ? MAIL_TEMPLATES[a.template] : undefined;
  if (a.template && !tpl) throw new Error(`No template "${a.template}": ${Object.keys(MAIL_TEMPLATES).join(', ')}.`);
  const vars = { name: (lead?.name ?? thread?.withName ?? '').split(' ')[0], company: lead?.company };
  const body = (a.text?.trim() || (tpl ? fill(tpl.text, vars) : '')).slice(0, TEXT_MAX);
  if (!body) throw new Error('A draft needs its text (or a template).');
  if (channel !== 'email') return { id: `d${++state.seq}`, channel, mailbox: '', to: [], subject: (a.subject ?? '').slice(0, 200), text: body, status: 'draft', by, at: now };
  const mailbox = normEmail(a.mailbox ?? thread?.mailbox);
  const no = mailboxRefusal(state.settings, mailbox);
  if (no) throw new Error(no);
  const to = thread ? [thread.with] : (a.to ?? []).map(normEmail);
  if (!to.length) throw new Error('A new email needs `to`.');
  const subject = (a.subject?.trim() || (thread ? (/^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`) : tpl ? fill(tpl.subject, vars) : '')).slice(0, 200);
  if (!subject) throw new Error('A new email needs a subject.');
  const box = listedMailbox(state.settings, mailbox)!;
  const parts = [body, box.signature.trim()];
  if (!thread) parts.push(unsubscribeLine(mailbox));
  return { id: `d${++state.seq}`, channel, mailbox, to, subject, text: parts.filter(Boolean).join('\n\n'), ...(thread && { threadId: thread.id }), status: 'draft', by, at: now };
}

/** Old drafts beyond the kept number dropped (waiting ones always stay). */
export function trimDrafts(drafts: MailDraft[]): MailDraft[] {
  const open = drafts.filter((d) => d.status === 'waiting' || d.status === 'draft');
  const done = drafts.filter((d) => !open.includes(d)).slice(-DRAFTS_KEPT);
  return drafts.filter((d) => open.includes(d) || done.includes(d));
}

// ---------- the inbox ----------

/** A thread's label from where it came in and who wrote. */
function labelFor(state: CommsState, mailbox: string, from: string): MailLabel | undefined {
  const lead = state.leads.find((l) => l.email === from);
  if (lead) return lead.stage === 'won' ? 'customer' : 'lead';
  const local = mailbox.split('@')[0];
  return local === 'support' ? 'support' : local === 'sales' ? 'lead' : undefined;
}

export interface Incoming extends MailMessage {
  threadId: string; // Graph's conversationId
  read: boolean;
}

/** Messages read from a mailbox folded into its threads: unsubscribe requests suppressed, leads' last contact moved. Returns the new ones. */
export function mergeInbox(state: CommsState, mailbox: string, msgs: readonly Incoming[], now: number): Incoming[] {
  const fresh: Incoming[] = [];
  for (const m of [...msgs].sort((a, b) => a.at - b.at)) {
    const from = normEmail(m.from);
    let t = state.threads.find((x) => x.id === m.threadId);
    if (t?.messages.some((x) => x.id === m.id)) continue;
    fresh.push(m);
    if (!t) {
      t = { id: m.threadId, mailbox, subject: m.subject, with: from, ...(m.fromName && { withName: m.fromName }), unread: false, last: m.at, messages: [] };
      const label = labelFor(state, mailbox, from);
      if (label) t.label = label;
      state.threads.push(t);
      if (label === 'lead' && !state.leads.some((l) => l.email === from) && isEmail(from)) upsertLead(state, { email: from, name: m.fromName, source: 'mail' }); // a new sales enquiry joins the lead list
    }
    t.messages.push({ id: m.id, from, ...(m.fromName && { fromName: m.fromName }), to: m.to, subject: m.subject, text: m.text.slice(0, TEXT_MAX), at: m.at });
    t.last = Math.max(t.last, m.at);
    if (!m.read) t.unread = true;
    if (isUnsubscribeRequest(m)) suppress(state, from, `asked on ${new Date(m.at).toISOString().slice(0, 10)}`, now);
    const lead = state.leads.find((l) => l.email === from);
    if (lead) {
      lead.lastContact = Math.max(lead.lastContact ?? 0, m.at);
      if (lead.stage === 'contacted') lead.stage = 'replied'; // an answer to our email
    }
  }
  state.threads = state.threads.sort((a, b) => b.last - a.last).slice(0, THREADS_MAX);
  return fresh;
}

/** A sent email added to its thread (or a new one) and its lead marked contacted. */
export function recordSent(state: CommsState, d: MailDraft, now: number) {
  const msg: MailMessage = { id: `sent-${d.id}`, from: d.mailbox, to: d.to, subject: d.subject, text: d.text, at: now, out: true };
  let t = d.threadId ? state.threads.find((x) => x.id === d.threadId) : undefined;
  if (!t) {
    t = { id: `out-${d.id}`, mailbox: d.mailbox, subject: d.subject, with: d.to[0], unread: false, last: now, messages: [] };
    const label = labelFor(state, d.mailbox, d.to[0]);
    if (label) t.label = label;
    state.threads.unshift(t);
  }
  t.messages.push(msg);
  t.last = now;
  for (const l of state.leads) {
    if (!d.to.includes(l.email)) continue;
    l.lastContact = now;
    if (l.stage === 'new') l.stage = 'contacted';
  }
}

// ---------- leads ----------

export interface LeadInput {
  email?: string;
  name?: string;
  company?: string;
  source?: string;
  stage?: string;
  next_step?: string;
}

/** A lead added or updated by email. Throws in plain words. */
export function upsertLead(state: CommsState, a: LeadInput): Lead {
  const email = normEmail(a.email);
  if (!isEmail(email)) throw new Error(`"${a.email ?? ''}" isn't an email address.`);
  if (a.stage && !(LEAD_STAGES as readonly string[]).includes(a.stage)) throw new Error(`stage is one of ${LEAD_STAGES.join(', ')}.`);
  let l = state.leads.find((x) => x.email === email);
  if (!l) {
    l = { id: `l${++state.seq}`, name: (a.name ?? email.split('@')[0]).slice(0, 100), email, source: (a.source ?? 'mail').slice(0, 40), stage: 'new' };
    state.leads.unshift(l);
  }
  if (a.name) l.name = a.name.slice(0, 100);
  if (a.company !== undefined) l.company = a.company.slice(0, 100) || undefined;
  if (a.source) l.source = a.source.slice(0, 40);
  if (a.stage) l.stage = a.stage as LeadStage;
  if (a.next_step !== undefined) l.nextStep = a.next_step.slice(0, 200) || undefined;
  return l;
}

// ---------- the view ----------

export function commsView(state: CommsState, connected: boolean, now: number): CommsView {
  return {
    connected,
    settings: state.settings,
    threads: state.threads.slice(0, 60),
    drafts: [...state.drafts].reverse(),
    leads: state.leads,
    suppressed: state.suppressed.length,
    outreach: { today: outreachToday(state, now), cap: outreachCap(state.warmupFrom, now, state.settings.dailyOutreach) },
  };
}
