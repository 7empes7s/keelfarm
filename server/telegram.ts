// Telegram, the pure part (docs/pocket.md): the manager's own bot token checked, the one-time /start code that links
// their chat, Bot API updates parsed (text, replies, button presses), what the bot sends (notes with the office link,
// team-change buttons, messages split at Telegram's limit) and the long poll's backoff. telegramBot.ts does the calls.
import { withVisualsText } from '../shared/chatVisuals.ts';
import { fileLinks } from '../shared/files.ts';
import type { PhoneMessage } from '../shared/types.ts';
import { secretMismatch } from '../shared/secretFormats.ts';
import { HttpError } from './httpError.ts';
import { noteText, type Note } from './notify.ts';

/** Telegram's longest message, in characters. */
export const TELEGRAM_MAX = 4096;
/** A /start link works this long. */
export const START_CODE_MS = 30 * 60_000;
/** The long poll's longest wait after errors. */
export const BACKOFF_MAX_MS = 60_000;

/** What secrets.json keeps under "telegram": the bot's token and name, and the manager's chat once linked. */
export interface TelegramSecrets {
  token: string;
  bot: string;
  chatId?: number;
  chatName?: string;
}

/** A token as BotFather gives it: the bot's id, a colon, then its secret. Throws what's wrong with it. */
export function parseToken(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) throw new HttpError(400, 'Paste the token BotFather gave you.');
  const wrong = secretMismatch('telegram', s);
  if (wrong) throw new HttpError(400, wrong);
  if (!/^\d{4,15}:[\w-]{30,60}$/.test(s)) throw new HttpError(400, "That doesn't look like a bot token: BotFather's look like 123456789:AAE…, a number, a colon and about 35 letters.");
  return s;
}

/** The saved settings read back, each field checked; null when there's no usable token. */
export function loadTelegram(raw: unknown): TelegramSecrets | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  let token: string;
  try {
    token = parseToken(r.token);
  } catch {
    return null;
  }
  const bot = typeof r.bot === 'string' && /^\w{1,64}$/.test(r.bot) ? r.bot : '';
  const chatId = Number.isSafeInteger(r.chatId) ? (r.chatId as number) : undefined;
  const chatName = typeof r.chatName === 'string' ? r.chatName.slice(0, 64) : undefined;
  return { token, bot, ...(chatId !== undefined ? { chatId, ...(chatName ? { chatName } : {}) } : {}) };
}

/** A one-time code for the /start link, from random bytes: letters, digits, - and _, as Telegram allows. */
export const startCode = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url').slice(0, 32);

/** The link that opens the bot with the code filled in: pressing Start sends "/start <code>". */
export const startUrl = (bot: string, code: string) => `https://t.me/${bot}?start=${code}`;

// ---------- updates ----------

export type TgUpdate =
  | { id: number; kind: 'text'; chatId: number; private: boolean; name: string; messageId: number; text: string; replyTo: { messageId: number; text: string } | null }
  | { id: number; kind: 'callback'; chatId: number; callbackId: string; messageId: number; data: string }
  | { id: number; kind: 'other' };

const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : null);
const int = (v: unknown) => (Number.isSafeInteger(v) ? (v as number) : null);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** One entry of getUpdates, or null when it isn't an update at all. Anything but texts and button presses is "other". */
export function parseUpdate(raw: unknown): TgUpdate | null {
  const u = obj(raw);
  const id = int(u?.update_id);
  if (!u || id === null) return null;
  const msg = obj(u.message);
  const chat = obj(msg?.chat);
  const chatId = int(chat?.id);
  const messageId = int(msg?.message_id);
  const text = str(msg?.text) || str(msg?.caption);
  if (msg && chat && chatId !== null && messageId !== null && text) {
    const reply = obj(msg.reply_to_message);
    const replyId = int(reply?.message_id);
    const from = obj(msg.from);
    return {
      id,
      kind: 'text',
      chatId,
      private: chat.type === 'private',
      name: (str(from?.first_name) || str(chat.first_name) || str(from?.username)).slice(0, 64),
      messageId,
      text,
      replyTo: reply && replyId !== null ? { messageId: replyId, text: str(reply.text) || str(reply.caption) } : null,
    };
  }
  const cb = obj(u.callback_query);
  const cbMsg = obj(cb?.message);
  const cbChat = int(obj(cbMsg?.chat)?.id);
  const cbMessageId = int(cbMsg?.message_id);
  if (cb && typeof cb.id === 'string' && cbChat !== null && cbMessageId !== null) {
    return { id, kind: 'callback', chatId: cbChat, callbackId: cb.id, messageId: cbMessageId, data: str(cb.data) };
  }
  return { id, kind: 'other' };
}

/** The code in "/start <code>" (or "/start@bot <code>"), '' for a bare /start, null for any other text. */
export function startCommand(text: string): string | null {
  const m = text.trim().match(/^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/);
  return m ? (m[1] ?? '') : null;
}

export type LinkResult = { ok: true; chatId: number; name: string } | { ok: false; why: string };

/** A /start that may link the manager's chat: only the current code, before it expires, from a private chat. */
export function linkAttempt(pending: { code: string; expiresAt: number } | null, u: TgUpdate, now: number): LinkResult {
  if (u.kind !== 'text') return { ok: false, why: 'not a message' };
  const code = startCommand(u.text);
  if (code === null) return { ok: false, why: 'not /start' };
  if (!u.private) return { ok: false, why: 'not a private chat' };
  if (!pending || now > pending.expiresAt) return { ok: false, why: 'no Start link is waiting' };
  if (code !== pending.code) return { ok: false, why: 'wrong code' };
  return { ok: true, chatId: u.chatId, name: u.name };
}

