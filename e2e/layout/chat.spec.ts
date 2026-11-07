import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../helpers';
import { checkScreens, MODES, PHONES, png, pocket, POCKET, type Screen } from './helpers';

// The chat with the CEO: its screens, the message box on an iPhone (#73), the decisions tray (#114) and ref chips (#100).

const SCREENS: Screen[] = [
  { name: 'pocket chat', widths: POCKET, open: (page) => pocket(page, 'chat'), tabs: [] },
  {
    // a CEO reply's action cards, idea card and artifact (#108)
    name: 'pocket chat cards',
    widths: POCKET,
    open: async (page) => {
      await page.request.post('/api/ceo/message', { data: { text: 'Plan the next milestone for floor 1' } });
      const root = await pocket(page, 'chat');
      await expect(root.locator('.idea-card')).toBeVisible({ timeout: 90_000 });
      await expect(root.locator('.action-card').first()).toBeVisible();
      return root;
    },
    tabs: [],
  },
  {
    // the questions waiting on the manager, in the tray above the message box, open and collapsed (#114)
    name: 'pocket chat decisions',
    widths: POCKET,
    open: async (page) => {
      const root = await pocket(page, 'chat');
      await expect(root.getByRole('region', { name: 'Waiting on you' })).toBeVisible();
      return root;
    },
    tabs: ['', { name: 'collapsed', go: (root) => root.getByRole('button', { name: /^Hide the/ }).click() }],
  },
  {
    // the phone's chat with every button it can have (its own 🔍, 📄, 📎 and hands-free), the header's name still whole (#109)
    name: 'pocket chat header',
    widths: [360, 390, 430],
    open: async (page) => {
      await page.request.post('/api/files', { headers: { 'Content-Type': 'image/png', 'X-File-Name': 'f.png' }, data: png(40, 40) });
      await page.request.post('/api/ceo/message', { data: { text: 'Plan the next milestone for floor 1' } });
      const root = await pocket(page, 'chat');
      await expect(root.getByRole('button', { name: /^Artifacts \(\d+\)$/ })).toBeVisible({ timeout: 90_000 });
      await expect(root.getByRole('button', { name: /^Files \(\d+\)$/ })).toBeVisible();
      await expect(root.getByRole('button', { name: /search/i })).toHaveCount(1); // the chat's own, not two 🔍 side by side
      return root;
    },
    tabs: [],
  },
];

checkScreens(SCREENS);

// ---------- pocket mode's viewport on an iPhone (#73) ----------
// The chat column: the message box sits on the tabs, the conversation fills the rest and shows the newest message, and
// the header is padded for the notch once, in Safari's home-screen app and in Chrome iOS's tab, keyboard or not.

let seeded = false;

/** 20 messages and a tall screenshot in the chat, once per run. */
async function seedChat(page: Page) {
  if (seeded) return;
  seeded = true;
  const file = await (await page.request.post('/api/files', { headers: { 'Content-Type': 'image/png', 'X-File-Name': 'tall.png' }, data: png(400, 1300) })).json();
  for (let i = 1; i <= 20; i++) await page.request.post('/api/ceo/message', { data: { text: `Message ${i}: how is the busiest floor doing?` } });
  await page.request.post('/api/ceo/message', { data: { text: 'This is what the chat looks like', files: [file.id] } });
  await page.request.post('/api/phone/read', { data: { at: Date.now() + 60_000 } }); // opens at the end, not at a "New messages" divider
}

/** What's wrong with the chat column right now. */
async function chatProblems(page: Page, when: string): Promise<string[]> {
  await page.waitForTimeout(400); // the viewport's next frame, and the log following it
  const out = await page.evaluate(() => {
    const box = (s: string) => document.querySelector(s)!.getBoundingClientRect();
    const input = box('.chat-input');
    const tabs = box('.pk-tabs');
    const log = box('.chat-log');
    const newest = document.querySelector('.chat-log')!.lastElementChild!.getBoundingClientRect();
    const probe = Object.assign(document.createElement('div'), { style: 'position:fixed;padding-top:env(safe-area-inset-top)' });
    document.body.append(probe);
    const safeTop = parseFloat(getComputedStyle(probe).paddingTop);
    probe.remove();
    const headPad = parseFloat(getComputedStyle(document.querySelector('.pk-head')!).paddingTop);
    const problems: string[] = [];
    if (Math.abs(input.bottom - tabs.top) > 1) problems.push(`${Math.round(tabs.top - input.bottom)}px between the message box and the tabs`);
    if (tabs.bottom > innerHeight + 1 || tabs.bottom < innerHeight - 1) problems.push(`the tabs end at ${Math.round(tabs.bottom)}, the screen at ${innerHeight}`);
    if (log.height <= innerHeight / 2) problems.push(`the conversation is ${Math.round(log.height)}px of ${innerHeight}`);
    if (newest.bottom > log.bottom + 1 || newest.bottom < log.top) problems.push('the newest message is out of view');
    if (Math.abs(headPad - Math.max(8, safeTop)) > 0.5) problems.push(`the header's top padding is ${headPad}px for a ${safeTop}px safe area`);
    if (visualViewport!.scale !== 1) problems.push(`zoomed to ${visualViewport!.scale}`);
    return problems;
  });
  return out.map((p) => `${when}: ${p}`);
}

