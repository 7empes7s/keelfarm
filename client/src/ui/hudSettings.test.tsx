import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from './consoleNavRules';
import { defaultBindings, findConflicts } from './keymap';
import { SessionsButton, SettingsButton, openSettings, openTeam } from './HudSettings';

// The store needs a browser; the buttons only call its openOverlay.
const openOverlay = vi.fn();
vi.mock('../store', () => ({ useStore: { getState: () => ({ openOverlay }) } }));
beforeEach(() => openOverlay.mockClear());

describe("the 3D HUD's Settings button (#315)", () => {
  it('renders a Settings button with the gear', () => {
    const html = renderToStaticMarkup(<SettingsButton />);
    expect(html).toMatch(/^<button/);
    expect(html).toContain('aria-label="Settings (,)"');
    expect(html).toContain('lucide-settings');
  });

  it("opens the manager's console on the Settings tab, where the 2D app's Settings goes", () => {
    openSettings();
    expect(openOverlay).toHaveBeenCalledWith({ kind: 'manager', tab: 'settings' });
    expect(resolve('settings', 'office')?.group).toBe('settings');
  });

  it('has a free key of its own', () => {
    const b = defaultBindings();
    expect(b.settings).toEqual(['Comma']);
    expect(findConflicts(b)).toEqual([]);
  });
});

describe('the sessions pill', () => {
  it('is a button without the gear that opens Team', () => {
    const html = renderToStaticMarkup(<SessionsButton running={2} limit={4} />);
    expect(html).toMatch(/^<button/);
    expect(html).toContain('2/4 sessions');
    expect(html).not.toContain('lucide-settings');
    openTeam();
    expect(openOverlay).toHaveBeenCalledWith({ kind: 'manager', tab: 'team' });
  });
});
