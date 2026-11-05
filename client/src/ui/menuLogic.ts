// The overflow menu's pure rules (Menu.tsx): which items go where, what a key does, and where the menu opens.
// docs/design.md: destructive actions live in a menu's danger section, below a separator, and still ask to confirm.

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** A destructive or hard-to-undo action: drawn red in the menu's last section. Its onSelect should confirm first. */
  danger?: boolean;
  disabled?: boolean;
  /** A short note under the label, e.g. what the action keeps. */
  hint?: string;
}

/** The items as drawn: the safe ones first, then the danger section. Hidden (falsy) entries are dropped. */
export function menuSections(items: (MenuItem | false | null | undefined)[]): { safe: MenuItem[]; danger: MenuItem[] } {
  const all = items.filter((x): x is MenuItem => !!x);
  return { safe: all.filter((x) => !x.danger), danger: all.filter((x) => x.danger) };
}

/** What a key does while the menu is open, with `index` of `count` items focused: focus another item, close, or nothing. */
export type MenuMove = { focus: number } | { close: 'restore' | 'leave' } | null;

export function menuKey(key: string, index: number, count: number): MenuMove {
  if (count <= 0) return key === 'Escape' ? { close: 'restore' } : null;
  switch (key) {
    case 'ArrowDown':
      return { focus: index < 0 ? 0 : (index + 1) % count };
    case 'ArrowUp':
      return { focus: index < 0 ? count - 1 : (index - 1 + count) % count };
    case 'Home':
      return { focus: 0 };
    case 'End':
      return { focus: count - 1 };
    case 'Escape':
      return { close: 'restore' };
    case 'Tab':
      return { close: 'leave' };
    default:
      return null;
  }
}

/** Keys on the closed ⋯ button that open the menu, and which item they focus first. */
export function openKey(key: string, count: number): number | null {
  if (key === 'ArrowDown' || key === 'Enter' || key === ' ') return 0;
  if (key === 'ArrowUp') return Math.max(0, count - 1);
  return null;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where the menu's top-left corner goes: under the button, its right edge on the button's, flipped above when there's
 * no room below, and always `gutter` inside the viewport.
 */
export function menuPlacement(button: Rect, menu: { width: number; height: number }, view: { width: number; height: number }, gutter = 8) {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
  const x = clamp(button.right - menu.width, gutter, view.width - gutter - menu.width);
  const below = button.bottom + 4;
  const up = below + menu.height > view.height - gutter && button.top - 4 - menu.height >= gutter;
  const y = up ? button.top - 4 - menu.height : clamp(below, gutter, view.height - gutter - menu.height);
  return { x, y, up };
}
