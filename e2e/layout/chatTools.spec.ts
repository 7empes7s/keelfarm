import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../helpers';
import { pocket } from './helpers';

// A chat bubble's Reply, React and ⋯ (#289): one vertical stack of 44px buttons on the bubble's outer side, on top of
// everything (nothing covers them, the bubble included), docked and full screen, on a CEO bubble and one of mine;
// and they still work by mouse, keyboard and touch.

/** The chat at `width`, docked or full screen; its log. */
async function chat(page: Page, width: number, full: boolean) {
  await page.setViewportSize({ width, height: 844 });
  const root = await pocket(page, 'chat');
  if (width >= 1024 && !(await root.locator('.pk-dock').isVisible())) await root.locator('.pk-chat-btn').click();
  if (full) {
    await root.getByRole('button', { name: 'Full screen', exact: true }).click();
    await expect(root).toHaveClass(/pk-chat-full/);
  }
  // notices pop up over everything, the chat included: out of the way of the hit tests
  await page.addStyleTag({ content: '.toasts { visibility: hidden !important; }' });
  const log = page.locator('.chat-log');
  await expect(log.locator('.bubble-row-me[data-msg]').first()).toBeVisible();
  return log;
}

const ceoRow = (log: Locator) => log.locator('.bubble-row[data-msg]:not(.bubble-row-me)');
const myRow = (log: Locator) => log.locator('.bubble-row-me[data-msg]');
/** `row` by its message: the demo CEO keeps writing, so `nth(-2)` would move to another row mid-test. */
const pin = async (log: Locator, row: Locator) => log.locator(`.bubble-row[data-msg="${await row.getAttribute('data-msg')}"]`);

/** What's wrong with `row`'s stack while the pointer is on its bubble. */
async function stackProblems(row: Locator): Promise<string[]> {
  await row.evaluate((el) => el.scrollIntoView({ block: 'start' })); // a tall bubble's top in view (or the log's end)
  await row.locator('.bubble').hover({ position: { x: 8, y: 8 } });
  await expect(row.locator('.bubble-tools')).toHaveCSS('opacity', '1');
  return row.evaluate((el) => {
    const out: string[] = [];
    const mine = el.classList.contains('bubble-row-me');
    const bubble = el.querySelector('.bubble')!.getBoundingClientRect();
    const log = el.closest('.chat-log')!.getBoundingClientRect();
    const buttons = [...el.querySelectorAll<HTMLElement>('.bubble-tool')];
    if (buttons.length !== (mine ? 2 : 3)) out.push(`${buttons.length} buttons`);
    const boxes = buttons.map((b) => b.getBoundingClientRect());
    boxes.forEach((r, i) => {
      const name = buttons[i].getAttribute('aria-label');
      if (buttons[i].hasAttribute('title')) out.push(`${name} has a native tooltip`);
      const glyph = buttons[i].querySelector('svg')!.getBoundingClientRect();
      if (glyph.width < r.width * 0.5 || glyph.width > r.width * 0.6) out.push(`${name}'s glyph isn't about 55% of its button`);
      if (r.width < 44 || r.height < 44) out.push(`${name} is ${Math.round(r.width)}x${Math.round(r.height)}`);
      if (i && (Math.abs(r.left - boxes[0].left) > 0.5 || r.top < boxes[i - 1].bottom)) out.push(`${name} isn't under the one before`);
      if (mine ? r.right > bubble.left + 0.5 : r.left < bubble.right - 0.5) out.push(`${name} isn't on the bubble's outer side`);
      if (r.left < log.left - 0.5 || r.right > log.right - (log.width - el.closest('.chat-log')!.clientWidth) + 0.5 || r.top < log.top - 0.5 || r.bottom > log.bottom + 0.5) out.push(`${name} is cut off by the log (${Math.round(r.left)},${Math.round(r.top)}-${Math.round(r.bottom)} in ${Math.round(log.left)},${Math.round(log.top)}-${Math.round(log.bottom)})`);
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !buttons[i].contains(hit)) out.push(`${name}'s centre hits ${hit ? `.${[...hit.classList].join('.') || hit.tagName}` : 'nothing'}`);
    });
    if (document.documentElement.scrollWidth > innerWidth) out.push('the page scrolls sideways');
    return out;
  });
}

