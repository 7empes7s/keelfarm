import { devices, type Locator, type Page, type WebSocketRoute } from '@playwright/test';
import { expect, test } from './helpers';
import { dialog, pocketSection } from './layout/helpers';
import type { TermClientMessage } from '../shared/types';

// A recording fake PTY behind the actual terminal socket, shared by all three real screens. Server routing into a
// bound PTY (and unbound input) is independently exercised by server/terminal.test.ts.
test.use({ isMobile: true, hasTouch: true, userAgent: devices['iPhone 15'].userAgent, viewport: { width: 390, height: 844 } });

async function openTerminal(page: Page, kind: 'agent' | 'ceo' | 'signin') {
  await page.goto('/?pocket=1&tab=team');
  if (kind === 'agent') {
    await page.locator('.pocket').getByRole('button', { name: 'Terminal', exact: true }).first().tap();
    const panel = page.locator('.panel.term-phone');
    await panel.getByRole('button', { name: 'Open terminal' }).tap();
    await panel.getByRole('button', { name: 'Terminal keys' }).tap();
    return panel;
  }
  await page.getByRole('button', { name: 'Settings and notifications' }).tap();
  const settings = dialog(page, /Settings/);
  await pocketSection(settings, kind === 'ceo' ? 'The CEO' : 'Providers & accounts');
  if (kind === 'ceo') return settings.locator('.live-term');
  await settings.getByRole('button', { name: 'More for Max · keelops' }).tap();
  await page.getByRole('menuitem', { name: /Sign in again/ }).tap();
  await page.locator('.acc-signin').getByRole('button', { name: 'Show terminal' }).tap(); // folded under the guided sign-in (#350)
  return page.locator('.acc-signin');
}

const key = (term: Locator, name: string | RegExp) => term.locator('.term-keys-row').getByRole('button', { name, exact: typeof name === 'string' });

for (const kind of ['agent', 'ceo', 'signin'] as const) {
  test(`${kind}: touch text, keys, Ctrl latch and Paste reach the PTY at 390px`, async ({ page, context }) => {
    const received: string[] = [];
    let socket: WebSocketRoute | undefined;
    // This socket-level fake owns the sign-in too; do not leave a real demo login waiting between tests.
    if (kind === 'signin') await page.route('**/api/accounts/*/signin', (route) => route.fulfill({ json: {} }));
    await page.routeWebSocket(/\/ws\/term\?agent=/, (ws) => {
      socket = ws;
      ws.send(JSON.stringify({ t: 'snapshot', data: 'Fake PTY ready\r\n', cols: 40, rows: 12, live: true }));
      ws.onMessage((raw) => {
        const m = JSON.parse(String(raw)) as TermClientMessage;
        if (m.t === 'input') received.push(m.data);
      });
    });
    const term = await openTerminal(page, kind);
    const input = term.locator('.xterm-helper-textarea');
    await expect(term.locator('.xterm-rows')).toContainText('Fake PTY ready');
    await input.focus();
    await page.keyboard.type('hello');
    await key(term, /^Esc:/).tap();
    await key(term, 'Enter').tap();
    for (const name of ['Up', 'Down', 'Left', 'Right']) await key(term, name).tap();
    await key(term, /^Ctrl\+C:/).tap();
    await key(term, /^Ctrl:/).tap();
    await expect(key(term, /^Ctrl:/)).toHaveAttribute('aria-pressed', 'true');
    await input.focus();
    await page.keyboard.type('a');
    await expect(key(term, /^Ctrl:/)).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.type('b');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(() => navigator.clipboard.writeText(' pasted '));
    await key(term, /^Paste/).tap();
    await expect.poll(() => received.join('')).toBe('hello\x1b\r\x1b[A\x1b[B\x1b[D\x1b[C\x03\x01bpasted');
    // A dropped notice is visible even on the agent's compact terminal, which has no LiveTerminal footer.
    socket!.send(JSON.stringify({ t: 'dropped' }));
    await expect(term.getByRole('status')).toHaveText('Nothing is running here: start the agent or sign in first');
    await key(term, /^Shift\+Tab:/).scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`${kind}-keys.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    socket!.send(JSON.stringify({ t: 'live', live: true }));
    await expect(term.getByRole('status')).toBeHidden();
  });
}

test.describe('desktop terminal input', () => {
  test.use({ isMobile: false, hasTouch: false, userAgent: devices['Desktop Chrome'].userAgent, viewport: { width: 1280, height: 800 } });

  test('Ctrl+V pastes and Escape reaches the CLI without closing the window', async ({ page, context }) => {
    const received: string[] = [];
    await page.routeWebSocket(/\/ws\/term\?agent=/, (ws) => {
      ws.send(JSON.stringify({ t: 'snapshot', data: 'Desktop PTY ready\r\n', cols: 100, rows: 24, live: true }));
      ws.onMessage((raw) => {
        const m = JSON.parse(String(raw)) as TermClientMessage;
        if (m.t === 'input') received.push(m.data);
      });
    });
    await page.goto('/?pocket=1&tab=team');
    await page.locator('.pocket').getByRole('button', { name: 'Terminal', exact: true }).first().click();
    const panel = page.locator('.panel.aw-desk');
    await panel.getByRole('button', { name: 'Terminal', exact: true }).click();
    await expect(panel.locator('.xterm-rows')).toContainText('Desktop PTY ready');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(() => navigator.clipboard.writeText('desktop paste'));
    await panel.locator('.xterm-helper-textarea').focus();
    await page.keyboard.press('Control+v');
    await page.keyboard.press('Escape');
    await expect.poll(() => received.join('')).toBe('desktop paste\x1b');
    await expect(panel).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('desktop-terminal.png') });
  });
});
