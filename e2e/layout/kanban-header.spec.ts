import { expect, overflowProblems, test } from '../helpers';
import { office, ON_FLOOR_1, pocket } from './helpers';

// Header hierarchy and command wiring (#299), including the space left beside the CEO chat.
for (const [width, chat] of [[390, false], [1280, false], [1280, true]] as const) {
  test(`Kanban header groups its controls at ${width}px${chat ? ', chat open' : ''}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const root = await pocket(page, 'kanban');
    const dock = root.locator('.pk-dock');
    if (chat && !(await dock.isVisible())) await root.locator('.pk-chat-btn').click();
    if (!chat && (await dock.isVisible())) await dock.getByRole('button', { name: 'Hide the chat' }).click();
    const header = root.locator('.kanban-embedded');
    const sync = header.getByRole('button', { name: 'Sync repository', exact: true });
    await expect(sync).toContainText(/Synced \d{2}:\d{2}$/);
    await expect(header.getByRole('link', { name: 'View repository on GitHub' })).toHaveAttribute('href', /github.com/);
    await expect(root.getByRole('tablist', { name: 'Floor', exact: true })).toBeVisible();
    const layout = await header.evaluate((el) => {
      const out: string[] = [];
      const heading = el.querySelector('.kanban-heading')!.getBoundingClientRect();
      const actions = el.querySelector('.kanban-actions')!.getBoundingClientRect();
      const settings = el.querySelector('.kanban-settings')!.getBoundingClientRect();
      const tabs = el.parentElement!.querySelector('[role="tablist"]')!.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      for (const node of el.querySelectorAll<HTMLElement>('.kanban-heading *, .kanban-toolbar *')) {
        const r = node.getBoundingClientRect();
        if (r.width && (r.left < rect.left - 1 || r.right > rect.right + 1 || r.right > vw + 1)) out.push(`${node.className} is outside the header`);
      }
      for (const label of el.querySelectorAll('.kanban-setting')) {
        const icon = label.querySelector('svg')!.getBoundingClientRect();
        const text = label.querySelector('.kanban-setting-label > span')!.getBoundingClientRect();
        const r = label.getBoundingClientRect();
        if (text.left - icon.right < 0 || text.left - icon.right > 16 || Math.abs(icon.top + icon.height / 2 - text.top - text.height / 2) > 2) out.push('setting icon is detached from its label');
        if (r.height < 44) out.push('setting target is too small');
      }
      for (const node of el.querySelectorAll('.kanban-heading button, .kanban-heading a, .kanban-actions button')) {
        const r = node.getBoundingClientRect();
        if (r.width < 44 || r.height < 44) out.push('action target is too small');
      }
      const rows: number[] = [];
      for (const top of [tabs.top, heading.top, actions.top, settings.top]) if (!rows.some((n) => Math.abs(n - top) <= 8)) rows.push(top);
      return { out, rows: rows.length, actionsTop: actions.top, settingsTop: settings.top };
    });
    expect(layout.out).toEqual([]);
    if (width === 1280) expect(layout.rows, 'tabs, title and actions/settings use at most three rows').toBeLessThanOrEqual(3);
    else expect(layout.settingsTop).toBeGreaterThan(layout.actionsTop);
    expect(await overflowProblems(header.locator('.kanban-heading'))).toEqual([]);
    expect(await overflowProblems(header.locator('.kanban-toolbar'))).toEqual([]);

    const syncRequest = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/repos\/[^/]+\/sync$/.test(r.url()));
    await sync.click();
    expect((await syncRequest).ok()).toBe(true);
    await expect(sync).toBeEnabled();
    for (const [name, key] of [['Auto-assign', 'autoAssign'], ['Auto-merge', 'autoMerge']] as const) {
      const toggle = header.getByRole('switch', { name, exact: true });
      const before = await toggle.isChecked();
      for (const checked of [!before, before]) {
        const update = page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/api\/repos\/[^/]+$/.test(r.url()));
        await toggle.click();
        const response = await update;
        expect(response.ok()).toBe(true);
        expect(response.request().postDataJSON()).toEqual({ [key]: checked });
        await expect(toggle).toBeChecked({ checked }); // real demo repo event updates the UI
      }
    }
    await header.getByRole('button', { name: '+ New issue', exact: true }).click();
    await expect(header.getByRole('textbox', { name: 'Issue title', exact: true })).toBeVisible();
    await header.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(header.getByRole('textbox', { name: 'Issue title', exact: true })).toHaveCount(0);
    const screenshot = testInfo.outputPath('kanban-header.png');
    await page.screenshot({ path: screenshot });
    await testInfo.attach('Kanban header', { path: screenshot, contentType: 'image/png' });
    await header.getByRole('button', { name: 'View app', exact: true }).click();
    await expect(page.locator('.app-body')).toBeVisible();
  });
}

for (const width of [390, 1280]) {
  test(`3D Kanban header fits its panel at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await office(page, ON_FLOOR_1);
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search everything' }).fill('pixel-todo');
    await page.getByRole('option', { name: /^Floor 1/ }).click();
    const panel = page.getByRole('dialog', { name: /GitHub/ });
    await expect(panel.getByRole('button', { name: 'Sync repository', exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'What can I do on Kanban?' })).toBeVisible();
    await expect.poll(() => overflowProblems(panel.locator('.panel-head'))).toEqual([]);
    expect(await overflowProblems(panel.locator('.kanban-toolbar'))).toEqual([]);
  });
}

