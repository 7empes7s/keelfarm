import type { RepoView } from '../shared/types';
import { expect, overflowProblems, test } from './helpers';

// Exercise the actual shared CardView from a chat reference, using demo GitHub and sessions.
for (const width of [390, 1280]) {
  test(`issue actions from a chat ref at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const state = await (await page.request.get('/api/state')).json();
    const repo = (state.repos as RepoView[]).find((r) => r.floor === 1)!;
    const path = `/api/repos/${encodeURIComponent(repo.id)}`;
    expect((await page.request.patch(path, { data: { autoAssign: false } })).ok()).toBe(true);
    const agentName = `Card${width}`;
    expect((await page.request.post(`${path}/agents`, { data: { name: agentName, cli: 'codex' } })).ok()).toBe(true);
    const create = async (title: string) => {
      const response = await page.request.post(`${path}/issues`, { data: { title, body: 'Objective: O1\n\nKeep issue actions within reach.' } });
      expect(response.ok()).toBe(true);
      return (await response.json()).number as number;
    };
    const assign = await create(`Issue action assignment ${width}`);
    const close = await create(`Issue action closure ${width}`);
    const marker = `issue actions ${width}`;
    expect((await page.request.post('/api/ceo/message', { data: { text: `On floor 1: #${assign} and #${close}. (${marker})` } })).ok()).toBe(true);
    await page.goto('/?pocket=1&tab=chat');
    const bubble = page.locator('.bubble-text', { hasText: `(${marker})` }).last();
    await bubble.locator('.ref-chip', { hasText: `#${assign}` }).click();
    const card = page.locator('.cardview');
    await card.getByRole('button', { name: `Assign issue #${assign}`, exact: true }).click();
    const sheet = page.getByRole('dialog', { name: `Assign #${assign}`, exact: true });
    await expect(sheet.getByRole('button', { name: 'Next free agent' })).toBeVisible();
    expect(await overflowProblems(sheet)).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`assign-${width}.png`) });
    await sheet.getByRole('button', { name: new RegExp(`${agentName}.*Starts it now`) }).click();
    await expect(card.getByRole('button', { name: `Open ${agentName}`, exact: true })).toBeVisible();
    expect(await overflowProblems(card)).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`issue-started-${width}.png`) });
    await card.getByRole('button', { name: `Open ${agentName}`, exact: true }).click();
    await expect(page.locator('.aw')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`agent-${width}.png`) });
    await page.keyboard.press('Escape');
    // Back to chat, then close another issue with a reason. No server-side mutation until confirmation.
    await page.goto('/?pocket=1&tab=chat');
    await bubble.locator('.ref-chip', { hasText: `#${close}` }).click();
    await card.getByRole('button', { name: `More for issue #${close}`, exact: true }).click();
    await page.getByRole('menuitem', { name: /Close as not planned/ }).click();
    const confirm = page.getByRole('alertdialog', { name: `Close #${close}?`, exact: true });
    await confirm.getByRole('textbox', { name: 'Reason for closing' }).fill('Superseded by the assignment task');
    expect(await overflowProblems(confirm)).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`close-${width}.png`) });
    const sent = page.waitForRequest((r) => r.url().endsWith(`/issues/${close}/close`) && r.method() === 'POST');
    await confirm.getByRole('button', { name: 'Close issue', exact: true }).click();
    expect((await sent).postDataJSON()).toEqual({ reason: 'Superseded by the assignment task' });
    await expect.poll(async () => {
      const current = await (await page.request.get('/api/state')).json();
      return (current.repos as RepoView[]).find((r) => r.id === repo.id)!.issues.some((i) => i.number === close);
    }).toBe(false);
    if (width === 1280) await expect(page.locator('.pk-dock')).toBeVisible();
  });
}
