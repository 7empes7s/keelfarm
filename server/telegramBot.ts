// Telegram (docs/pocket.md): the manager's own bot. Its token and the manager's chat live in the secrets file under
// "telegram", never in the state, a broadcast, a log line or an agent's environment. The office long-polls getUpdates
// (no public webhook: it's only on 127.0.0.1 and the tailnet), links the chat that presses Start with the current
// one-time code, then listens to that chat only: its messages go to the CEO, its button presses decide team changes.
// telegram.ts is the pure part.
import crypto from 'node:crypto';
import type { NotifyHealth, TelegramView } from '../shared/types.ts';
import { HttpError } from './httpError.ts';
import { mergeSecrets, readSecrets } from './secrets.ts';
import {
  START_CODE_MS,
  ceoText,
  fromManager,
  linkAttempt,
  loadTelegram,
  parseDecision,
  parseToken,
  parseUpdate,
  pollAdvice,
  pollBackoff,
  splitMessage,
  startCode,
  startCommand,
  startUrl,
  telegramError,
  telegramPolls,
  type TelegramSecrets,
  type TgButton,
  type TgUpdate,
} from './telegram.ts';

/** A Bot API call that failed: Telegram's error code (0: never reached it) and description. */
export class TelegramCallError extends Error {
  constructor(
    readonly status: number,
    readonly description: string,
    readonly retryAfter?: number,
  ) {
    super(telegramError(status, description));
  }
}

/** The Bot API. The real one is fetch (telegramHttp); the demo's is a fake that logs what it would send. */
export interface TelegramApi {
  /** One call; resolves with its `result`, or rejects with a TelegramCallError. */
  call(token: string, method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
  /** The demo only: an update the fake bot hands out on its next getUpdates. */
  inject?(update: Record<string, unknown>): void;
  /** The demo only: Telegram can't be reached (true) or can again. */
  outage?(down: boolean): void;
}

/** getUpdates waits this long for something to happen (seconds): one request at a time, almost always idle. */
const POLL_S = 25;

export const telegramHttp: TelegramApi = {
  async call(token, method, params, signal) {
    const timeout = AbortSignal.timeout(((method === 'getUpdates' ? POLL_S : 0) + 15) * 1000);
    let res: Response;
    try {
      // The token is in the URL, so no error here ever repeats the URL.
      res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch {
      throw new TelegramCallError(0, '');
    }
    const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: unknown; description?: string; parameters?: { retry_after?: number } } | null;
    if (!res.ok || !body?.ok) throw new TelegramCallError(res.status, String(body?.description ?? ''), body?.parameters?.retry_after);
    return body.result;
  },
};

export interface TelegramDeps {
  api: TelegramApi;
  secretsFile: string;
  /** Settings' Telegram switch. Off: no polling, retries or sends; the token and chat stay saved. */
  on(): boolean;
  /** A message from the manager's chat, for the CEO (as from the phone, marked "via Telegram"), with its Telegram id. */
  message(text: string, messageId: number): Promise<void>;
  /** A team-change button: approves or declines it through the office's own paths. Returns what to show; throws why not. */
  decide(verdict: 'approve' | 'decline', id: string): string;
  /** The view changed (linked, polling, a send): the settings redraw. */
  changed(): void;
  /** Server log lines, never the token or the chat. */
  log(line: string): void;
  now?(): number;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });

/** The demo's pretend manager chat. */
const DEMO_CHAT = 4242;

export class TelegramBot {
  private secrets: TelegramSecrets | null = null;
  private pending: { code: string; expiresAt: number } | null = null;
  private offset = 0;
  private failures = 0;
  private failStatus = 0;
  private okAt: number | null = null;
  /** Ends the wait between retries early (Retry now). */
  private retryWake: (() => void) | null = null;
  private polling: { abort: AbortController; done: Promise<void> } | null = null;
  private pollError = '';
  private last: NotifyHealth | null = null;
  /** The demo only: the bot's last message with buttons, for "press a button". */
  private lastButtons: { messageId: number; rows: TgButton[][] } | null = null;
  private lastSentId = 0;

  constructor(private deps: TelegramDeps) {}

  async init() {
    this.secrets = loadTelegram((await readSecrets(this.deps.secretsFile)).telegram);
    this.start();
  }

  /** The switch (or the token) changed: Off stops the poll and clears its error at once; On resumes it with the saved token and chat. */
  refresh() {
    if (telegramPolls(!!this.secrets, this.deps.on())) {
      if (!this.polling) this.start();
    } else {
      void this.stop();
      this.failures = 0;
      this.pollError = '';
    }
    this.deps.changed();
  }

