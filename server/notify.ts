// Notifications, the pure part (docs/pocket.md): what a note says on each channel, the threads that keep it to one
// notification per event type, held back while the manager is in the app or reads it (#210), the chat apps' webhook settings (checked, and hinted at without the secret), and
// which agents have been stuck in an error long enough to mention. notifier.ts does the sending.
import type { AttentionEvent, NotifyEvent, NotifyWebhook } from '../shared/types.ts';
import { cleanTerminalText } from '../shared/terminalText.ts';
import { HttpError } from './httpError.ts';

/** An agent in an error this long is worth a notification (once per error). */
export const STUCK_ERROR_MS = 10 * 60_000;
const BODY_MAX = 300;
const SUMMARY_LINES = 5;
const HELD_MAX = 50;

/** One thing to tell the manager. `line` is its one-line form, used when a summary lists several. */
export interface Note {
  event: NotifyEvent | 'test';
  title: string;
  body: string;
  line: string;
  /** Team changes it asks about: Telegram shows a button to approve or decline each. A summary has none. */
  changes?: TeamChange[];
  /** Its notice in the notification centre (#107): the links carry it, so opening one marks it read. */
  id?: string;
  /** A thread's unread notes it stands for (group), when more than one. */
  count?: number;
}

/** A team change waiting for the manager, as its buttons name it. */
export interface TeamChange {
  id: string;
  name: string;
  kind: 'hire' | 'let-go';
}

const PLURAL: Record<NotifyEvent, string> = {
  needsHuman: 'PRs need you',
  question: 'questions wait for you',
  ceoMessage: 'messages from the CEO',
  hire: 'team changes wait for you',
  agentError: 'agents need help',
  usage: 'usage changes',
  memory: 'memory alerts',
  disk: 'disk warnings',
  merge: 'merges',
  decisions: 'decision digests',
};
const ICON: Record<NotifyEvent | 'test', string> = { needsHuman: '⚠️', question: '❓', ceoMessage: '💬', hire: '📄', agentError: '🛑', usage: '⏸', memory: '🩺', disk: '💽', merge: '🔀', decisions: '🧭', test: '🔔' };

