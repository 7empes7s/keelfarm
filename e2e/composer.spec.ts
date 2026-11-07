import { devices, type Page } from '@playwright/test';
import { expect, test } from './helpers';

// The CEO chat's composer stack on a phone with the keyboard up (#152): the working strip, the attachment tray and the
// message box in one column above the keyboard, none over another or over the conversation, the tab bar out of the way.

/** A 1x1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const DRAFT = ['agents takes me to kanban.', 'Lets also rework redirections to', 'take to the exact section not', 'only page. But for this case it', 'doesnt make sense to talk about', 'floor and agents and not take me there.'].join('\n');

/** Keeps the CEO busy with a review, whatever the demo's own CEO does, so the working strip stays up. */
async function ceoWorking(page: Page) {
  await page.routeWebSocket(/\/ws$/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((data) => {
      if (typeof data !== 'string') return ws.send(data);
      const ev = JSON.parse(data);
      const job = { kind: 'review', label: 'Reviewing the company' };
      if (ev.type === 'snapshot') {
        ev.snapshot.ceo.job = job;
        for (const a of ev.snapshot.agents) if (a.id === 'ceo') a.status = 'working';
      } else if (ev.type === 'ceo') ev.ceo.job = job;
      else if (ev.type === 'agent' && ev.agent.id === 'ceo') ev.agent.status = 'working';
      else if (ev.type === 'agents') for (const a of ev.agents) if (a.id === 'ceo' && 'status' in a) a.status = 'working';
      ws.send(JSON.stringify(ev));
    });
  });
}

/** The keyboard: the visual viewport loses `px` at the bottom, as on iOS (the layout viewport keeps its height). */
async function keyboard(page: Page, px: number) {
  await page.evaluate((px) => {
    Object.defineProperty(visualViewport!, 'height', { configurable: true, get: () => innerHeight - px });
    visualViewport!.dispatchEvent(new Event('resize'));
  }, px);
  await page.waitForTimeout(400); // the viewport's next frame, and the log following it
}

