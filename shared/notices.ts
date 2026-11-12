// The notification centre's rules (#107), pure, for the server and the client: what a notice holds, how many are
// kept, read and unread, Today / Earlier, the filters, which toasts stay until dismissed and how a stack collapses.
import type { NoticeAction, NoticeKind, NoticeView, ServerEvent } from './types.ts';

export const NOTICES_KEEP = 100;
const NOTICE_DAYS = 7;
const DAY_MS = 86_400_000;

/** In the order the centre's filter lists them. */
export const NOTICE_KINDS: { id: NoticeKind; icon: string; label: string }[] = [
  { id: 'needsYou', icon: '⚠️', label: 'Needs you' },
  { id: 'approval', icon: '✋', label: 'Approvals' },
  { id: 'it', icon: '🔧', label: 'IT' },
  { id: 'ceo', icon: '💬', label: 'CEO' },
  { id: 'merge', icon: '🔀', label: 'Merges' },
  { id: 'qaPass', icon: '✅', label: 'QA passed' },
  { id: 'qaFail', icon: '❌', label: 'QA failed' },
  { id: 'stuck', icon: '🛑', label: 'Stuck' },
  { id: 'error', icon: '💥', label: 'Errors' },
  { id: 'usage', icon: '⏸', label: 'Usage' },
  { id: 'update', icon: '⬆️', label: 'Updates' },
  { id: 'setup', icon: '🧭', label: 'Setup' },
  { id: 'keys', icon: '🔑', label: 'Keys' },
];
export const noticeIcon = (k: NoticeKind) => NOTICE_KINDS.find((x) => x.id === k)?.icon ?? '🔔';

export const ACTION_LABEL: Record<NoticeAction, string> = {
  openPr: 'Open PR',
  openQa: 'QA report',
  approve: 'Approve',
  reply: 'Reply',
  terminal: 'Terminal',
  retry: 'Retry',
  approvals: 'Approvals',
  setup: 'Set it up',
  reviewKeys: 'Review',
  openIt: 'Open IT',
};

const LEVEL: Partial<Record<NoticeKind, NoticeView['level']>> = { merge: 'success', qaPass: 'success', qaFail: 'error', error: 'error', stuck: 'error' };

export type NoticeInput = Omit<NoticeView, 'id' | 'at' | 'read' | 'level'> & { level?: NoticeView['level'] };

const clip = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/** A new notice: one-line title and detail, at most two distinct actions, unread. */
export function makeNotice(input: NoticeInput, id: string, at: number): NoticeView {
  const actions = [...new Set(input.actions ?? [])].slice(0, 2);
  return {
    ...input,
    id,
    at,
    level: input.level ?? LEVEL[input.kind] ?? 'info',
    title: clip(input.title, 100),
    text: clip(input.text, 300), // as long as a push's body (server/notify.ts)
    actions: actions.length ? actions : undefined,
    read: false,
  };
}

/** The ones kept: the last NOTICES_KEEP of the last NOTICE_DAYS, oldest first; anything malformed is dropped. */
export function keepNotices(list: unknown, now: number): NoticeView[] {
  if (!Array.isArray(list)) return [];
  return (list as NoticeView[])
    .filter((n) => n && typeof n.id === 'string' && typeof n.title === 'string' && Number.isFinite(n.at) && now - n.at < NOTICE_DAYS * DAY_MS)
    .sort((a, b) => a.at - b.at)
    .slice(-NOTICES_KEEP);
}

export const addNotice = (list: NoticeView[], n: NoticeView, now: number) => keepNotices([...list.filter((x) => x.id !== n.id), n], now);

/** `ids` read; null: all of them. The same list back when nothing changes. */
export function markRead(list: NoticeView[], ids: readonly string[] | null): NoticeView[] {
  const hit = (n: NoticeView) => !n.read && (ids === null || ids.includes(n.id));
  return list.some(hit) ? list.map((n) => (hit(n) ? { ...n, read: true } : n)) : list;
}

export const unreadCount = (list: readonly NoticeView[]) => list.reduce((c, n) => c + (n.read ? 0 : 1), 0);

export interface NoticeFilter {
  floor?: number;
  kind?: NoticeKind;
}

/** Newest first, filtered, in Today and Earlier (by the viewer's calendar day); empty groups left out. */
export function noticeGroups(list: readonly NoticeView[], now: number, f: NoticeFilter = {}): { label: 'Today' | 'Earlier'; items: NoticeView[] }[] {
  const d = new Date(now);
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const shown = list.filter((n) => (f.floor === undefined || n.floor === f.floor) && (f.kind === undefined || n.kind === f.kind)).sort((a, b) => b.at - a.at);
  const today = shown.filter((n) => n.at >= midnight);
  const earlier = shown.filter((n) => n.at < midnight);
  return [
    { label: 'Today' as const, items: today },
    { label: 'Earlier' as const, items: earlier },
  ].filter((g) => g.items.length);
}

/** Errors and what waits on the manager stay until dismissed; the rest time out. */
export const sticky = (n: Pick<NoticeView, 'kind'>) => n.kind === 'needsYou' || n.kind === 'approval' || n.kind === 'error' || n.kind === 'stuck';

/** How long a toast shows (null: until dismissed). */
export const toastMs = (level: NoticeView['level'], n?: Pick<NoticeView, 'kind'>): number | null => (n && sticky(n) ? null : level === 'error' ? 9000 : n ? 7000 : 5000);

/** The toasts on screen, newest last, and how many more the "+N more" line stands for. */
export function toastStack<T>(toasts: readonly T[], max: number): { shown: T[]; more: number } {
  return { shown: toasts.slice(-max), more: Math.max(0, toasts.length - max) };
}

/** A toast event's notice, when it's a rich one. */
export function noticeOf(ev: Extract<ServerEvent, { type: 'toast' }>): NoticeView | null {
  if (!ev.id || !ev.kind || ev.at === undefined) return null;
  const { id, kind, at, level, text, floor, target, actions, requestId } = ev;
  return { id, kind, at, level, title: ev.title ?? text, text, floor, target, actions, requestId, read: ev.read ?? false };
}

/** The notice id a tapped push or Telegram link carries (`?note=`), or null. */
export function noteIdFrom(url: string): string | null {
  try {
    const id = new URL(url, 'http://x').searchParams.get('note');
    return id && /^[\w-]{1,40}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
