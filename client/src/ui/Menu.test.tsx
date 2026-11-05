import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Menu } from './Menu';
import { menuKey, menuPlacement, menuSections, openKey, type MenuItem } from './menuLogic';

const noop = () => {};
const ITEMS: (MenuItem | false)[] = [
  { label: 'Let Ada go', onSelect: noop, danger: true },
  { label: 'Terminal', onSelect: noop },
  false,
  { label: 'Sync now', onSelect: noop, hint: 'Fast-forward the folder' },
];

describe('menuSections', () => {
  it('puts safe items first and danger items last, dropping hidden ones', () => {
    const { safe, danger } = menuSections(ITEMS);
    expect(safe.map((x) => x.label)).toEqual(['Terminal', 'Sync now']);
    expect(danger.map((x) => x.label)).toEqual(['Let Ada go']);
  });
});

describe('opening', () => {
  it('opens on Enter, Space and ArrowDown at the first item, on ArrowUp at the last', () => {
    expect(openKey('Enter', 3)).toBe(0);
    expect(openKey(' ', 3)).toBe(0);
    expect(openKey('ArrowDown', 3)).toBe(0);
    expect(openKey('ArrowUp', 3)).toBe(2);
    expect(openKey('a', 3)).toBeNull();
  });

  it('renders closed as a ⋯ menu button only', () => {
    const html = renderToStaticMarkup(<Menu label="More for Ada" items={ITEMS} />);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="More for Ada"');
    expect(html).not.toContain('role="menu"');
  });

  it('renders open with the danger section after a separator, then Cancel', () => {
    const html = renderToStaticMarkup(<Menu label="More for Ada" title="Ada" items={ITEMS} initialOpen />);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('role="menu"');
    expect(html).toContain('aria-label="Ada"');
    const order = ['Terminal', 'Sync now', 'role="separator"', 'Let Ada go', 'Cancel'].map((s) => html.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html.match(/data-danger=""/g)).toHaveLength(1);
    expect(html).toMatch(/class="ds-menu-item ds-menu-danger"[^>]*data-danger=""[^>]*>.*Let Ada go/);
    expect(html.match(/role="menuitem"/g)).toHaveLength(4);
  });

  it('leaves out the separator when every item is safe, or every item is dangerous', () => {
    expect(renderToStaticMarkup(<Menu label="m" items={[ITEMS[1]]} initialOpen />)).not.toContain('separator');
    expect(renderToStaticMarkup(<Menu label="m" items={[ITEMS[0]]} initialOpen />)).not.toContain('separator');
  });
});

describe('keys in an open menu', () => {
  it('moves with the arrows, wrapping, and jumps with Home and End', () => {
    expect(menuKey('ArrowDown', 0, 3)).toEqual({ focus: 1 });
    expect(menuKey('ArrowDown', 2, 3)).toEqual({ focus: 0 });
    expect(menuKey('ArrowUp', 0, 3)).toEqual({ focus: 2 });
    expect(menuKey('ArrowDown', -1, 3)).toEqual({ focus: 0 });
    expect(menuKey('Home', 2, 3)).toEqual({ focus: 0 });
    expect(menuKey('End', 0, 3)).toEqual({ focus: 2 });
  });

  it('closes on Escape (focus back to ⋯) and on Tab (focus moves on)', () => {
    expect(menuKey('Escape', 1, 3)).toEqual({ close: 'restore' });
    expect(menuKey('Tab', 1, 3)).toEqual({ close: 'leave' });
    expect(menuKey('Escape', -1, 0)).toEqual({ close: 'restore' });
  });

  it('ignores other keys', () => {
    expect(menuKey('a', 0, 3)).toBeNull();
    expect(menuKey('Enter', 0, 3)).toBeNull(); // the focused item's own click handles Enter
  });
});

describe('menuPlacement', () => {
  const view = { width: 390, height: 844 };
  const menu = { width: 220, height: 200 };
  it('opens under the button, right edges lined up', () => {
    expect(menuPlacement({ left: 300, top: 100, right: 344, bottom: 144 }, menu, view)).toEqual({ x: 124, y: 148, up: false });
  });
  it('stays inside the viewport on the left', () => {
    expect(menuPlacement({ left: 10, top: 100, right: 54, bottom: 144 }, menu, view).x).toBe(8);
  });
  it('flips above when there is no room below', () => {
    const p = menuPlacement({ left: 300, top: 760, right: 344, bottom: 804 }, menu, view);
    expect(p.up).toBe(true);
    expect(p.y).toBe(556);
  });
});
