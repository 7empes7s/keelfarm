import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test as base, expect } from '@playwright/test';
import { TOUR } from '../client/src/ui/tourSteps';

// TEMPORARY diagnostics for #651, never merged.
const dist = path.resolve('dist');
const assets = path.join(dist, 'assets');

function rewrite(from: (n: string) => string) {
  const names = fs.readdirSync(assets);
  const map = new Map(names.map((n) => [n, from(n)]));
  for (const [a, b] of map) if (a !== b) fs.renameSync(path.join(assets, a), path.join(assets, b));
  const files = [path.join(dist, 'index.html'), ...[...map.values()].filter((n) => /\.(js|css)$/.test(n)).map((n) => path.join(assets, n))];
  for (const f of files) {
    let t = fs.readFileSync(f, 'utf8');
    for (const [a, b] of map) if (a !== b) t = t.split(a).join(b);
    fs.writeFileSync(f, t);
  }
}
const update = () => rewrite((n) => n.replace(/^(.*?)(\.[a-z]+)$/, '$1u$2'));
const undo = () => rewrite((n) => n.replace(/u(\.[a-z]+)$/, '$1'));

async function diag(page: Page, label: string) {
  const d = await page.evaluate(() => {
    const ph = document.querySelector('.phone') as HTMLElement | null;
    const r = ph?.getBoundingClientRect();
    const cs = ph ? getComputedStyle(ph) : null;
    const at = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return {
      lock: document.pointerLockElement?.tagName ?? null,
      overlay: !!document.querySelector('.overlay'),
      phone: !!ph,
      rect: r ? [r.x, r.y, r.width, r.height].map(Math.round) : null,
      opacity: cs?.opacity,
      display: cs?.display,
      visibility: cs?.visibility,
      phoneText: ph?.innerText.slice(0, 120),
      centre: at ? `${at.tagName}.${(at as HTMLElement).className}` : null,
      tour: [...document.querySelectorAll('.tour, .tour-dim, .tour-ring, .tour-invite')].map((e) => e.className),
      sw: navigator.serviceWorker?.controller?.scriptURL ?? null,
    };
  });
  console.log(`DIAG ${label}: ${JSON.stringify(d)}`);
}

const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    page.on('console', (m) => console.log(`CONSOLE ${m.type()}: ${m.text().slice(0, 300)}`));
    page.on('pageerror', (e) => console.log(`PAGEERROR ${e.message}`));
    page.on('response', (r) => {
      const ct = r.headers()['content-type'] ?? '';
      if (r.status() >= 400 || (r.url().includes('/assets/') && !/javascript|css|image|font|octet/.test(ct))) console.log(`RESP ${r.status()} ${ct} ${r.url()}`);
    });
    await use(page);
  },
});

async function enter(page: Page) {
  const enterBtn = page.getByRole('button', { name: 'Enter the office' });
  const skip = page.getByRole('button', { name: /skip setup/i });
  await expect(enterBtn.or(skip)).toBeVisible();
  if (await skip.isVisible()) await skip.click();
  else {
    await expect(enterBtn).toBeEnabled();
    await enterBtn.click();
  }
  await expect(page.getByTitle('Your phone (P)')).toBeVisible();
}

async function probe(page: Page, label: string) {
  await page.waitForTimeout(1500);
  await diag(page, `${label} before`);
  await page.locator('canvas').first().click({ position: { x: 400, y: 200 } });
  await page.waitForTimeout(800);
  await diag(page, `${label} after canvas click`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(1500);
  await diag(page, `${label} after P`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.getByTitle('Your phone (P)').click();
  await page.waitForTimeout(1500);
  await diag(page, `${label} after phone button`);
  await page.screenshot({ path: `.lab/diag651-${label}.png` }).catch(() => undefined);
  await page.keyboard.press('Escape');
}

test('A: fresh profile, as the manager (no tour seen)', async ({ page }) => {
  test.setTimeout(110_000);
  await page.goto('/');
  await enter(page);
  await probe(page, 'A');
});

test('B: open tab across a self-update', async ({ page }) => {
  test.setTimeout(110_000);
  await page.addInitScript((ids) => localStorage.getItem('cubefarm:tour-seen') === null && localStorage.setItem('cubefarm:tour-seen', ids), JSON.stringify(TOUR.map((e) => e.id)));
  await page.goto('/');
  await enter(page);
  await page.waitForTimeout(3000);
  update();
  try {
    await page.request.post('/api/demo/new-commit');
    await page.waitForTimeout(3000);
    await probe(page, 'B');
    await page.reload();
    await page.waitForTimeout(3000);
    await diag(page, 'B after reload');
  } finally {
    undo();
  }
});
