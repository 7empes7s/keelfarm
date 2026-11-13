// Notifications: what the office tells the manager, where, and the notification centre. Imported through shared/types.ts.
import type { ChatRef } from './chat.ts';

/** What the office tells the manager about when they're away (docs/pocket.md). */
export type NotifyEvent = 'needsHuman' | 'question' | 'ceoMessage' | 'hire' | 'agentError' | 'usage' | 'memory' | 'disk' | 'merge' | 'decisions' | 'setup';

/** Where it tells them: this browser, Web Push to their devices, a chat app's webhook, or their own Telegram bot. */
export type NotifyChannel = 'desktop' | 'push' | 'ntfy' | 'telegram';

/** The chat apps, whose webhook URLs and tokens live in the server's secrets file. */
export type NotifyWebhook = 'ntfy';

export interface NotifySettings {
  events: Record<NotifyEvent, boolean>;
  channels: Record<NotifyChannel, boolean>; // a chat app also needs its webhook saved
  officeUrl: string; // where messages link back to ('' = no link), e.g. a Tailscale Serve URL
  telegramMirror: boolean; // every CEO message also goes to Telegram (otherwise only replies to messages sent from there)
  quietInApp: boolean; // nothing goes out while the manager is using the app on any device (#210)
  problemsDigestHour?: number; // the daily problems digest's hour (#544, Settings → Problems): 0-23, -1 off; absent: 9 (shared/problems.ts)
}

/** A channel's last send since the office started: when, and whether it arrived (else why not). */
export interface NotifyHealth {
  at: number;
  ok: boolean;
  error: string;
}

/** A device that gets Web Push. `id` is derived from its subscription, which never leaves the server. */
export interface PushDeviceView {
  id: string;
  name: string;
  addedAt: number;
  last: NotifyHealth | null;
}

/** Which chat apps have a webhook saved (only a hint of it: the secret never leaves the server), the push devices and each channel's last send. */
export interface NotifyChannelsView {
  webhooks: Record<NotifyWebhook, { set: boolean; hint: string; last: NotifyHealth | null }>;
  pushDevices: number;
  devices: PushDeviceView[];
  desktop: NotifyHealth | null;
  telegram: TelegramView;
  /** Today's notes (#210): sent, and not sent because the manager was in the app. */
  today: { sent: number; skipped: number };
}

/** The manager's Telegram bot (docs/pocket.md): its token and their chat id stay on the server. */
export interface TelegramView {
  set: boolean; // a bot token is saved
  bot: string; // its username, e.g. "my_office_bot"
  linked: boolean; // the manager pressed Start in their chat
  chat: string; // that chat's first name, for "Linked to …"
  linking: boolean; // a Start link is waiting to be pressed
  on: boolean; // Settings' Telegram switch: off, nothing is read, retried or sent; the token and chat are kept
  polling: 'off' | 'ok' | 'retrying'; // reading the bot's messages ('off' while there's no token or the switch is off)
  error: string; // why the last read failed, while retrying
  okAt: number | null; // when reading last worked
  advice: string; // what to check after repeated failures
  last: NotifyHealth | null; // its last send
}

/** A test push to one device: the push service took it, the device is gone (and dropped), or another error. */
export interface PushTestView {
  outcome: 'delivered' | 'expired' | 'error';
  status: number;
  message: string;
}

/** A notification the office sent: a browser with the office open but hidden shows it as a desktop notification. */
export interface NoteView {
  id: string;
  event: NotifyEvent | 'test';
  title: string;
  body: string;
  at: number;
  url: string; // in-app link, e.g. '/?tab=approvals'
}

/** The notification centre (#107, shared/notices.ts): what a notice is about, and the buttons it offers. */
export type NoticeKind = 'merge' | 'qaPass' | 'qaFail' | 'needsYou' | 'ceo' | 'stuck' | 'usage' | 'error' | 'approval' | 'update' | 'keys' | 'setup' | 'it';
/** Each maps to an existing api call or panel in the client (ui/noticeActions.ts), never to a URL from the server. */
export type NoticeAction = 'openPr' | 'openQa' | 'approve' | 'reply' | 'terminal' | 'retry' | 'approvals' | 'reviewKeys' | 'setup' | 'openIt';
type NoticeTarget = DistributiveOmit<Exclude<ChatRef, { kind: 'file' }>, 'start' | 'end'>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export interface NoticeView {
  id: string; // a push or Telegram message about it carries the same id (?note=), so opening one marks it read
  at: number;
  kind: NoticeKind;
  level: 'info' | 'success' | 'error';
  title: string;
  text: string;
  details?: string; // lines shown as they are under More: a menu on an agent's screen (#640)
  floor?: number;
  target?: NoticeTarget; // where tapping it jumps (the chat's refs, #26)
  actions?: NoticeAction[]; // at most 2
  requestId?: string; // the team change 'approve' approves, or an IT card opened by 'openIt'
  read: boolean;
}