const IPHONES = [
  { name: 'iPhone 15', width: 393, height: 852 },
  { name: 'iPhone 16 Pro', width: 402, height: 874 },
  { name: 'iPhone 16 Pro Max', width: 440, height: 956 },
];

for (const mode of MODES) {
  test.describe(`pocket chat on an iPhone, ${mode.name}`, () => {
    test.use({ isMobile: true, hasTouch: true, userAgent: mode.userAgent });
    for (const phone of IPHONES) {
      test(`${phone.name}: the message box sits on the tabs`, async ({ page }) => {
        await page.setViewportSize({ width: phone.width, height: phone.height });
        if (mode.standalone) await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
        await seedChat(page);
        await page.goto('/?pocket=1&tab=chat');
        await expect(page.locator('.chat-input')).toBeVisible();
        expect(await page.locator('meta[name="viewport"]').getAttribute('content')).toContain('maximum-scale=1');
        const problems = await chatProblems(page, 'opened');

        // The keyboard: the page shrinks while a field has focus, then grows back when it goes away.
        const box = page.locator('.chat-input textarea');
        await page.setViewportSize({ width: phone.width, height: Math.round(phone.height * 0.55) });
        await box.focus();
        problems.push(...(await chatProblems(page, 'keyboard open')).filter((p) => !p.includes('conversation is')));
        await box.blur();
        await page.setViewportSize({ width: phone.width, height: phone.height });
        problems.push(...(await chatProblems(page, 'keyboard closed')));

        await page.locator('.chat-input input[type="file"][capture]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png(40, 80) });
        problems.push(...(await chatProblems(page, 'a photo attached')).filter((p) => !p.includes('conversation is'))); // the tray takes its room
        await page.getByRole('button', { name: /^(Remove|Cancel the upload)/ }).first().click();
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
        problems.push(...(await chatProblems(page, 'back to the app')));
        expect(problems).toEqual([]);
      });
    }
  });
}

// The open decisions' tray (#114) sits above the message box, and steps aside to one pill while the manager types.
for (const width of [390, 1280]) {
  test(`the decisions tray never covers the message box at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const root = await pocket(page, 'chat');
    const tray = root.getByRole('region', { name: 'Waiting on you' });
    await expect(tray).toBeVisible();
    const above = async (what: Locator) => ((await what.boundingBox())!.y + (await what.boundingBox())!.height) <= (await root.locator('.chat-input').boundingBox())!.y + 1;
    expect(await above(tray)).toBe(true);
    await root.locator('.chat-input textarea').fill('About something else');
    await expect(tray).toBeHidden();
    const pill = root.getByRole('button', { name: /decisions? waiting$/ });
    await expect(pill).toBeVisible();
    expect(await above(pill)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

// Ref chips are boxes in the sentence: one line high (never taller than two lines of the text), nothing clipped or
// sticking out of the bubble, a box that doesn't fit moving to the next line whole.
for (const width of PHONES) {
  test(`chat chips sit in the sentence at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const state = await (await page.request.get('/api/state')).json();
    const [a, b] = (state.agents as { name: string; role: string }[]).filter((x) => x.role !== 'ceo');
    const text = `Could @${a.name} pair with @${b.name} on floor 1 today and tell me how it went? (#100)`;
    await page.request.post('/api/ceo/message', { data: { text } });
    await page.goto('/?pocket=1&tab=chat');
    const bubble = page.locator('.bubble-text', { hasText: '(#100)' }).last();
    await expect(bubble.locator('.ref-chip')).toHaveCount(3);
    const problems = await bubble.evaluate((el) => {
      const out: string[] = [];
      const line = parseFloat(getComputedStyle(el).lineHeight);
      const box = el.getBoundingClientRect();
      for (const chip of el.querySelectorAll<HTMLElement>('.ref-chip')) {
        const r = chip.getBoundingClientRect();
        const name = chip.innerText.trim();
        if (chip.getClientRects().length > 1) out.push(`"${name}" breaks across lines`);
        if (r.height > 2 * line) out.push(`"${name}" is ${Math.round(r.height)}px tall, over two ${line}px lines`);
        if (chip.scrollWidth > chip.clientWidth + 1) out.push(`"${name}" is clipped (${chip.scrollWidth} > ${chip.clientWidth}px)`);
        if (r.left < box.left - 1 || r.right > box.right + 1) out.push(`"${name}" sticks out of the bubble`);
        const status = chip.querySelector('.ref-chip-status')?.getBoundingClientRect();
        if (status && Math.abs(status.top + status.height / 2 - (r.top + r.height / 2)) > 1.5) out.push(`"${name}"'s status isn't centred`);
      }
      return out;
    });
    expect(problems).toEqual([]);
  });
}
