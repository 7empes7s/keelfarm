import { enterOffice, expect } from '../helpers';
import { AT_ELEVATOR, checkScreens, dialog, fromPhone, game, office, OFFICE, type Screen } from './helpers';

// Screens inside the 3D office: the start screen, HUD, phone, tour, notification centre and the panels it opens.

const SCREENS: Screen[] = [
  {
    name: '3D office tour (#121)',
    widths: OFFICE,
    open: async (page) => {
      await page.request.patch('/api/settings', { data: { tutorialStep: 0 } });
      await enterOffice(page);
      return page.getByRole('region', { name: 'Tour' });
    },
    tabs: [],
  },
  {
    name: 'notification centre',
    widths: OFFICE,
    open: async (page) => {
      await office(page);
      await page.locator('.hud-status .notice-bell').click(); // a real click: it fails while anything covers the bell
      await expect(page.locator('.notice-centre')).toBeVisible();
      return dialog(page, /Notifications/);
    },
    tabs: [],
  },
  {
    name: 'start screen',
    widths: OFFICE,
    open: async (page) => {
      await page.goto('/?pocket=0');
      const root = page.locator('.start');
      await expect(root.getByRole('button', { name: 'Enter the office' })).toBeEnabled();
      return root;
    },
    tabs: [],
  },
  {
    name: 'phone',
    widths: OFFICE,
    open: async (page) => {
      await office(page);
      await page.keyboard.press('p');
      return dialog(page, /Your phone/);
    },
    tabs: ['', 'Team', 'Company', 'Games', game('Cubetris'), game('Cable Snake'), game('Desk Pet')],
  },
  {
    name: 'HUD',
    widths: OFFICE,
    open: async (page) => {
      await office(page);
      return page.locator('.hud');
    },
    tabs: [],
  },
  { name: 'floor list', widths: OFFICE, open: (page) => fromPhone(page, /Floor list/, /Floor|Lobby/), tabs: [] },
  { name: 'help', widths: OFFICE, open: (page) => fromPhone(page, /Help/, /How the office works/), tabs: ['The office', 'Controls'] },
  { name: 'map room (#137)', widths: OFFICE, open: (page) => fromPhone(page, /Map room/, /Map room/), tabs: [] },
  {
    name: 'catalogue',
    widths: OFFICE,
    open: async (page) => {
      await office(page);
      await page.getByTitle(/^Coins:/).dispatchEvent('click'); // a real click waits for the pill to be "stable", which it never is here
      return dialog(page, /catalogue/i);
    },
    tabs: [],
  },
  {
    name: 'elevator',
    widths: OFFICE,
    open: async (page) => {
      await office(page, AT_ELEVATOR);
      await page.waitForTimeout(2000); // a few frames to aim at it on software WebGL
      await page.keyboard.press('e');
      return dialog(page, /Elevator/);
    },
    tabs: [],
  },
];

checkScreens(SCREENS);