  /** POST /api/notify/telegram/retry: read again now instead of waiting out the backoff. */
  retryNow(): TelegramView {
    if (!telegramPolls(!!this.secrets, this.deps.on())) throw new HttpError(409, 'Telegram is off: turn it on first.');
    this.retryWake?.();
    return this.view();
  }

  view(): TelegramView {
    const s = this.secrets;
    const on = this.deps.on();
    const reading = telegramPolls(!!s, on);
    return {
      set: !!s,
      bot: s?.bot ?? '',
      linked: s?.chatId !== undefined,
      chat: s?.chatId !== undefined ? (s.chatName ?? 'your chat') : '',
      linking: !!this.pending && this.now() <= this.pending.expiresAt,
      on,
      polling: !reading ? 'off' : this.failures ? 'retrying' : 'ok',
      error: reading ? this.pollError : '',
      okAt: this.okAt,
      advice: reading ? pollAdvice(this.failures, this.failStatus) : '',
      last: this.last,
    };
  }

  /** The manager's chat is linked: notes, CEO replies and send_telegram can go there (while the switch is on). */
  linked(): boolean {
    return this.secrets?.chatId !== undefined;
  }

  /** Linked and switched on: something sent now would go out. */
  active(): boolean {
    return this.linked() && this.deps.on();
  }

  /** The token, for redacting anything that might echo it. */
  secret(): string | null {
    return this.secrets?.token ?? null;
  }

  /** PUT /api/notify/telegram: checks the token with getMe, saves it (a new bot links a chat afresh) and makes a Start link. */
  async setToken(raw: unknown): Promise<{ view: TelegramView; startUrl: string }> {
    const token = parseToken(raw);
    let me: { username?: unknown; is_bot?: unknown };
    try {
      me = ((await this.deps.api.call(token, 'getMe', {})) ?? {}) as typeof me;
    } catch (err) {
      throw new HttpError(400, `The token didn't work: ${err instanceof Error ? err.message : 'Telegram refused it'}.`);
    }
    if (typeof me.username !== 'string' || me.is_bot === false) throw new HttpError(400, "Telegram didn't say which bot that is: copy the token again from BotFather.");
    // A webhook set elsewhere would keep getUpdates from working.
    await this.deps.api.call(token, 'deleteWebhook', {}).catch(() => undefined);
    const same = this.secrets?.token === token;
    await this.save({ token, bot: me.username, ...(same && this.secrets?.chatId !== undefined ? { chatId: this.secrets.chatId, chatName: this.secrets.chatName } : {}) });
    this.deps.log(`telegram: the office's bot is @${me.username}`);
    this.start();
    const link = this.link();
    return { view: this.view(), startUrl: link.startUrl };
  }

  /** POST /api/notify/telegram/link: a new one-time Start link (the last one stops working). */
  link(): { startUrl: string } {
    if (!this.secrets) throw new HttpError(409, 'Save the bot token first.');
    this.pending = { code: startCode(crypto.randomBytes(24)), expiresAt: this.now() + START_CODE_MS };
    this.deps.changed();
    return { startUrl: startUrl(this.secrets.bot, this.pending.code) };
  }

  /** DELETE /api/notify/telegram: forgets the token and the chat. */
  async remove(): Promise<TelegramView> {
    await this.stop();
    this.pending = null;
    this.last = null;
    this.pollError = '';
    this.secrets = null;
    await mergeSecrets(this.deps.secretsFile, { telegram: undefined });
    this.deps.changed();
    return this.view();
  }