export const clip = (s: string, max = BODY_MAX) => {
  const t = cleanTerminalText(s, Infinity).replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/** A phone message's markdown as one plain line: no emphasis, code ticks, headings or link targets. */
export function plainText(md: string, max = BODY_MAX): string {
  const s = md
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_](?!\s)([^*_\n]+?)[*_](?!\w)/g, '$1$2')
    .replace(/^\s*(#{1,6}|>|[-*+•])\s+/gm, '')
    .replace(/\|/g, ' ');
  return clip(s, max);
}

/** A note with its event's icon in front of the title. */
export function note(event: NotifyEvent | 'test', title: string, body: string, line = title, changes?: TeamChange[], id?: string): Note {
  return { event, title: `${ICON[event]} ${clip(title, 120)}`, body: clip(body), line: clip(line, 120), ...(changes?.length ? { changes } : {}), ...(id ? { id } : {}) };
}

/** The office's link for a note: with its notice's id (`?note=`), so opening it there marks it read. */
export function noteLink(officeUrl: string, n: Pick<Note, 'id'>): string {
  if (!officeUrl || !n.id) return officeUrl;
  const u = new URL(officeUrl);
  u.searchParams.set('note', n.id);
  return u.toString();
}

/**
 * A thread's unread notes as one notification that replaces the last (#210): one note stays itself; a chat burst is
 * "💬 Mimoun: 3 new messages" with the latest as its body, other events a count and their latest lines.
 */
export function group(notes: Note[], dropped = 0): Note {
  const last = notes[notes.length - 1];
  const count = notes.length + dropped;
  if (count === 1) return last;
  const id = last.id ? { id: last.id } : {};
  if (last.event === 'ceoMessage') return { event: last.event, title: `${last.title}: ${count} new messages`, body: last.body, line: last.line, count, ...id };
  const shown = notes.slice(-SUMMARY_LINES).reverse();
  const lines = shown.map((n) => `• ${n.line}`);
  if (count > shown.length) lines.push(`…and ${count - shown.length} more`);
  const label = last.event === 'test' ? 'tests' : PLURAL[last.event];
  return { event: last.event, title: `${ICON[last.event]} ${count} ${label}`, body: lines.join('\n'), line: `${count} ${label}`, count, ...id };
}

// ---------- quiet while in the app, and one notification per thread (#210) ----------

/** One open office tab, as it reports itself (ClientEvent 'attention'): on screen or not, and its last input. */
export interface TabAttention {
  visible: boolean;
  at: number;
  /** In a voice call with the CEO (#287): nothing goes out, the CEO says what matters. */
  call?: boolean;
}

/** The manager is in the app when any tab, on any device, is on screen and was used this recently. */
export const ACTIVE_MS = 60_000;
/** Not in the app: a note waits this long, so reading it on a device meanwhile cancels it. */
export const GRACE_MS = 15_000;
/** At most one notification per thread this often while it's unread; the count updates in place. */
export const THREAD_GAP_MS = 2 * 60_000;

/** A tab's attention message on /ws (ClientEvent 'attention'), or null for anything else. */
export function parseAttention(raw: unknown): AttentionEvent | null {
  let m: { type?: unknown; visible?: unknown; call?: unknown };
  try {
    m = JSON.parse(String(raw)) as typeof m;
  } catch {
    return null;
  }
  if (m?.type !== 'attention' || typeof m.visible !== 'boolean') return null;
  return { type: 'attention', visible: m.visible, ...(m.call === true && { call: true as const }) };
}

/** Whether some tab is in a voice call: quiet then even when hidden (the phone locked mid-call) or quiet-in-app is off. */
export const inCall = (tabs: Iterable<TabAttention>) => [...tabs].some((t) => t.call);

/** Whether the manager is in the app on some device right now. */
export function inApp(tabs: Iterable<TabAttention>, now: number): boolean {
  for (const t of tabs) if (t.visible && now - t.at < ACTIVE_MS) return true;
  return false;
}

/** A thread is an event type (its push tag): the unread notes, those not sent yet (`fresh`), when it's due and last went out. */
interface Thread {
  notes: Note[];
  dropped: number;
  fresh: number;
  dueAt: number | null;
  sentAt: number | null;
}
export type Threads = Partial<Record<string, Thread>>;

/** What a step decided: notes to send now (grouped, standing for `sent` new notes), notes not sent as the manager was in the app, threads to clear on devices. */
export interface Step {
  threads: Threads;
  send: Note[];
  sent: number;
  skipped: Note[];
  clear: string[];
}

const EMPTY: Thread = { notes: [], dropped: 0, fresh: 0, dueAt: null, sentAt: null };

/** The manager saw `thread` (in the app, or read it): it starts over, and a notification it left on devices is cleared. */
function seen(step: Step, event: string, inAppNow: boolean) {
  const t = step.threads[event];
  if (!t) return;
  if (inAppNow) step.skipped.push(...t.notes.slice(t.notes.length - Math.min(t.fresh, t.notes.length)));
  if (t.sentAt !== null) step.clear.push(event);
  step.threads = { ...step.threads, [event]: undefined };
}

/** A new note: dropped as seen while the manager is in the app, else held for the grace (or the thread's gap). */
export function queue(threads: Threads, n: Note, now: number, present: boolean): Step {
  const step: Step = { threads, send: [], sent: 0, skipped: [], clear: [] };
  if (present) {
    seen(step, n.event, true);
    step.skipped.push(n);
    return step;
  }
  const t = threads[n.event] ?? EMPTY;
  const full = t.notes.length >= HELD_MAX;
  const dueAt = t.dueAt ?? Math.max(now + GRACE_MS, t.sentAt === null ? 0 : t.sentAt + THREAD_GAP_MS);
  step.threads = { ...threads, [n.event]: { ...t, notes: full ? [...t.notes.slice(1), n] : [...t.notes, n], dropped: t.dropped + (full ? 1 : 0), fresh: t.fresh + 1, dueAt } };
  return step;
}

/** The threads whose wait is over: one grouped notification each, or nothing when the manager is in the app by now. */
export function due(threads: Threads, now: number, present: boolean): Step {
  const step: Step = { threads, send: [], sent: 0, skipped: [], clear: [] };
  for (const [event, t] of Object.entries(threads)) {
    if (!t || t.dueAt === null || t.dueAt > now) continue;
    if (present) {
      seen(step, event, true);
      continue;
    }
    step.send.push(group(t.notes, t.dropped));
    step.sent += t.fresh;
    step.threads = { ...step.threads, [event]: { ...t, fresh: 0, dueAt: null, sentAt: now } };
  }
  return step;
}

/** The manager read these threads on some device: what waits is cancelled, and what was sent is cleared everywhere. */
export function read(threads: Threads, events: readonly string[]): Step {
  const step: Step = { threads, send: [], sent: 0, skipped: [], clear: [] };
  for (const e of events) seen(step, e, false);
  return step;
}

/** The manager read these notices (#107): a thread whose notes are all read is read. */
export function readNotes(threads: Threads, ids: readonly string[]): Step {
  const gone = new Set(ids);
  const done = Object.entries(threads).flatMap(([e, t]) => (t && t.notes.length && t.notes.every((n) => n.id && gone.has(n.id)) ? [e] : []));
  return read(threads, done);
}

/** When the next thread is due, or null when nothing waits. */
export function nextDue(threads: Threads): number | null {
  const times = Object.values(threads).flatMap((t) => (t && t.dueAt !== null ? [t.dueAt] : []));
  return times.length ? Math.min(...times) : null;
}

// ---------- what each channel is sent ----------

/** The office's link, or nothing. */
const link = (officeUrl: string) => (officeUrl ? `\n${officeUrl}` : '');

/** The note as plain text, e.g. for the demo's log and the push body. */
export function noteText(n: Note, officeUrl = ''): string {
  return `${n.title}\n${n.body}${link(officeUrl)}`.trim();
}

/** ntfy's JSON publishing: POSTed to the server's root with the topic in the body. */
export function ntfyPayload(n: Note, topic: string, officeUrl = '') {
  const urgent = n.event === 'needsHuman' || n.event === 'agentError' || n.event === 'usage' || n.event === 'memory';
  return { topic, title: n.title, message: n.body, priority: urgent ? 4 : 3, ...(officeUrl ? { click: officeUrl } : {}) };
}

// ---------- the chat apps' settings ----------

export interface WebhookSecrets {
  ntfy?: { url: string; token?: string };
}

const httpUrl = (raw: unknown, what: string): URL => {
  const s = typeof raw === 'string' ? raw.trim() : '';
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new HttpError(400, `That isn't a ${what} URL.`);
  }
  if (s.length > 500 || !/^https?:$/.test(u.protocol)) throw new HttpError(400, `That isn't a ${what} URL.`);
  return u;
};

