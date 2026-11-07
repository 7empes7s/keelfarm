import { cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode, type PointerEvent as RPointerEvent, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { createPeek, placePeek, type Box, type PeekController, type PeekMode } from './hoverRules';
import { pushLayer } from './backStack';
import './hoverCard.css';
import { Icon } from './Icon';

// Hover cards (#213): explain or preview a thing in place. A card after 350 ms of hover or keyboard focus, beside its
// trigger and never over the CEO chat; a small sheet after a long-press on touch, while a tap still does the trigger's
// own action. Dismissible (Esc, a tap elsewhere), hoverable and persistent (WCAG 1.4.13). Timing and placement are
// pure, in hoverRules.ts. Content reads what's already in the store.

/** What a peek must stay off: the CEO chat column beside the page, and the chat's message box. */
const AVOID = '.pk-dock, .chat-input';

const toBox = (r: DOMRect): Box => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });

/** One trigger's peek: props for the trigger, and the card's state. */
export function usePeek() {
  const [mode, setMode] = useState<PeekMode | null>(null);
  const ctl = useRef<PeekController | null>(null);
  ctl.current ??= createPeek(setMode);
  const c = ctl.current;
  useEffect(() => () => c.dispose(), [c]);
  const anchor = useRef<HTMLElement | null>(null);
  const card = useRef<HTMLDivElement | null>(null);
  const touch = useRef(false);
  const id = useId();
  const mouse = (e: RPointerEvent) => e.pointerType === 'mouse';
  const trigger = {
    onPointerEnter: (e: RPointerEvent) => mouse(e) && c.hoverIn(),
    onPointerLeave: (e: RPointerEvent) => mouse(e) && c.hoverOut(),
    onPointerDown: (e: RPointerEvent) => {
      touch.current = !mouse(e);
      if (touch.current) c.pressStart();
    },
    onPointerUp: (e: RPointerEvent) => !mouse(e) && c.pressEnd(),
    onPointerCancel: () => c.pressEnd(),
    onContextMenu: (e: SyntheticEvent) => {
      // On touch a long press is the peek, not the browser's menu or the row's own.
      if (!touch.current) return;
      e.preventDefault();
      e.stopPropagation();
    },
    onFocus: (e: SyntheticEvent) => (e.target as Element).matches?.(':focus-visible') && c.focusIn(),
    onBlur: (e: SyntheticEvent & { relatedTarget: EventTarget | null }) => !card.current?.contains(e.relatedTarget as Node) && c.focusOut(),
    onKeyDown: (e: { key: string; preventDefault: () => void }) => {
      // ↓ moves into an open card, to its actions.
      if (e.key !== 'ArrowDown' || !c.mode) return;
      const first = card.current?.querySelector<HTMLElement>('button, a[href]');
      if (!first) return;
      e.preventDefault();
      first.focus();
    },
    onClickCapture: (e: SyntheticEvent) => {
      if (c.click()) return;
      e.preventDefault();
      e.stopPropagation();
    },
  };
  return { mode, ctl: c, anchor, card, id, trigger };
}

