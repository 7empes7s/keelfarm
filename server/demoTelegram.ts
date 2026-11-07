// The demo's Telegram: a fake Bot API for `--demo` (see createDemoBackend in demo.ts).
import { TelegramCallError, type TelegramApi } from './telegramBot.ts';

/**
 * A fake Bot API with no network: any token in BotFather's shape is the bot @cubefarm_demo_bot (one with "bad" in it is
 * refused), sends are logged, and getUpdates hands out what the demo's fake manager does (TelegramBot.demo). During a
 * pretend outage every call fails as if Telegram were unreachable, for the settings' error state.
 */
export function demoTelegram(): TelegramApi {
  let queue: Record<string, unknown>[] = [];
  let nextUpdate = 1;
  let nextMessage = 500;
  let wake: (() => void) | null = null;
  let down = false;
  return {
    async call(token, method, params, signal) {
      if (/bad/i.test(token)) throw new TelegramCallError(401, 'Unauthorized');
      if (down) throw new TelegramCallError(0, '');
      switch (method) {
        case 'getMe':
          return { id: Number(token.split(':')[0]), is_bot: true, first_name: 'cubefarm demo', username: 'cubefarm_demo_bot' };
        case 'getUpdates': {
          if (!queue.length) {
            await new Promise<void>((resolve) => {
              const t = setTimeout(resolve, Number(params.timeout ?? 0) * 1000);
              t.unref?.();
              wake = () => (clearTimeout(t), resolve());
              signal?.addEventListener('abort', wake, { once: true });
            });
            wake = null;
          }
          if (signal?.aborted) throw new TelegramCallError(0, 'stopped');
          if (down) throw new TelegramCallError(0, '');
          const out = queue.filter((u) => Number(u.update_id) >= Number(params.offset ?? 0));
          queue = [];
          return out;
        }
        case 'sendMessage': {
          const buttons = (params.reply_markup as { inline_keyboard?: { text: string }[][] } | undefined)?.inline_keyboard ?? [];
          const labels = buttons.flat().map((b) => `[${b.text}]`).join(' ');
          console.log(`✈️ demo Telegram would send: ${String(params.text).replace(/\n/g, ' ⏎ ')}${labels ? ` ${labels}` : ''}`);
          return { message_id: ++nextMessage };
        }
        case 'answerCallbackQuery':
          console.log(`✈️ demo Telegram would answer the button: ${String(params.text)}`);
          return true;
        default:
          return true;
      }
    },
    outage(d) {
      down = d;
      wake?.(); // the waiting poll fails now, not in 25 s
    },
    inject(update) {
      queue.push({ update_id: nextUpdate++, ...update });
      wake?.();
    },
  };
}
