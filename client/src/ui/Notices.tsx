// Notifications you can act on (#107): the toasts (rich ones with an icon, title, floor chip and up to two buttons;
// paused while touched or hovered, swiped or ✕'d away, errors and what needs you staying), the bell with the unread
// count, and the notification centre listing the recent ones. Tapping one jumps where it's about (noticeNav.ts).
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref, type RefObject } from 'react';
import { create } from 'zustand';
import { api } from '../api';
import { useStore, type Toast } from '../store';
import { useMode } from '../pocket/mode';
import { ACTION_LABEL, NOTICE_KINDS, noteIdFrom, noticeGroups, noticeIcon, sticky, toastMs, toastStack, unreadCount } from '../../../shared/notices';
import type { NoticeKind, NoticeView } from '../../../shared/types';
import { noticeJump, noticeStep, type NoticeStep } from './noticeNav';
import { openFrom } from './RefChips';
import { Panel } from './Panel';
import { Popover } from './Popover';
import { XLabel } from './HoverCard';
import { useToastSpot } from './useToastSpot';
import { useKeyReview } from './keyReview';
import { useTour } from './tour';
import './notices.css';
import { CloseButton, Icon } from './Icon';
import { iconFor } from './icons';

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
    case 'keys':
      useKeyReview.setState({ open: true });
      return s.openOverlay({ kind: 'manager', tab: 'providers' });
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

/** A notice's icon, title (with `meta` on its line), detail and floor chip, as one button that jumps where it's about. */
function NoticeBody({ n, pocket, after, meta, textRef }: { n: NoticeView; pocket: boolean; after?: () => void; meta?: ReactNode; textRef?: Ref<HTMLSpanElement> }) {
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
        <Icon name={iconFor(noticeIcon(n.kind), 'bell')} />
      </span>
      <span className="notice-main">
        <span className="notice-head">
          <b className="notice-title">{n.title}</b>
          {meta}
        </span>
        <span className="notice-text" ref={textRef}>
          {n.text}
        </span>
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
      <div className={`toast toast-${t.level}`} title={`${t.text} (click to dismiss)`} onClick={dismiss} {...hold}>
        <span className="toast-text">{t.text}</span>
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
      <CloseButton className="notice-x" label="Dismiss" onClick={dismiss} />
    </div>
  );
}

/** The toasts, newest at the end; `max` show and the rest collapse into "+N more", which opens the centre. */
export function NoticeToasts({ max }: { max: number }) {
  const all = useStore((s) => s.toasts);
  const pocket = useMode((s) => s.mode) === 'pocket';
  const tour = useTour((s) => s.on || s.task); // they wait behind the tour, their time starting once it's done (#408)
  useNoticeSync();
  const toasts = tour ? [] : all;
  const { shown, more } = toastStack(toasts, max);
  const box = useRef<HTMLDivElement>(null);
  const spot = useToastSpot(box, shown.length + (more > 0 ? 1 : 0)); // never over a header or a tab row (#230)
  return (
    <div className="toasts" ref={box} style={spot}>
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

/** Whether the bell's popover is open (the tour's "Open the bell" step counts it). */
export const useNoticePop = create<{ open: boolean }>(() => ({ open: false }));
const setPop = (open: boolean) => useNoticePop.setState({ open });

/** The bell, with how many are unread: a popover under it (#416), on a phone (`compact`) the notification centre. */
export function NoticeBell({ className, compact }: { className: string; compact?: boolean }) {
  const unread = useStore((s) => unreadCount(s.notices));
  const open = useNoticePop((s) => s.open) && !compact;
  const ref = useRef<HTMLButtonElement>(null);
  const label = unread ? `Notifications, ${unread} unread` : 'Notifications';
  return (
    <>
      <button
        ref={ref}
        type="button"
        data-tour="bell"
        className={`notice-bell xbtn ${className}`}
        onClick={() => (compact ? useStore.getState().openOverlay({ kind: 'notices' }) : setPop(!open))}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={compact ? undefined : open}
        title={label}
      >
        <Icon name="bell" />
        <XLabel text="Notifications" />
        {unread > 0 && <span className="badge badge-dot">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && <NoticePopover anchor={ref} onClose={() => setPop(false)} />}
    </>
  );
}

/** The bell's popover: the recent notices as the centre's cells, Mark all read, and See all for the full page. */
function NoticePopover({ anchor, onClose }: { anchor: RefObject<HTMLElement | null>; onClose: () => void }) {
  const notices = useStore((s) => s.notices);
  const pocket = useMode((s) => s.mode) === 'pocket';
  const groups = noticeGroups(notices, Date.now(), {});
  const seeAll = () => {
    onClose();
    useStore.getState().openOverlay({ kind: 'notices' });
  };
  return (
    <Popover
      anchor={anchor}
      label="Notifications"
      title={
        <>
          <Icon name="bell" /> Notifications
        </>
      }
      className="notice-pop"
      onClose={onClose}
    >
      <div className="notice-pop-bar">
        <button type="button" className="btn btn-small" disabled={!unreadCount(notices)} onClick={() => void api.readNotices().catch(() => undefined)}>
          Mark all read
        </button>
        <button type="button" className="btn btn-small btn-ghost" onClick={seeAll}>
          See all <Icon name="chevron-right" />
        </button>
      </div>
      {groups.length === 0 && <p className="muted">Nothing yet: merges, QA verdicts and what needs you show up here.</p>}
      {groups.map((g) => (
        <section key={g.label} className="notice-group">
          <h3>{g.label}</h3>
          <ul>
            {g.items.map((n) => (
              <NoticeRow key={n.id} n={n} pocket={pocket} today={g.label === 'Today'} after={onClose} />
            ))}
          </ul>
        </section>
      ))}
    </Popover>
  );
}

/** One cell of the centre (#298): body clamped to three lines, More opens it; the unread dot by the time. `after`: it jumped somewhere. */
function NoticeRow({ n, pocket, today, after }: { n: NoticeView; pocket: boolean; today: boolean; after?: () => void }) {
  const text = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const el = text.current;
    if (!el || open) return;
    const check = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [n.text, open]);
  const meta = (
    <span className="notice-meta">
      {!n.read && <span className="notice-dot" aria-hidden />}
      <time dateTime={new Date(n.at).toISOString()}>{when(n.at, today)}</time>
      {!n.read && <span className="sr-only">unread</span>}
    </span>
  );
  return (
    <li className={`notice-row notice-${n.level} ${n.read ? '' : 'notice-unread'} ${open ? 'notice-open' : ''}`}>
      <NoticeBody n={n} pocket={pocket} after={after} meta={meta} textRef={text} />
      {(clamped || open || !!n.actions?.length) && (
        <span className="notice-foot">
          {(clamped || open) && (
            <button type="button" className="btn btn-small btn-ghost notice-expand" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? 'Less' : 'More'}
            </button>
          )}
          <NoticeButtons n={n} pocket={pocket} after={after} />
        </span>
      )}
    </li>
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
    <Panel
      title={
        <>
          <Icon name="bell" /> Notifications
        </>
      }
      onClose={close}
      className="notice-centre"
    >
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
              {k.label}
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
              <NoticeRow key={n.id} n={n} pocket={pocket} today={g.label === 'Today'} />
            ))}
          </ul>
        </section>
      ))}
    </Panel>
  );
}
