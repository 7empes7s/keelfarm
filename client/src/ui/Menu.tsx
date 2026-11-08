// The overflow menu (docs/design.md): a ⋯ button that opens a list of actions, with destructive ones in a separated
// danger section. A popover under the button on wide screens, a bottom sheet on phones. Keyboard and screen readers
// follow the WAI-ARIA menu button pattern: arrows move, Home/End jump, Esc closes and returns focus, Tab leaves.
// Outside taps, scrolling and resizing close it. Rules (sections, keys, placement) are pure, in menuLogic.ts.
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { pushLayer } from './backStack';
import { Icon } from './Icon';
import { menuKey, menuPlacement, menuSections, openKey, type MenuItem } from './menuLogic';

export type { MenuItem } from './menuLogic';

const items = (menu: HTMLElement | null) => [...(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])].filter((b) => b.getClientRects().length > 0);

export function Menu({
  label,
  title,
  text,
  items: list,
  className,
  badge = 0,
  initialOpen = false,
}: {
  /** The ⋯ button's accessible name, e.g. "More for Ada". */
  label: string;
  /** The heading of the sheet on phones (and the menu's name); defaults to `label`. */
  title?: string;
  /** Visible words beside the ⋯ (e.g. "Manage"); without it the button is the ⋯ alone. */
  text?: string;
  items: (MenuItem | false | null | undefined)[];
  className?: string;
  /** A count on the ⋯ for what's inside it (#270: a folded tool's badge), none at 0. */
  badge?: number;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const first = useRef(0); // which item takes focus when it opens: 0, or the last for ArrowUp
  const id = useId();
  const { safe, danger } = menuSections(list);

  const close = (restore: boolean) => {
    setOpen(false);
    if (restore) button.current?.focus();
  };

  useLayoutEffect(() => {
    const el = menu.current;
    const b = button.current;
    if (!open || !el || !b) return;
    const { x, y } = menuPlacement(b.getBoundingClientRect(), { width: el.offsetWidth, height: el.offsetHeight }, { width: innerWidth, height: innerHeight });
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    const all = items(el);
    all[first.current < 0 ? all.length - 1 : first.current]?.focus({ preventScroll: true });
  }, [open]);

  // An open sheet is the top layer: Back closes it (backStack.ts).
  useEffect(() => (open ? pushLayer(() => setOpen(false)) : undefined), [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      const t = e.target as Node | null;
      if (t && (menu.current?.contains(t) || button.current?.contains(t))) return;
      close(false);
    };
    const moved = () => close(false);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', outside, true); // the page or a panel scrolled away under it
    window.addEventListener('resize', moved);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', outside, true);
      window.removeEventListener('resize', moved);
    };
  }, [open]);

  const onButtonKey = (e: KeyboardEvent) => {
    if (open) return;
    const at = openKey(e.key, safe.length + danger.length);
    if (at === null) return;
    e.preventDefault();
    first.current = e.key === 'ArrowUp' ? -1 : at;
    setOpen(true);
  };

  const onMenuKey = (e: KeyboardEvent) => {
    const all = items(menu.current);
    const move = menuKey(e.key, all.indexOf(document.activeElement as HTMLButtonElement), all.length);
    if (!move) return;
    // Esc closes the menu only, not the panel it sits in (Panel listens on window).
    e.stopPropagation();
    if ('focus' in move) {
      e.preventDefault();
      all[move.focus]?.focus();
    } else {
      if (move.close === 'restore') e.preventDefault();
      close(move.close === 'restore');
    }
  };

  const pick = (item: MenuItem) => {
    close(true); // focus goes back to ⋯ first, so a confirmation returns it there too
    item.onSelect();
  };

  const row = (item: MenuItem) => (
    <button
      key={item.label}
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={`ds-menu-item ${item.danger ? 'ds-menu-danger' : ''}`}
      data-danger={item.danger ? '' : undefined}
      disabled={item.disabled}
      onClick={() => pick(item)}
    >
      <span className="ds-menu-label">{item.label}</span>
      {item.hint && <span className="ds-menu-hint">{item.hint}</span>}
    </button>
  );

  return (
    <span className={`ds-menu-wrap ${className ?? ''}`}>
      <button
        ref={button}
        type="button"
        className={`ds-btn ds-btn-ghost ${text ? '' : 'ds-btn-icon'}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={badge > 0 ? `${label} (${badge})` : label}
        title={label}
        onClick={() => {
          first.current = 0;
          if (open) close(false);
          else setOpen(true);
        }}
        onKeyDown={onButtonKey}
      >
        {text && <span>{text}</span>}
        <span aria-hidden className="ds-menu-dots">
          <Icon name="ellipsis" />
        </span>
        {badge > 0 && (
          <span className="badge badge-dot ds-menu-badge" aria-hidden>
            {badge}
          </span>
        )}
      </button>
      {open && (
        <>
          <span className="ds-menu-scrim" aria-hidden />
          <div ref={menu} id={id} role="menu" aria-label={title ?? label} className="ds-menu" onKeyDown={onMenuKey}>
            <div className="ds-menu-title" aria-hidden>
              {title ?? label}
            </div>
            {safe.map(row)}
            {danger.length > 0 && safe.length > 0 && <div role="separator" className="ds-menu-sep" />}
            {danger.map(row)}
            <button type="button" role="menuitem" tabIndex={-1} className="ds-menu-item ds-menu-cancel" onClick={() => close(true)}>
              <span className="ds-menu-label">Cancel</span>
            </button>
          </div>
        </>
      )}
    </span>
  );
}
