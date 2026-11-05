// "Telegram" in Settings → Notifications (docs/pocket.md), the pure part: from what the office reports of the bot,
// the setup's steps, each done, to do or waiting for an earlier one. TelegramSettings.tsx draws them and runs them.
import type { TelegramView } from '../../../shared/types';
import type { StepState } from './notifySteps';

type TelegramStepId = 'bot' | 'token' | 'start';

export interface TelegramStep {
  id: TelegramStepId;
  state: StepState;
  title: string;
  detail: string;
  how?: string[];
}

export const BOTFATHER = 'https://t.me/BotFather';

/** The setup top to bottom. `startUrl`: this tab's Start link, when it has one that's still waiting. */
export function telegramSteps(v: TelegramView, startUrl: string | null): TelegramStep[] {
  const steps: TelegramStep[] = [
    v.set
      ? { id: 'bot', state: 'done', title: 'Bot made', detail: `Your bot is @${v.bot}.` }
      : {
          id: 'bot',
          state: 'todo',
          title: 'Make a bot in Telegram',
          detail: "It's yours: the office talks to you through it and nobody else.",
          how: ['Open @BotFather in Telegram.', 'Send /newbot, then a name, then a username ending in "bot".', 'BotFather answers with a token like 123456789:AAE…: copy it.'],
        },
    v.set
      ? { id: 'token', state: 'done', title: 'Token saved', detail: 'The office checked it with Telegram. It stays on the office\'s PC and is never shown again.' }
      : { id: 'token', state: 'todo', title: 'Paste the token here', detail: 'The office checks it with Telegram before saving it.' },
    v.linked
      ? { id: 'start', state: 'done', title: `Linked to ${v.chat}`, detail: 'The office only ever listens to this chat.' }
      : {
          id: 'start',
          state: 'todo',
          title: 'Open your bot and press Start',
          detail: startUrl && v.linking ? 'Waiting for you to press Start… The link works once, for 30 minutes.' : 'Make a Start link: pressing Start with it links your chat, and only that chat.',
        },
  ];
  let blocked = false;
  return steps.map((s) => {
    const out = blocked && s.state !== 'done' ? { ...s, state: 'waiting' as const, how: undefined } : s;
    if (s.state !== 'done') blocked = true;
    return out;
  });
}
