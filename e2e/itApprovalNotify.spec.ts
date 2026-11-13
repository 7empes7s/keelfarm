import { expect, overflowProblems, test } from './helpers';
import { office, pocket } from './layout/helpers';

for (const mode of ['pocket', 'office'] as const) {
  test(`IT push opens its exact approval and settled state in ${mode}`, async ({ page, context }) => {
    await page.setViewportSize({ width: mode === 'pocket' ? 390 : 1280, height: 844 });
    if (mode === 'pocket') await pocket(page, 'chat');
    else await office(page);
    await page.request.post('/api/ceo/message', { data: { text: 'Check the machine and tell me where to gain space' } });
    await expect.poll(async () => (await (await page.request.get('/api/state')).json()).itDesk?.waiting.length ?? 0).toBe(2);
    const state = await (await page.request.get('/api/state')).json();
    const card = state.itDesk.waiting.find((c: { argv: string[] }) => c.argv[0] === 'journalctl');
    const notice = state.notices.find((n: { id: string }) => n.id === card.id);
    expect(notice.text).toContain('clear old system logs');
    expect(notice.text).not.toContain('500M');
    const url = `/?tab=approvals&note=${card.id}`;
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    const worker = context.serviceWorkers()[0];
    expect(worker).toBeTruthy();
    // Run the real worker handlers with a mocked push presentation API; no external push service or OS prompt.
    const shown = await worker.evaluate(async (payload) => {
      const scope = globalThis as unknown as {
        clients: { matchAll: () => Promise<unknown[]> };
        registration: { showNotification: (title: string, options: { body: string; data: { url: string } }) => Promise<void> };
      };
      const match = scope.clients.matchAll;
      const show = scope.registration.showNotification;
      let captured: { title: string; options: { body: string; data: { url: string } } } | undefined;
      scope.clients.matchAll = async () => []; // device is away when the push arrives
      scope.registration.showNotification = async (title, options) => { captured = { title, options }; };
      let done: Promise<unknown> | undefined;
      try {
        const event = new Event('push');
        Object.assign(event, { data: { json: () => payload }, waitUntil: (p: Promise<unknown>) => { done = p; } });
        dispatchEvent(event);
        await done;
        return captured;
      } finally {
        scope.clients.matchAll = match;
        scope.registration.showNotification = show;
      }
    }, { title: 'IT approval needed', body: notice.text, tag: 'cubefarm-needsHuman', url });
    expect(shown?.options.data.url).toBe(url);
    await worker.evaluate(async (url) => {
      // Synthetic clicks have no OS activation. Mock only focus; keep the real client message handoff.
      type Client = { url: string; postMessage: (m: unknown) => void };
      const clients = (globalThis as unknown as { clients: { matchAll: (options: unknown) => Promise<Client[]> } }).clients;
      const match = clients.matchAll;
      clients.matchAll = async (options) => (await match.call(clients, options)).map((c) => ({ url: c.url, postMessage: (m: unknown) => c.postMessage(m), focus: async () => undefined }));
      let done: Promise<unknown> | undefined;
      const event = new Event('notificationclick');
      Object.assign(event, { notification: { data: { url }, close: () => undefined }, waitUntil: (p: Promise<unknown>) => { done = p; } });
      try {
        dispatchEvent(event);
        await done;
      } finally { clients.matchAll = match; }
    }, url);
    const sheet = page.getByRole('dialog', { name: 'IT approval', exact: true });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('.it-card')).toHaveCount(1);
    await expect(sheet).toContainText('journalctl --vacuum-size=500M');
    await expect(sheet).not.toContainText('docker image prune');
    expect(await overflowProblems(sheet)).toEqual([]);
    const run = sheet.getByRole('button', { name: 'Run', exact: true });
    const box = await run.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: test.info().outputPath(`it-approval-pending-${mode}.png`) });
    await page.goto(`/?pocket=${mode === 'pocket' ? '1' : '0'}&tab=approvals&note=${card.id}`);
    await expect(sheet).toContainText('journalctl --vacuum-size=500M');
    // Dismiss the demo card: no command is run, even in the demo.
    await sheet.getByRole('button', { name: 'Not now', exact: true }).click();
    await expect(sheet).toContainText('already handled or withdrawn');
    await sheet.getByRole('button', { name: 'Close', exact: true }).click();
    // A cold link still opens a clear settled state; the second card remains pending.
    await page.goto(`/${mode === 'pocket' ? '?pocket=1&' : '?pocket=0&'}tab=approvals&note=${card.id}`);
    if (mode === 'office') {
      const enter = page.getByRole('button', { name: 'Enter the office' });
      if (await enter.isVisible()) await enter.click();
    }
    await expect(sheet).toContainText('already handled or withdrawn');
    expect((await (await page.request.get('/api/state')).json()).itDesk.waiting).toHaveLength(1);
    await page.screenshot({ path: test.info().outputPath(`it-approval-settled-${mode}.png`) });
    await page.goBack();
    await expect(sheet).toHaveCount(0);
    await page.request.post('/api/it/dismiss', { data: { ids: state.itDesk.waiting.map((c: { id: string }) => c.id) } });
  });
}