/** Whether an update comes from the manager's linked chat: the only chat the office ever listens to. */
export const fromManager = (chatId: number | undefined, u: TgUpdate) => chatId !== undefined && u.kind !== 'other' && u.chatId === chatId;

/** What the CEO is sent for a Telegram message: a reply quotes the message it answers. */
export function ceoText(u: Extract<TgUpdate, { kind: 'text' }>): string {
  const quoted = u.replyTo?.text.replace(/\s+/g, ' ').trim();
  if (!quoted) return u.text.trim();
  return `> ${quoted.length > 140 ? `${quoted.slice(0, 139).trimEnd()}…` : quoted}\n\n${u.text.trim()}`;
}

// ---------- what the bot sends ----------

/** `text` in pieces of at most `max` characters, cut at a line break, else a space, never inside an emoji. */
export function splitMessage(text: string, max = TELEGRAM_MAX): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = rest.lastIndexOf(' ', max);
    if (cut < max / 2) cut = max;
    const code = rest.charCodeAt(cut - 1);
    if (cut === max && code >= 0xd800 && code <= 0xdbff) cut--; // a surrogate pair stays whole
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

/** One inline button. */
export interface TgButton {
  text: string;
  callback_data: string;
}

/** A team change's buttons' data: a:<id> approves it, d:<id> declines it (Telegram allows 64 bytes). */
export const decisionData = (verdict: 'approve' | 'decline', id: string) => `${verdict === 'approve' ? 'a' : 'd'}:${id}`;

export function parseDecision(data: string): { verdict: 'approve' | 'decline'; id: string } | null {
  const m = data.match(/^([ad]):([\w-]{1,60})$/);
  return m ? { verdict: m[1] === 'a' ? 'approve' : 'decline', id: m[2] } : null;
}

/** An IT card's buttons (#524): Run or Not now, decided as the chat's card is. */
export const runKeyboard = (id: string): TgButton[][] => [[{ text: 'Run', callback_data: decisionData('approve', id) }, { text: 'Not now', callback_data: decisionData('decline', id) }]];

/** One row per team change: approve it (hire / let go) or decline it. */
export function teamKeyboard(changes: readonly { id: string; name: string; kind: 'hire' | 'let-go' }[]): TgButton[][] {
  return changes.map((c) => [
    { text: c.kind === 'hire' ? `✅ Hire ${c.name}` : `✅ Let ${c.name} go`, callback_data: decisionData('approve', c.id) },
    { text: '✋ Decline', callback_data: decisionData('decline', c.id) },
  ]);
}

/** A notification as a Telegram message: the note with the office link at the end, as the other chat apps get it. */
export const telegramNote = (n: Note, officeUrl: string) => noteText(n, officeUrl);

/** A CEO message on Telegram: their name, then what they wrote. */
export const telegramChat = (ceoName: string, text: string) => `💬 ${ceoName}\n${text.trim()}`;

/** Mirror visuals as text and large files as office download links, keeping the office URL's path prefix. */
export function telegramMessage(ceoName: string, m: Pick<PhoneMessage, 'text' | 'visuals' | 'attachments'>, officeUrl: string): string {
  return telegramChat(ceoName, [withVisualsText(m.text, m.visuals), fileLinks(m.attachments ?? [], officeUrl)].filter(Boolean).join('\n'));
}

// ---------- the long poll ----------

/** How long the poll waits after `failures` errors in a row: 1 s, doubling, at most a minute; Telegram's retry_after wins. */
export function pollBackoff(failures: number, retryAfterS?: number): number {
  if (retryAfterS && retryAfterS > 0) return Math.min(retryAfterS * 1000, 10 * BACKOFF_MAX_MS);
  if (failures <= 0) return 0;
  return Math.min(BACKOFF_MAX_MS, 1000 * 2 ** (failures - 1));
}

/** The office reads the bot's messages only with a token saved and the Telegram switch on: Off polls and retries nothing. */
export const telegramPolls = (hasToken: boolean, on: boolean): boolean => hasToken && on;

/** After this many failed reads in a row the settings say what to check. */
export const POLL_ADVICE_AFTER = 4;

/** What to check once reading keeps failing, or '' while it may just be a blip. */
export function pollAdvice(failures: number, status: number): string {
  if (failures < POLL_ADVICE_AFTER) return '';
  if (status === 0) return "Check this computer's internet connection, and that nothing blocks api.telegram.org.";
  if (status === 401 || status === 404) return 'The token was probably revoked in BotFather: Remove Telegram and save the new token.';
  return 'Check that the token is still valid in BotFather and the bot has no webhook set elsewhere.';
}

/** Why a Bot API call failed, in words the settings can show; never the token. */
export function telegramError(status: number, description = ''): string {
  if (status === 0) return "couldn't reach Telegram";
  if (status === 401 || status === 404) return 'Telegram refused the token: copy it again from BotFather';
  if (status === 403) return 'the bot was blocked or never started: open it in Telegram and press Start';
  if (status === 409) return 'another program is reading this bot\'s messages: give the office a bot of its own';
  if (status === 429) return 'Telegram is rate-limiting the office';
  const d = description.replace(/\d{4,15}:[\w-]{30,60}/g, '••••').slice(0, 120);
  return `Telegram answered ${status}${d ? `: ${d}` : ''}`;
}
