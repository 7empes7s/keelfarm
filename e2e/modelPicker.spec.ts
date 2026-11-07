import type { Locator, Page } from '@playwright/test';
import { MANAGER_DESK } from '../client/src/world/layout';
import { enterOffice, expect, startAt, test } from './helpers';

// The Team rows' pickers (#198): each agent's coding agent, model and effort are labelled and never cut off (a select's
// picked text fits it, 44px targets), and a model is picked from the catalog: the phone's sheet, the computer's select.

const dialog = (page: Page, name: RegExp) => page.getByRole('dialog', { name });

/** Settings → Team: pocket mode's on a phone, the 3D office's console (from the manager's desk) on a computer. */
async function team(page: Page, width: number): Promise<Locator> {
  if (width < 900) {
    await page.goto('/?pocket=1');
    await page.getByRole('button', { name: 'Settings and notifications' }).click();
    const root = dialog(page, /Settings/);
    await root.getByRole('button', { name: /^Team/ }).click();
    return root;
  }
  await startAt(page, { floor: 0, x: MANAGER_DESK.x, z: MANAGER_DESK.z + MANAGER_DESK.d / 2 + 0.8, yaw: 0, pitch: -0.6 });
  await page.goto('/?pocket=0');
  await enterOffice(page, { loaded: true });
  const skipTour = page.getByRole('button', { name: 'Skip tour' });
  if (await skipTour.isVisible()) await skipTour.dispatchEvent('click');
  await page.keyboard.press('e');
  const root = dialog(page, /Manager's console/);
  await root.locator('.cn-groups').getByRole('tab', { name: /Work/ }).click();
  await root.locator('.cn-sections').getByRole('tab', { name: /^Team/ }).click();
  return root;
}

for (const width of [390, 1280]) {
  test(`Team rows' pickers are whole at ${width}px, and a model is picked from the list`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const root = await team(page, width);
    const rows = root.locator('.roster-setup');
    await expect(rows.first()).toBeVisible();
    const cut = await root.evaluate((el) => {
      const out: string[] = [];
      const ctx = document.createElement('canvas').getContext('2d')!;
      for (const f of el.querySelectorAll<HTMLElement>('.roster-setup .field')) {
        const name = f.querySelector('span')?.textContent?.trim() ?? '';
        if (!name) out.push('a picker without a label');
        for (const s of f.querySelectorAll('select')) {
          ctx.font = getComputedStyle(s).font;
          const text = s.selectedOptions[0]?.text ?? '';
          if (ctx.measureText(text).width + 28 > s.clientWidth) out.push(`${name}: "${text}" is cut off (${s.clientWidth}px)`);
        }
        for (const b of f.querySelectorAll<HTMLElement>('button')) if (b.scrollWidth > b.clientWidth + 1) out.push(`${name}: "${b.innerText.trim()}" is cut off`);
        if (f.getBoundingClientRect().height && f.querySelector<HTMLElement>('select, button')!.getBoundingClientRect().height < 43.5) out.push(`${name}'s target is under 44px`);
      }
      return out;
    });
    expect(cut).toEqual([]);
    const model = rows.first().getByLabel('Model', { exact: true });
    if (width < 900) {
      await model.click();
      const sheet = page.getByRole('dialog', { name: 'Model' });
      await sheet.getByText('Sonnet 5', { exact: true }).click();
      await expect(sheet).toBeHidden();
      await expect(model).toHaveText(/Sonnet 5/);
    } else {
      await model.selectOption('claude-sonnet-5');
      await expect(model).toHaveValue('claude-sonnet-5');
    }
    await expect(root.locator('.roster-line').first()).toContainText('Sonnet 5');
  });
}
