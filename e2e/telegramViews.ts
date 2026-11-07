import { type Locator } from '@playwright/test';
import { expect } from './helpers';

// layout.spec.ts's Settings → Notifications views of the demo's Telegram bot (#126).

type States = 'on' | 'off' | 'error';

/** The demo bot linked and Telegram on, off, or on but unreachable; `open` shows the Notifications section. */
export const telegramViews = (states: States[], open: (root: Locator) => Promise<void>) =>
  states.map((state) => ({
    name: `Notifications: Telegram ${state}`,
    go: async (root: Locator) => {
      const req = root.page().request;
      if (!(await (await req.get('/api/state')).json()).notifyChannels?.telegram?.linked) {
        await req.post('/api/notify/telegram/link');
        await req.post('/api/notify/telegram/demo', { data: { kind: 'start' } });
      }
      await req.patch('/api/settings', { data: { notify: { channels: { telegram: state !== 'off' } } } });
      if (state !== 'off') await req.post('/api/notify/telegram/demo', { data: { kind: state === 'error' ? 'outage' : 'online' } });
      await open(root);
      const shows = { on: root.getByRole('button', { name: 'Send test' }), off: root.getByRole('button', { name: 'Turn on', exact: true }), error: root.getByRole('button', { name: 'Retry now' }) }[state];
      await shows.scrollIntoViewIfNeeded();
      await expect(shows).toBeVisible();
    },
  }));
