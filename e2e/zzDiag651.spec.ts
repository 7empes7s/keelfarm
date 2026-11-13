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
      ov: (() => { const o = document.querySelector('.overlay'); if (!o) return null; const q = o.getBoundingClientRect(); const c = getComputedStyle(o); return [q.x, q.width, c.display, c.gridTemplateColumns, c.placeItems, c.padding]; })(),
      wide: ph ? [...ph.querySelectorAll('*')].map((e) => [e.tagName + '.' + (e as HTMLElement).className, Math.round(e.getBoundingClientRect().width), Math.round((e as HTMLElement).scrollWidth)] as const).sort((a, b) => b[2] - a[2]).slice(0, 5) : null,
      docW: document.documentElement.scrollWidth,
      vw: innerWidth,
      locks: (window as unknown as { __locks?: string[] }).__locks,
      sheets: [...document.styleSheets].length,
      anim: ph ? ph.getAnimations().map((x) => [(x as CSSAnimation).animationName, x.playState, Math.round(Number(x.currentTime))]) : null,
      node: ph ? ((window as unknown as { __ph?: Element }).__ph === ph ? 'same' : (((window as unknown as { __ph?: Element }).__ph = ph), 'new')) : null,
    };
  });
  console.log(`DIAG ${label}: ${JSON.stringify(d)}`);
}

const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __locks: string[] };
      w.__locks = [];
      const orig = Element.prototype.requestPointerLock;
      Element.prototype.requestPointerLock = function (this: Element, ...a: unknown[]) {
        w.__locks.push(Math.round(performance.now()) + ' call ' + this.tagName + ' ' + JSON.stringify(a));
        if (localStorage.getItem('diag-plain') === '1') a = [];
        try {
          const p = (orig as (...x: unknown[]) => Promise<void> | undefined).apply(this, a);
          p?.then?.(() => w.__locks.push('ok'), (e: Error) => w.__locks.push('rej ' + e.name + ' ' + e.message));
          return p as Promise<void>;
        } catch (e) {
          w.__locks.push('throw ' + String(e));
          throw e;
        }
      } as typeof orig;
      document.addEventListener('pointerlockchange', () => w.__locks.push(Math.round(performance.now()) + ' change ' + (document.pointerLockElement?.tagName ?? 'none') + ' focus=' + document.hasFocus() + ' vis=' + document.visibilityState));
      const ex = Document.prototype.exitPointerLock;
      Document.prototype.exitPointerLock = function (this: Document) {
        w.__locks.push(Math.round(performance.now()) + ' EXIT ' + (new Error().stack ?? '').split('\n').slice(1, 7).map((l) => l.trim().replace(/https?:\/\/[^/]+\/assets\//, '')).join(' | '));
        return ex.call(this);
      };
      document.addEventListener('pointerlockerror', () => w.__locks.push('lockerror'));
    });
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
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
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

test('A: control, no update', async ({ page }) => {
  test.setTimeout(110_000);
  await page.addInitScript((ids) => localStorage.getItem('cubefarm:tour-seen') === null && localStorage.setItem('cubefarm:tour-seen', ids), JSON.stringify(TOUR.map((e) => e.id)));
  await page.request.patch('/api/settings', { data: { tutorialStep: -1, setupDone: true } });
  await page.goto('/');
  await enter(page);
  await page.waitForTimeout(3000);
  await page.keyboard.press('Escape');
  await probe(page, 'A');
});

test.skip('C: control, plain pointer lock', async ({ page }) => {
  test.setTimeout(110_000);
  await page.addInitScript(() => localStorage.setItem('diag-plain', '1'));
  await page.request.patch('/api/settings', { data: { tutorialStep: -1, setupDone: true } });
  await page.goto('/');
  await enter(page);
  await page.waitForTimeout(3000);
  await page.keyboard.press('Escape');
  await probe(page, 'C');
  await page.keyboard.press('KeyP');
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(400);
    await diag(page, `C phone t${i}`);
  }
});

test.skip('B: open tab across a self-update', async ({ page }) => {
  test.setTimeout(110_000);
  await page.addInitScript((ids) => localStorage.getItem('cubefarm:tour-seen') === null && localStorage.setItem('cubefarm:tour-seen', ids), JSON.stringify(TOUR.map((e) => e.id)));
  await page.request.patch('/api/settings', { data: { tutorialStep: -1, setupDone: true } });
  await page.goto('/');
  await enter(page);
  await page.waitForTimeout(3000);
  await page.keyboard.press('Escape');
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