/** What's wrong with the composer stack now. */
function stackProblems(page: Page) {
  return page.evaluate(() => {
    const problems: string[] = [];
    const rect = (el: Element) => el.getBoundingClientRect();
    const visible = visualViewport!.height;
    const q = (s: string) => document.querySelector(s);
    const named = [
      ['the conversation', q('.chat-log-wrap')],
      ['the working strip', q('.working-strip')],
      ['the attachments', q('.attach-tray')],
      ['the message box', q('.chat-input')],
    ] as const;
    for (const [name, el] of named) if (!el) problems.push(`${name} is missing`);
    if (problems.length) return problems;
    // Top to bottom, each one under the one before it.
    for (let i = 1; i < named.length; i++) {
      const [above, a] = named[i - 1];
      const [below, b] = named[i];
      if (rect(b!).top < rect(a!).bottom - 0.5) problems.push(`${below} overlaps ${above} by ${Math.round(rect(a!).bottom - rect(b!).top)}px`);
    }
    for (const [name, el] of named) {
      const r = rect(el!);
      if (r.bottom > visible + 0.5) problems.push(`${name} ends at ${Math.round(r.bottom)}, under the keyboard (${Math.round(visible)})`);
      if (el!.scrollHeight > el!.clientHeight + 1 && el!.matches('.working-strip, .attach-tray')) problems.push(`${name} is cut off`);
    }
    const log = q('.chat-log')!;
    const newest = rect(log.lastElementChild!);
    if (newest.bottom > rect(log).bottom + 1 || newest.bottom < rect(log).top) problems.push('the newest message is out of view');
    if (rect(log).height < 60) problems.push(`the conversation is ${Math.round(rect(log).height)}px tall`);
    const tabs = q('.pk-tabs');
    if (tabs && rect(tabs).height > 0) problems.push('the tab bar takes room while typing');
    const box = q<HTMLTextAreaElement>('.chat-input textarea')!;
    const line = parseFloat(getComputedStyle(box).lineHeight);
    if (box.clientHeight > 5 * line + 16 + 1) problems.push(`the message box is ${Math.round(box.clientHeight / line)} lines tall`);
    if (box.scrollHeight <= box.clientHeight) problems.push("the draft fits the box: it isn't six lines");

    const stop = [...document.querySelectorAll('.working-strip button')].find((b) => /Stop/.test(b.textContent ?? ''));
    if (!stop) problems.push('no Stop in the working strip');
    // Every target fully on screen (the tray scrolls each × into view first), and at least 44px.
    const targets = [...(stop ? [['Stop', stop] as const] : []), ...[...document.querySelectorAll('.attach-item button')].map((b) => [b.getAttribute('aria-label') ?? '×', b] as const)];
    for (const [name, el] of targets) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = rect(el);
      if (r.width < 43.5 || r.height < 43.5) problems.push(`${name} is ${Math.round(r.width)}x${Math.round(r.height)}px`);
      if (r.left < -0.5 || r.right > innerWidth + 0.5 || r.top < -0.5 || r.bottom > visible + 0.5) problems.push(`${name} is cut off by the screen`);
      const chip = el.closest('.attach-item');
      if (chip && (r.top < rect(chip).top - 0.5 || r.bottom > rect(chip).bottom + 0.5 || r.right > rect(chip).right + 0.5)) problems.push(`${name} sticks out of its chip`);
    }
    for (const chip of document.querySelectorAll('.attach-item')) {
      for (const part of chip.children) {
        const r = rect(part);
        if (r.top < rect(chip).top - 0.5 || r.bottom > rect(chip).bottom + 0.5) problems.push(`"${part.textContent}" sticks out of its chip`);
      }
      const name = chip.querySelector('.attach-name')!;
      if (name.scrollWidth <= name.clientWidth) problems.push(`"${name.textContent}" isn't cut short with an ellipsis`);
    }
    if (document.documentElement.scrollWidth > innerWidth) problems.push('the page scrolls sideways');
    return problems;
  });
}

test.describe('the chat composer with the keyboard up', () => {
  test.use({ isMobile: true, hasTouch: true, userAgent: devices['iPhone 15'].userAgent });
  for (const size of [
    { width: 390, height: 844, keyboard: 336 },
    { width: 375, height: 667, keyboard: 291 },
  ]) {
    test(`at ${size.width}x${size.height}: strip, tray and box in one column, Stop and every × on screen`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await ceoWorking(page);
      await page.goto('/?pocket=1&tab=chat');
      await expect(page.locator('.working-strip')).toBeVisible();
      const files = [1965, 1964, 1963].map((n) => ({ name: `IMG_${n}-a-long-screenshot-name.png`, mimeType: 'image/png', buffer: PNG }));
      await page.locator('.chat-input input[type="file"]:not([capture])').setInputFiles(files);
      await expect(page.locator('.attach-item .small.muted')).toHaveCount(3); // uploaded: each shows its size
      const box = page.locator('.chat-input textarea');
      await box.fill(DRAFT);
      await box.focus();
      await keyboard(page, size.keyboard);
      expect(await stackProblems(page)).toEqual([]);

      // Scrolled up, "↓ Latest" floats between the header and the stack.
      await page.locator('.chat-log').evaluate((el) => el.scrollTo(0, 0));
      const jump = page.locator('.chat-jump');
      await expect(jump).toBeVisible();
      const [pill, head, strip] = await Promise.all([jump, page.locator('.chat-head'), page.locator('.working-strip')].map(async (l) => (await l.boundingBox())!));
      expect(pill.y, '↓ Latest under the header').toBeGreaterThanOrEqual(head.y + head.height - 0.5);
      expect(pill.y + pill.height, '↓ Latest above the working strip').toBeLessThanOrEqual(strip.y + 0.5);

      // The keyboard goes away: the tab bar is back.
      await box.blur();
      await keyboard(page, 0);
      await expect(page.locator('.pk-tabs')).toBeVisible();
    });
  }
});
