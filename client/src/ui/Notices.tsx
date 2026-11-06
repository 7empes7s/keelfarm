// Notifications you can act on (#107): the toasts (rich ones with an icon, title, floor chip and up to two buttons;
// paused while touched or hovered, swiped or ✕'d away, errors and what needs you staying), the bell with the unread
// count, and the notification centre listing the recent ones. Tapping one jumps where it's about (noticeNav.ts).
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { api } from '../api';
import { useStore, type Toast } from '../store';
import { useMode } from '../pocket/mode';
import { ACTION_LABEL, NOTICE_KINDS, noteIdFrom, noticeGroups, noticeIcon, sticky, toastMs, toastStack, unreadCount } from '../../../shared/notices';
import type { NoticeKind, NoticeView } from '../../../shared/types';
import { noticeJump, noticeStep, type NoticeStep } from './noticeNav';
import { openFrom } from './RefChips';
import { Panel } from './Panel';
import './notices.css';

const SWIPE_PX = 80;

const world = () => {
  const s = useStore.getState();
  return { repos: s.repos, agents: s.agents, qa: s.qa };
};

function run(step: NoticeStep, pocket: boolean) {
  if (!step) return;
  const s = useStore.getState();
  const toast = (text: string) => () => useStore.getState().pushToast('success', text);
  switch (step.kind) {
    case 'url':
      window.open(step.url, '_blank', 'noopener,noreferrer');
      return;
    case 'file':
      return;
    case 'floor':
      return pocket ? s.openOverlay({ kind: 'kanban', repoId: step.repoId }) : s.goToFloor(step.floor);
    case 'overlay':
      return openFrom(step.overlay, step.floor);
    case 'chat':
      return s.openOverlay({ kind: 'phone', tab: 'chat' });
    case 'approvals':
      if (!pocket) return s.openOverlay({ kind: 'phone', tab: 'hires', requestId: step.requestId });
      s.openOverlay(null);
      window.dispatchEvent(new CustomEvent('cubefarm:open', { detail: '/?tab=approvals' }));
      return;
    case 'call': {
      // Errors are toasts already (api.ts).
      const done =
        step.call === 'approve'
          ? api.approveRequest(step.requestId).then(toast('Approved'))
          : step.call === 'ceoRetry'
            ? api.ceoRetry().then(toast('The CEO tries again'))
            : api.reset(step.agentId).then(toast(`${s.agents[step.agentId]?.name ?? 'Their'} desk is cleared for the next task`));
      void done.catch(() => undefined);
    }
  }
}

const read = (n: NoticeView) => {
  if (!n.read) void api.readNotices([n.id]).catch(() => undefined);
};

/** A notice's icon, title, detail and floor chip, as one button that jumps where it's about. */
function NoticeBody({ n, pocket, after }: { n: NoticeView; pocket: boolean; after?: () => void }) {
  const color = useStore((s) => s.repos.find((r) => r.floor === n.floor)?.color);
  return (
    <button
      type="button"
      className="notice-body"
      onClick={() => {
        read(n);
        after?.();
        run(noticeJump(n, pocket ? 'pocket' : 'office', world()), pocket);
      }}
    >
      <span className="notice-icon" aria-hidden>
        {noticeIcon(n.kind)}
      </span>
      <span className="notice-main">
        <b className="notice-title">{n.title}</b>
        <span className="notice-text">{n.text}</span>
      </span>
      {n.floor !== undefined && (
        <span className="notice-floor" style={{ ['--accent' as string]: color ?? 'var(--ds-accent)' }} title={`Floor ${n.floor}`}>
          {n.floor}
        </span>
      )}
    </button>
  );
}

function NoticeButtons({ n, pocket, after }: { n: NoticeView; pocket: boolean; after?: () => void }) {
  const pending = useStore((s) => !!n.requestId && s.requests.some((r) => r.id === n.requestId && r.status === 'pending'));
  const actions = (n.actions ?? []).filter((a) => a !== 'approve' || pending);
  if (!actions.length) return null;
  return (
    <span className="notice-actions">
      {actions.map((a) => (
        <button
          key={a}
          type="button"
          className="btn btn-small"
          onClick={() => {
            read(n);
            if (a !== 'approve' && a !== 'retry') after?.();
            run(noticeStep(a, n, pocket ? 'pocket' : 'office', world()), pocket);
          }}
        >
          {ACTION_LABEL[a]}
        </button>
      ))}
    </span>
  );
}

function ToastItem({ t, pocket }: { t: Toast; pocket: boolean }) {
  const dismiss = () => useStore.getState().dismissToast(t.id);
  const [paused, setPaused] = useState(false);
  const [dx, setDx] = useState(0);
  const left = useRef(toastMs(t.level, t.notice));
  const swipe = useRef<{ x: number; id: number } | null>(null);
  const swiped = useRef(false); // a swipe that ends on a button isn't a tap on it
  useEffect(() => {
    if (paused || left.current === null) return;
    const from = Date.now();
    const timer = setTimeout(() => useStore.getState().dismissToast(t.id), left.current);
    return () => {
      clearTimeout(timer);
      if (left.current !== null) left.current = Math.max(1500, left.current - (Date.now() - from));
    };
  }, [paused, t.id]);
  const n = t.notice;
  const hold = {
    onPointerEnter: () => setPaused(true),
    onPointerLeave: () => setPaused(false),
    onFocus: () => setPaused(true),
    onBlur: () => setPaused(false),
  };
  if (!n) {
    return (
      <div className={`toast toast-${t.level}`} onClick={dismiss} {...hold}>
        {t.text}
      </div>
    );
  }
  const onDown = (e: ReactPointerEvent) => {
    setPaused(true);
    if (e.pointerType !== 'mouse') swipe.current = { x: e.clientX, id: e.pointerId };
  };
  const onMove = (e: ReactPointerEvent) => {
    if (swipe.current?.id === e.pointerId) setDx(e.clientX - swipe.current.x);
  };
  const onUp = () => {
    swipe.current = null;
    swiped.current = Math.abs(dx) > 10;
    if (Math.abs(dx) > SWIPE_PX) dismiss();
    else setDx(0);
  };
  return (
    <div
      className={`toast toast-${t.level} notice-toast ${sticky(n) ? 'notice-sticky' : ''}`}
      style={dx ? { transform: `translateX(${dx}px)`, opacity: Math.max(0.3, 1 - Math.abs(dx) / 240) } : undefined}
      {...hold}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onClickCapture={(e) => {
        if (swiped.current) e.stopPropagation();
        swiped.current = false;
      }}
    >
      <NoticeBody n={n} pocket={pocket} after={dismiss} />
      <NoticeButtons n={n} pocket={pocket} after={dismiss} />
      <button type="button" className="notice-x" aria-label="Dismiss" onClick={dismiss}>
        ✕
      </button>
    </div>
  );
}