  /** A message to the manager's chat, split at Telegram's limit (buttons under the last piece). Null when it arrived, else why not. `key`: the phone message it copies, for editSent; `replyTo`: the Telegram message it answers. */
  async send(text: string, keyboard?: TgButton[][], key?: number, replyTo?: number): Promise<string | null> {
    const s = this.secrets;
    if (!s || s.chatId === undefined) return 'Telegram isn\'t linked';
    if (!this.deps.on()) return 'Telegram is off in Settings';
    const parts = splitMessage(text);
    let why: string | null = null;
    const pieces: { id: number; text: string }[] = [];
    if (key !== undefined) this.remember(key, pieces);
    for (const [i, part] of parts.entries()) {
      const buttons = i === parts.length - 1 && keyboard?.length ? keyboard : undefined;
      try {
        const r = (await this.deps.api.call(s.token, 'sendMessage', {
          chat_id: s.chatId,
          text: part,
          link_preview_options: { is_disabled: true },
          ...(i === 0 && replyTo !== undefined ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
          ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
        })) as { message_id?: unknown } | null;
        const id = Number(r?.message_id) || 0;
        this.lastSentId = id;
        pieces.push({ id, text: part });
        if (buttons) this.lastButtons = { messageId: id, rows: buttons };
      } catch (err) {
        why = err instanceof TelegramCallError ? err.message : "couldn't reach Telegram";
        break;
      }
    }
    this.last = { at: this.now(), ok: !why, error: why ?? '' };
    if (why) this.deps.log(`telegram: a message didn't go out: ${why}`);
    this.deps.changed();
    return why;
  }

  /** A reaction on a message in the manager's chat (setMessageReaction), replacing the bot's last one there. A failure is only logged. */
  async react(messageId: number, emoji: string): Promise<void> {
    const s = this.secrets;
    if (!s || s.chatId === undefined) return;
    await this.deps.api.call(s.token, 'setMessageReaction', { chat_id: s.chatId, message_id: messageId, reaction: [{ type: 'emoji', emoji }] }).catch((err: unknown) => this.deps.log(`telegram: a reaction didn't go on: ${err instanceof Error ? err.message : 'unknown error'}`));
  }

  /** What each of the latest phone messages went out as here (#125), for editSent; this run of the office only. */
  private sent = new Map<number, { id: number; text: string }[]>();
  private remember(key: number, pieces: { id: number; text: string }[]) {
    this.sent.set(key, pieces);
    if (this.sent.size > 50) this.sent.delete(this.sent.keys().next().value!);
  }

  /** The copy of phone message `key` edited in place (editMessageText), piece by piece; pieces past the old ones go out new. Null when done, else why not. */
  async editSent(key: number, text: string): Promise<string | null> {
    const s = this.secrets;
    const pieces = this.sent.get(key);
    if (!s || s.chatId === undefined || !pieces?.length) return 'its Telegram copy is from before the office restarted';
    const parts = splitMessage(text);
    try {
      for (const [i, p] of pieces.entries()) {
        const next = parts[i] ?? '…';
        if (next === p.text) continue; // Telegram refuses an edit that changes nothing
        const buttons = this.lastButtons?.messageId === p.id ? { reply_markup: { inline_keyboard: this.lastButtons.rows } } : {};
        await this.deps.api.call(s.token, 'editMessageText', { chat_id: s.chatId, message_id: p.id, text: next, link_preview_options: { is_disabled: true }, ...buttons });
        p.text = next;
      }
    } catch (err) {
      return err instanceof TelegramCallError ? err.message : "couldn't reach Telegram";
    }
    return parts.length > pieces.length ? this.send(parts.slice(pieces.length).join('\n')) : null;
  }

  /** Stops the long poll (shutdown, or the token is removed). */
  async stop() {
    const p = this.polling;
    this.polling = null;
    if (!p) return;
    p.abort.abort();
    await p.done;
  }

  /**
   * POST /api/notify/telegram/demo (demo only): the fake manager presses Start, writes (or replies to the bot's last
   * message), or presses the first or second button of the bot's last team change.
   */
  demo(body: { kind?: unknown; text?: unknown }): { ok: true } {
    const inject = this.deps.api.inject;
    if (!inject || !this.secrets) throw new HttpError(409, 'Save a bot token first (any token in the right shape works in the demo).');
    const chat = { id: this.secrets.chatId ?? DEMO_CHAT, type: 'private', first_name: 'Manager' };
    const msg = (text: string, extra: Record<string, unknown> = {}) => ({ message: { message_id: Math.floor(this.now() / 1000), chat, from: { id: chat.id, first_name: 'Manager' }, date: 0, text, ...extra } });
    const text = typeof body.text === 'string' ? body.text.slice(0, 4000) : '';
    if (body.kind === 'start') {
      if (!this.pending) throw new HttpError(409, 'Make a Start link first.');
      inject(msg(`/start ${this.pending.code}`));
    } else if (body.kind === 'message' || body.kind === 'reply') {
      if (!text.trim()) throw new HttpError(400, 'Say what the manager writes.');
      inject(msg(text, body.kind === 'reply' && this.lastSentId ? { reply_to_message: { message_id: this.lastSentId, chat, text: 'the bot\'s last message' } } : {}));
    } else if (body.kind === 'approve' || body.kind === 'decline') {
      const b = this.lastButtons;
      if (!b) throw new HttpError(409, 'The bot has sent no team change with buttons yet.');
      inject({ callback_query: { id: `demo-${this.now()}`, data: b.rows[0][body.kind === 'approve' ? 0 : 1].callback_data, message: { message_id: b.messageId, chat } } });
    } else if (body.kind === 'outage' || body.kind === 'online') {
      this.deps.api.outage?.(body.kind === 'outage');
      if (body.kind === 'online') this.retryWake?.();
    } else throw new HttpError(400, 'kind is start, message, reply, approve, decline, outage or online');
    return { ok: true };
  }

  // ---------- the long poll ----------

  private start() {
    void this.stop().then(() => {
      if (!telegramPolls(!!this.secrets, this.deps.on()) || this.polling) return;
      const abort = new AbortController();
      this.polling = { abort, done: this.poll(abort.signal) };
    });
  }

  private async poll(signal: AbortSignal) {
    while (!signal.aborted && this.secrets && this.deps.on()) {
      const token = this.secrets.token;
      try {
        // After a failure, a quick read: back online shows at once, not after a 25 s wait.
        const updates = await this.deps.api.call(token, 'getUpdates', { offset: this.offset, timeout: this.failures ? 0 : POLL_S, allowed_updates: ['message', 'callback_query'] }, signal);
        if (signal.aborted) break;
        this.okAt = this.now();
        if (this.failures) {
          this.failures = 0;
          this.pollError = '';
          this.deps.changed();
        }
        for (const raw of Array.isArray(updates) ? updates : []) {
          const u = parseUpdate(raw);
          if (!u) continue;
          this.offset = Math.max(this.offset, u.id + 1);
          await this.handle(u).catch((err) => this.deps.log(`telegram: an update failed: ${err instanceof Error ? err.message : 'unknown error'}`));
        }
      } catch (err) {
        if (signal.aborted) break;
        const e = err instanceof TelegramCallError ? err : new TelegramCallError(0, '');
        this.failures++;
        this.failStatus = e.status;
        if (e.message !== this.pollError) this.deps.log(`telegram: reading the bot's messages failed (retrying): ${e.message}`);
        this.pollError = e.message;
        this.deps.changed();
        const wake = new AbortController();
        this.retryWake = () => wake.abort();
        await sleep(pollBackoff(this.failures, e.retryAfter), AbortSignal.any([signal, wake.signal]));
        this.retryWake = null;
      }
    }
  }

  private async handle(u: TgUpdate) {
    const s = this.secrets;
    if (!s || u.kind === 'other') return;
    const link = linkAttempt(this.pending, u, this.now());
    if (link.ok) {
      this.pending = null;
      await this.save({ ...s, chatId: link.chatId, chatName: link.name || undefined });
      this.deps.log('telegram: the manager\'s chat is linked');
      await this.send('✅ Linked to your cubefarm office. Notifications come here, and you can write to the CEO right in this chat.');
      return;
    }
    if (!fromManager(s.chatId, u)) {
      // Never answered: the bot only ever talks to the manager's chat.
      if (u.kind === 'text' && startCommand(u.text) !== null) this.deps.log(`telegram: ignored a /start (${link.why})`);
      return;
    }
    if (u.kind === 'text') {
      if (startCommand(u.text) !== null) {
        await this.send('This chat is already linked to the office. Write here to reach the CEO.');
        return;
      }
      await this.deps.message(ceoText(u), u.messageId);
      return;
    }
    const d = parseDecision(u.data);
    let answer: string;
    let alert = false;
    try {
      answer = d ? this.deps.decide(d.verdict, d.id) : 'That button is from an older office.';
    } catch (err) {
      answer = err instanceof Error ? err.message : 'That didn\'t work.';
      alert = true;
    }
    await this.deps.api.call(s.token, 'answerCallbackQuery', { callback_query_id: u.callbackId, text: answer.slice(0, 190), show_alert: alert }).catch(() => undefined);
    // Decided (or gone): its buttons go, so it can't be pressed twice.
    await this.deps.api.call(s.token, 'editMessageReplyMarkup', { chat_id: u.chatId, message_id: u.messageId, reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
    if (this.lastButtons?.messageId === u.messageId) this.lastButtons = null;
  }

  private async save(next: TelegramSecrets) {
    await mergeSecrets(this.deps.secretsFile, { telegram: next });
    this.secrets = next;
    this.deps.changed();
  }

  private now() {
    return this.deps.now?.() ?? Date.now();
  }
}