/** The card (or sheet) itself, drawn into the page's body. */
export function Peek({ peek, label, children }: { peek: ReturnType<typeof usePeek>; label: string; children: ReactNode }) {
  const { mode, ctl, anchor, card, id } = peek;
  const [pos, setPos] = useState<{ left: number; top: number; side: string } | null>(null);
  useLayoutEffect(() => {
    if (mode !== 'card') return setPos(null);
    const a = anchor.current?.getBoundingClientRect();
    const el = card.current;
    if (!a || !el) return;
    const avoid = [...document.querySelectorAll(AVOID)].filter((x) => !x.contains(anchor.current)).map((x) => toBox(x.getBoundingClientRect())).filter((b) => b.right > b.left);
    setPos(placePeek(toBox(a), el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight, avoid));
  }, [mode, anchor, card]);
  useEffect(() => {
    if (!mode) return;
    const inside = (t: EventTarget | null) => !!t && (card.current?.contains(t as Node) || anchor.current?.contains(t as Node));
    const onKey = (e: KeyboardEvent) => {
      // Esc is the peek's first: the panel under it stays open.
      if (e.key === 'Escape' && ctl.escape()) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    const away = (e: Event) => !inside(e.target) && ctl.close();
    const scrolled = (e: Event) => mode === 'card' && !inside(e.target) && ctl.close();
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('scroll', scrolled, true);
    // The back gesture closes a sheet, not the panel under it.
    const unlayer = mode === 'sheet' ? pushLayer(() => ctl.close()) : null;
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('scroll', scrolled, true);
      unlayer?.();
    };
  }, [mode, ctl, anchor, card]);
  if (!mode) return null;
  const sheet = mode === 'sheet';
  return createPortal(
    <>
      {/* React sends a portal's clicks up its tree: they mustn't reach a trigger's clickable ancestor */}
      {sheet && <div className="peek-scrim" aria-hidden onClick={(e) => e.stopPropagation()} />}
      <div
        ref={card}
        id={id}
        role={sheet ? 'dialog' : 'tooltip'}
        aria-label={label}
        className={`peek ${sheet ? 'peek-sheet' : `peek-card peek-${pos?.side ?? 'bottom'}`}`}
        style={sheet ? undefined : pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}
        onPointerEnter={(e) => e.pointerType === 'mouse' && ctl.hoverIn()}
        onPointerLeave={(e) => e.pointerType === 'mouse' && ctl.hoverOut()}
        onBlur={(e) => !card.current?.contains(e.relatedTarget as Node) && e.relatedTarget !== anchor.current && ctl.close()}
        onClick={(e) => {
          e.stopPropagation();
          // An action in it was taken: the peek's done.
          if ((e.target as Element).closest('button, a')) ctl.close();
        }}
      >
        {sheet && (
          <button type="button" className="peek-x" aria-label="Close" onClick={() => ctl.close()}>
            <Icon name="x" />
          </button>
        )}
        {children}
      </div>
    </>,
    document.body,
  );
}

/**
 * Wraps one element (a button, link, chip, avatar or tile) with a peek: `peek` is what the card shows, drawn only
 * while it's open. The element keeps its own click; it gets `aria-describedby` while the card is up.
 */
export function HoverCard({ peek, label, children }: { peek: ReactNode; label: string; children: ReactElement<Record<string, unknown>> }) {
  const p = usePeek();
  if (!isValidElement(children)) return children;
  return (
    <>
      <span
        className="peek-trigger"
        ref={(el) => void (p.anchor.current = (el?.firstElementChild as HTMLElement | null) ?? null)}
        {...p.trigger}
      >
        {cloneElement(children, { 'aria-describedby': p.mode ? p.id : undefined })}
      </span>
      <Peek peek={p} label={label}>
        {peek}
      </Peek>
    </>
  );
}

/** An icon button's label and shortcut, sliding out on hover or focus: put it in a `.xbtn` (the button keeps its aria-label). */
export function XLabel({ text, keys }: { text: string; keys?: string }) {
  return (
    <span className="xbtn-label" aria-hidden>
      {text}
      {keys && <kbd>{keys}</kbd>}
    </span>
  );
}

// ---------- the card's parts ----------

export interface PeekAction {
  label: string;
  onSelect: () => void;
}

/** A peek's usual layout: a title, a few stats, a bar or sparkline, a note and up to two actions. */
export function PeekCard({ title, sub, stats, bar, spark, note, actions, children }: { title: ReactNode; sub?: ReactNode; stats?: [string, ReactNode][]; bar?: { pct: number; tone?: 'good' | 'warn' | 'bad'; label: string }; spark?: number[]; note?: ReactNode; actions?: PeekAction[]; children?: ReactNode }) {
  return (
    <>
      <b className="peek-title">{title}</b>
      {sub && <div className="peek-sub">{sub}</div>}
      {stats && stats.length > 0 && (
        <dl className="peek-stats">
          {stats.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {bar && (
        <div className={`peek-bar ${bar.tone ? `peek-bar-${bar.tone}` : ''}`} role="img" aria-label={bar.label}>
          <i style={{ width: `${Math.round(Math.max(0, Math.min(1, bar.pct)) * 100)}%` }} />
        </div>
      )}
      {spark && spark.length > 1 && <PeekSpark values={spark} />}
      {children}
      {note && <p className="peek-note">{note}</p>}
      {actions && actions.length > 0 && (
        <div className="peek-actions">
          {actions.slice(0, 2).map((a) => (
            <button key={a.label} type="button" className="ds-btn btn-small" onClick={a.onSelect}>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** A 7-point (or so) trend line; the numbers are said by the peek's words. */
function PeekSpark({ values }: { values: number[] }) {
  const max = Math.max(...values, 1e-9);
  const min = Math.min(...values, 0);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(1)},${(22 - ((v - min) / (max - min || 1)) * 20).toFixed(1)}`).join(' ');
  return (
    <svg className="peek-spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} />
    </svg>
  );
}
