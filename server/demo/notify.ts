// The demo's notifications (#257): every chat app set up, nothing sent, and a fake Telegram.
import { demoTelegram } from '../demoTelegram.ts';
import type { NotifyTransport } from '../notifier.ts';
import { registerDemo } from './registry.ts';

/**
 * Nothing is sent: each channel logs the message it would get. A demo office starts with every chat app set up (fake
 * addresses in demo-secrets.json), so a needs-human PR shows one line per channel; an address containing "bad" fails.
 */
const demoNotify: NotifyTransport = {
  demoWebhooks: {
    ntfy: { url: 'https://ntfy.sh/cubefarm-demo-office' },
  },
  post: async ({ channel, url, text }) => {
    const ok = !/bad/i.test(url);
    console.log(`🔔 demo ${channel}${ok ? '' : ' (fails: "bad" address)'} would get: ${text.replace(/\n/g, ' ⏎ ')}`);
    return ok ? 200 : 404;
  },
};

registerDemo('notify', () => ({ notify: demoNotify, telegram: demoTelegram() }));