/** The toasts, newest at the end; `max` show and the rest collapse into "+N more", which opens the centre. */
export function NoticeToasts({ max }: { max: number }) {
  const toasts = useStore((s) => s.toasts);
  const pocket = useMode((s) => s.mode) === 'pocket';
  useNoticeSync();
  const { shown, more } = toastStack(toasts, max);
  return (
    <div className="toasts">
      {more > 0 && (
        <button type="button" className="toast notice-more" onClick={() => useStore.getState().openOverlay({ kind: 'notices' })}>
          +{more} more
        </button>
      )}
      {shown.map((t) => (
        <ToastItem key={t.id} t={t} pocket={pocket} />
      ))}
    </div>
  );
}

/** Opening a pushed notification (`?note=`) or the chat marks what it's about read, in every tab. */
function useNoticeSync() {
  const loaded = useStore((s) => s.loaded);
  const chat = useStore((s) => s.overlay?.kind === 'phone' && (s.overlay.tab ?? 'chat') === 'chat');
  const ceoUnread = useStore((s) => s.notices.filter((n) => n.kind === 'ceo' && !n.read).map((n) => n.id).join(','));
  useEffect(() => {
    if (!loaded) return;
    const mark = (url: string) => {
      const id = noteIdFrom(url);
      const n = id && useStore.getState().notices.find((x) => x.id === id);
      if (n) read(n);
    };
    mark(location.href);
    const onOpen = (e: Event) => mark(String((e as CustomEvent<string>).detail ?? ''));
    window.addEventListener('cubefarm:open', onOpen);
    return () => window.removeEventListener('cubefarm:open', onOpen);
  }, [loaded]);
  useEffect(() => {
    if (chat && ceoUnread) void api.readNotices(ceoUnread.split(',')).catch(() => undefined);
  }, [chat, ceoUnread]);
}

/** The bell: the notification centre, with how many are unread. */
export function NoticeBell({ className }: { className: string }) {
  const unread = useStore((s) => unreadCount(s.notices));
  const label = unread ? `Notifications, ${unread} unread` : 'Notifications';
  return (
    <button type="button" className={`notice-bell ${className}`} onClick={() => useStore.getState().openOverlay({ kind: 'notices' })} aria-label={label} title={label}>
      🔔
      {unread > 0 && <span className="badge badge-dot">{unread > 99 ? '99+' : unread}</span>}
    </button>
  );
}

const when = (at: number, today: boolean) => new Date(at).toLocaleString([], today ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/** The notification centre: the recent notices, Today and Earlier, by floor and kind, each with its buttons. */
export function NoticeCentre() {
  const notices = useStore((s) => s.notices);
  const repos = useStore((s) => s.repos);
  const pocket = useMode((s) => s.mode) === 'pocket';
  const [floor, setFloor] = useState('');
  const [kind, setKind] = useState('');
  const groups = noticeGroups(notices, Date.now(), { ...(floor && { floor: Number(floor) }), ...(kind && { kind: kind as NoticeKind }) });
  const close = () => useStore.getState().openOverlay(null);
  return (
    <Panel title="🔔 Notifications" onClose={close} className="notice-centre">
      <div className="notice-filters">
        <select aria-label="Floor" value={floor} onChange={(e) => setFloor(e.target.value)}>
          <option value="">Every floor</option>
          {repos.map((r) => (
            <option key={r.id} value={r.floor}>
              {r.floor} · {r.fullName.split('/')[1]}
            </option>
          ))}
        </select>
        <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Everything</option>
          {NOTICE_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.icon} {k.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-small" disabled={!unreadCount(notices)} onClick={() => void api.readNotices().catch(() => undefined)}>
          Mark all read
        </button>
      </div>
      {groups.length === 0 && <p className="muted">{notices.length ? 'None of them match.' : 'Nothing yet: merges, QA verdicts and what needs you show up here.'}</p>}
      {groups.map((g) => (
        <section key={g.label} className="notice-group">
          <h3>{g.label}</h3>
          <ul>
            {g.items.map((n) => (
              <li key={n.id} className={`notice-row ${n.read ? '' : 'notice-unread'}`}>
                <NoticeBody n={n} pocket={pocket} />
                <span className="notice-foot">
                  <time dateTime={new Date(n.at).toISOString()}>{when(n.at, g.label === 'Today')}</time>
                  {!n.read && <span className="sr-only">unread</span>}
                  <NoticeButtons n={n} pocket={pocket} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Panel>
  );
}