for (const width of [390, 1280])
  for (const full of [false, true])
    test(`bubble tools are one stack of 44px buttons, on top, at ${width}px ${full ? 'full screen' : 'docked'}`, async ({ page }, testInfo) => {
      const log = await chat(page, width, full);
      const problems: string[] = [];
      // Both log edges, on both alignments.
      for (const [who, rows] of [['CEO', ceoRow(log)], ['mine', myRow(log)]] as const) {
        for (const [which, at] of [['newest', rows.last()], ['older', rows.nth(-3)]] as const) {
          const row = await pin(log, at);
          problems.push(...(await stackProblems(row)).map((p) => `${who}, ${which}: ${p}`));
          await testInfo.attach(`${who}-${which}`, { body: await page.screenshot(), contentType: 'image/png' });
          if (width === 390) {
            const actual = (await row.locator('.bubble').boundingBox())!.width;
            // Compare with the previous horizontal 26px controls: the new targets must not steal text width.
            const old = await page.addStyleTag({ content: '.bubble-tools { flex-direction: row; gap: 2px; } .bubble-tool { width: 26px; min-width: 26px; height: 26px; min-height: 26px; }' });
            const before = (await row.locator('.bubble').boundingBox())!.width;
            await old.evaluate((el) => (el as HTMLStyleElement).remove());
            expect(actual, `${who}, ${which}: bubble width`).toBeGreaterThanOrEqual(before);
          }
        }
      }
      expect(problems).toEqual([]);
    });

for (const input of ['mouse', 'keyboard', 'touch'] as const) {
  test.describe(input, () => {
    test.use({ hasTouch: input === 'touch', isMobile: input === 'touch' });
    test('Reply, React and More keep their actions for both bubble alignments', async ({ page }) => {
      const log = await chat(page, input === 'touch' ? 390 : 1280, false);
      const menu = page.locator('.chat-menu');
      for (const rows of [ceoRow(log), myRow(log)]) {
        const row = await pin(log, rows.nth(-2));
        const names = await row.locator('.bubble-tool').evaluateAll((buttons) => buttons.map((b) => b.getAttribute('aria-label')!));
        for (const name of names) {
          const trigger = row.getByRole('button', { name, exact: true });
          if (input === 'mouse') {
            await row.locator('.bubble').hover();
            await trigger.click();
          } else {
            // Touch keeps hold/swipe as its usual entry; focus must still reveal usable controls.
            await trigger.focus();
            await expect(row.locator('.bubble-tools')).toHaveCSS('opacity', '1');
            if (input === 'touch') await trigger.tap();
            else await page.keyboard.press('Enter');
          }
          if (name === 'Reply to this message') {
            await expect(page.locator('.chat-reply')).toBeVisible();
            await page.getByRole('button', { name: 'Cancel the reply', exact: true }).click();
          } else {
            await expect(menu).toBeVisible();
            // Waiting-on-you can leave a short log on phones: the menu must fit its own area,
            // with every action reachable by scrolling inside it rather than behind the header.
            expect(await menu.evaluate((el) => {
              const box = el.getBoundingClientRect();
              const area = el.parentElement!.getBoundingClientRect();
              return box.top >= area.top && box.bottom <= area.bottom;
            })).toBe(true);
            if (name === 'React to this message') {
              const id = await row.getAttribute('data-msg');
              const sent = page.waitForResponse((r) => r.url().endsWith(`/api/ceo/messages/${id}/react`) && r.request().method() === 'POST');
              await menu.getByRole('button', { name: /^(React|Remove) 👍$/ }).click();
              expect((await sent).ok()).toBe(true);
            } else {
              await menu.getByRole('button', { name: 'Reply', exact: true }).click();
              await expect(page.locator('.chat-reply')).toBeVisible();
              await page.getByRole('button', { name: 'Cancel the reply', exact: true }).click();
            }
            await expect(menu).toBeHidden();
          }
        }
      }
    });
  });
}

