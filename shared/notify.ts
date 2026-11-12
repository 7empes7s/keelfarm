// Notification settings shared by the server (validation, defaults) and the settings UI (labels): which events the
// office tells the manager about, on which channels, and the office URL messages link back to (docs/pocket.md).
import type { NotifyChannel, NotifyChannelsView, NotifyEvent, NotifySettings, NotifyWebhook } from './types.ts';
import { digestHour } from './problems.ts';

/** In the order the settings list them. */
export const NOTIFY_EVENTS: { id: NotifyEvent; label: string }[] = [
  { id: 'needsHuman', label: 'A pull request needs me' },
  { id: 'question', label: "An agent's question only I can answer" },
  { id: 'ceoMessage', label: 'A message from the CEO' },
  { id: 'hire', label: 'A team change waits for my decision' },
  { id: 'agentError', label: 'Someone is stuck in an error for over 10 minutes' },
  { id: 'usage', label: "Claude's usage limit pauses or paces the office" },
  { id: 'memory', label: 'Work has waited long for memory (hourly at most), or lost its session to it' },
  { id: 'disk', label: 'The disk is getting full (once, until it has room again)' },
  { id: 'merge', label: 'Every merge' },
  { id: 'decisions', label: 'A daily digest of decisions waiting on me' },
  { id: 'setup', label: "A floor's setup is missing something its kind of project needs" },
];

export const NOTIFY_WEBHOOKS: NotifyWebhook[] = ['ntfy'];
export const NOTIFY_CHANNELS: NotifyChannel[] = ['desktop', 'push', ...NOTIFY_WEBHOOKS, 'telegram'];

/** Merges are optional: on a busy office they're the noisiest event. The decisions digest is opt-in (#114). */
export const DEFAULT_NOTIFY: NotifySettings = {
  events: { needsHuman: true, question: true, ceoMessage: true, hire: true, agentError: true, usage: true, memory: true, disk: true, merge: false, decisions: false, setup: true },
  channels: { desktop: true, push: true, ntfy: true, telegram: true },
  officeUrl: '',
  telegramMirror: false,
  quietInApp: true,
};

/** An http(s) address the manager's devices can open, or null. */
export function officeUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return '';
  if (s.length > 300) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Notification settings from a saved state or a PATCH /api/settings, field by field; anything invalid keeps `base`. */
export function notifySettings(base: NotifySettings, patch: unknown): NotifySettings {
  const p = (patch && typeof patch === 'object' ? patch : {}) as { events?: unknown; channels?: unknown; officeUrl?: unknown; telegramMirror?: unknown; quietInApp?: unknown; problemsDigestHour?: unknown };
  const pick = <K extends string>(keys: readonly K[], from: Record<K, boolean>, raw: unknown): Record<K, boolean> => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return Object.fromEntries(keys.map((k) => [k, typeof r[k] === 'boolean' ? r[k] : from[k] ?? false])) as Record<K, boolean>;
  };
  const url = officeUrl(p.officeUrl);
  return {
    events: pick(
      NOTIFY_EVENTS.map((e) => e.id),
      { ...DEFAULT_NOTIFY.events, ...base.events },
      p.events,
    ),
    channels: pick(NOTIFY_CHANNELS, { ...DEFAULT_NOTIFY.channels, ...base.channels }, p.channels),
    officeUrl: url ?? base.officeUrl ?? '',
    telegramMirror: typeof p.telegramMirror === 'boolean' ? p.telegramMirror : (base.telegramMirror ?? false),
    quietInApp: typeof p.quietInApp === 'boolean' ? p.quietInApp : (base.quietInApp ?? true),
    ...((p.problemsDigestHour ?? base.problemsDigestHour) !== undefined && { problemsDigestHour: digestHour(p.problemsDigestHour ?? base.problemsDigestHour) }),
  };
}

/** The pocket tab a notification about `event` opens. */
export function noteTab(event: NotifyEvent | 'test'): string {
  if (event === 'needsHuman' || event === 'hire' || event === 'decisions') return 'approvals';
  if (event === 'ceoMessage' || event === 'question') return 'chat';
  if (event === 'agentError') return 'team';
  return 'company';
}

/**
 * The channels that reach the manager's phone with the office closed (#538): push to a signed-up device, a linked
 * Telegram chat, an ntfy topic, each only while it's on. Desktop notifications need an open office tab, so they don't count.
 */
export function phoneReach(c: Pick<NotifyChannelsView, 'pushDevices' | 'telegram' | 'webhooks'>, s: Pick<NotifySettings, 'channels'>): string[] {
  const out: string[] = [];
  if (s.channels.push && c.pushDevices > 0) out.push('push');
  if (s.channels.telegram && c.telegram.linked) out.push('Telegram');
  if (s.channels.ntfy && c.webhooks.ntfy?.set) out.push('ntfy');
  return out;
}