/**
 * A chat app's settings from PUT /api/notify/webhooks/:channel, checked. null removes them (an empty url or token).
 * ntfy takes a topic URL and an optional token.
 */
export function parseWebhook(_channel: NotifyWebhook, body: unknown): WebhookSecrets[NotifyWebhook] | null {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof b[k] === 'string' ? (b[k] as string).trim() : '');
  if (!s('url')) return null;
  const u = httpUrl(s('url'), 'ntfy topic');
  if (!/^\/[\w-]{1,64}\/?$/.test(u.pathname)) throw new HttpError(400, 'Give the topic URL, e.g. https://ntfy.sh/my-office-a8f3 (a long, hard-to-guess topic name).');
  const token = s('token');
  if (token && !/^[\w.-]{8,200}$/.test(token)) throw new HttpError(400, "That doesn't look like an ntfy access token (tk_…).");
  return { url: u.toString().replace(/\/$/, ''), ...(token ? { token } : {}) };
}

/** Where an ntfy topic URL publishes as JSON: the server's root, with the topic in the body. */
export function ntfyTarget(topicUrl: string): { root: string; topic: string } {
  const u = new URL(topicUrl);
  return { root: `${u.origin}/`, topic: u.pathname.replace(/^\/|\/$/g, '') };
}

const last4 = (s: string) => s.slice(-4);

/** What the settings show of a saved webhook: enough to recognise it, never enough to use it. */
export function webhookHint(channel: NotifyWebhook, w: WebhookSecrets[NotifyWebhook] | undefined): string {
  if (!w) return '';
  const host = new URL(w.url).host;
  return `${host}/…${last4(w.url)}${channel === 'ntfy' && 'token' in w && w.token ? ' · with a token' : ''}`;
}

/** The secret strings in `w`, for redacting anything that might echo them. */
export function secretValues(w: WebhookSecrets): string[] {
  return Object.values(w).flatMap((v) => Object.values(v ?? {}).filter((x): x is string => typeof x === 'string' && x.length >= 6));
}

/** `text` with every secret (and any URL path, which is where webhook secrets live) blanked out. */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join('••••');
  return out.replace(/(https?:\/\/[^/\s]+)\/[^\s]*/g, '$1/••••');
}

// ---------- stuck agents ----------

/** Agents stuck in an error for STUCK_ERROR_MS that haven't been mentioned for this error yet (keyed by id and endedAt). */
export function stuckAgents<A extends { id: string; status: string; endedAt: number | null }>(agents: readonly A[], now: number, told: ReadonlySet<string>): { agent: A; key: string }[] {
  return agents.flatMap((a) => {
    const key = `${a.id}:${a.endedAt ?? 0}`;
    return a.status === 'error' && a.endedAt != null && now - a.endedAt >= STUCK_ERROR_MS && !told.has(key) ? [{ agent: a, key }] : [];
  });
}