test.describe('touch gestures', () => {
  test.use({ isMobile: true, hasTouch: true });
  test('holding a bubble still opens its actions without native tooltips', async ({ page }) => {
    const log = await chat(page, 390, false);
    const row = myRow(log).last();
    expect((await row.locator('.bubble-tools').boundingBox())!.width).toBeLessThan(2);
    const at = (await row.locator('.bubble').boundingBox())!;
    const point = { pointerType: 'touch', isPrimary: true, clientX: at.x + 10, clientY: at.y + 10 };
    await row.locator('.bubble').dispatchEvent('pointerdown', point);
    await expect(page.locator('.chat-menu')).toBeVisible();
    await row.locator('.bubble').dispatchEvent('pointerup', point);
    await page.keyboard.press('Escape');
    await expect(page.locator('.chat-menu')).toBeHidden();
  });
});

// A short log (#289): Waiting on you open and a reply in progress leave a strip of log on a 390px phone, with ↓ Latest
// showing. Whatever row is focused, near either edge, every button's centre must reach the button, Latest never on top.
test.describe('short log', () => {
  test.use({ isMobile: true, hasTouch: true });
  test('nothing covers a bubble stack in a short phone log', async ({ page }, testInfo) => {
    const log = await chat(page, 390, false);
    await expect(page.getByRole('region', { name: 'Waiting on you' })).toBeVisible();
    await (await pin(log, myRow(log).last())).getByRole('button', { name: 'Reply to this message', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.chat-reply')).toBeVisible();
    for (const [who, rows] of [['CEO', ceoRow(log)], ['mine', myRow(log)]] as const)
      for (const block of ['end', 'start'] as const) {
        const row = await pin(log, rows.nth(-3));
        await row.evaluate((el, block) => el.scrollIntoView({ block }), block);
        await expect(page.locator('.chat-jump')).toBeVisible();
        const names = await row.locator('.bubble-tool').evaluateAll((buttons) => buttons.map((b) => b.getAttribute('aria-label')!));
        for (const name of names) {
          const trigger = row.getByRole('button', { name, exact: true });
          await trigger.focus();
          await trigger.scrollIntoViewIfNeeded(); // the demo CEO keeps writing, and a log at its end follows
          await expect(row.locator('.bubble-tools')).toHaveCSS('opacity', '1');
          await expect.poll(() => row.evaluate((el) => {
            const out: string[] = [];
            const log = el.closest('.chat-log')!.getBoundingClientRect();
            for (const b of el.querySelectorAll<HTMLElement>('.bubble-tool')) {
              const r = b.getBoundingClientRect();
              const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              if (!at || !b.contains(at)) out.push(`${b.getAttribute('aria-label')}'s centre hits ${at ? `.${[...at.classList].join('.') || at.tagName}` : 'nothing'} (${Math.round(r.top)}-${Math.round(r.bottom)} in log ${Math.round(log.top)}-${Math.round(log.bottom)})`);
            }
            return out;
          }), { message: `${who}, ${block}, ${name} focused`, timeout: 5000 }).toEqual([]);
        }
        await testInfo.attach(`${who}-${block}`, { body: await page.screenshot(), contentType: 'image/png' });
      }
    // and a real tap there opens the actions, not Latest or the reply bar's neighbour
    const more = (await pin(log, ceoRow(log).nth(-3))).getByRole('button', { name: 'Message actions', exact: true });
    await more.focus();
    await more.tap();
    await expect(page.locator('.chat-menu')).toBeVisible();
  });
});