test('sync chip shows errors and stays busy until the sync completes', async ({ page }) => {
  let recover!: () => void;
  await page.routeWebSocket(/\/ws$/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((data) => {
      if (typeof data !== 'string') return ws.send(data);
      const event = JSON.parse(data);
      if (event.type === 'snapshot') {
        for (const repo of event.data.repos) repo.syncError = 'GitHub is unavailable. Try syncing again.';
        // The error is injected only in this client; model the server clearing it through a repo event too.
        recover = () => ws.send(JSON.stringify({ type: 'repos', repos: event.data.repos.map((repo: { id: string }) => ({ id: repo.id, syncError: '', lastSync: Date.now() })) }));
      }
      ws.send(JSON.stringify(event));
    });
  });
  const root = await pocket(page, 'kanban');
  const header = root.locator('.kanban-embedded');
  const sync = header.getByRole('button', { name: 'Sync repository', exact: true });
  await expect(sync).toContainText('Sync failed');
  await expect(sync).toHaveAttribute('title', 'GitHub is unavailable. Try syncing again.');
  await expect(header.locator('.term-error')).toContainText('GitHub is unavailable. Try syncing again.');
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/api\/repos\/[^/]+\/sync$/, async (route) => {
    await held;
    await route.continue();
  });
  try {
    await sync.click();
    await expect(sync).toBeDisabled();
    await expect(sync).toHaveAttribute('aria-busy', 'true');
    await expect(sync).toContainText('Syncing…');
    expect(await sync.locator('svg').evaluate((el) => getComputedStyle(el).animationName)).toBe('kanban-sync-spin');
  } finally {
    release();
  }
  await expect(sync).toBeEnabled();
  recover();
  await expect(sync).toContainText(/Synced \d{2}:\d{2}$/);
  await expect(header.locator('.term-error')).toHaveCount(0);
});

test('Kanban switch icons stay directly beside their label text', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await pocket(page, 'kanban');
  const labels = page.locator('.kanban-toolbar label');
  await expect(labels).toHaveCount(2);
  const gaps = await labels.evaluateAll((els) => els.map((label) => {
    const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
    let text: Node | null;
    while ((text = walker.nextNode())) {
      if (!text.textContent?.includes('Auto-')) continue;
      const range = document.createRange();
      range.selectNodeContents(text);
      const box = range.getBoundingClientRect();
      const icon = label.querySelector('svg')!.getBoundingClientRect();
      return { gap: box.left - icon.right, vertical: Math.abs(box.top + box.height / 2 - icon.top - icon.height / 2) };
    }
    throw new Error('the setting has no label text');
  }));
  for (const { gap, vertical } of gaps) {
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(16);
    expect(vertical).toBeLessThanOrEqual(4);
  }
});
