import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { note } from './notify.ts';
import {
  BACKOFF_MAX_MS,
  TELEGRAM_MAX,
  ceoText,
  decisionData,
  fromManager,
  linkAttempt,
  loadTelegram,
  parseDecision,
  parseToken,
  parseUpdate,
  POLL_ADVICE_AFTER,
  pollAdvice,
  pollBackoff,
  splitMessage,
  startCode,
  startCommand,
  startUrl,
  teamKeyboard,
  telegramError,
  telegramNote,
  telegramPolls,
  type TgUpdate,
} from './telegram.ts';
import { TelegramBot, TelegramCallError, type TelegramApi } from './telegramBot.ts';

const TOKEN = '123456789:AAEexampleSECRETtokenSECRETtoken4242';
const text = (chatId: number, t: string, extra: Record<string, unknown> = {}) => ({
  update_id: 7,
  message: { message_id: 11, chat: { id: chatId, type: 'private', first_name: 'Ana' }, from: { id: chatId, first_name: 'Ana' }, text: t, ...extra },
});

describe('telegram tokens', () => {
  it("takes BotFather's shape and refuses anything else", () => {
    expect(parseToken(`  ${TOKEN} `)).toBe(TOKEN);
    for (const bad of ['', 'abc', '123:short', `${TOKEN} extra`, 'https://api.telegram.org/bot1/x']) expect(() => parseToken(bad)).toThrow();
  });

  it('reads saved settings back, dropping what is malformed', () => {
    expect(loadTelegram({ token: TOKEN, bot: 'my_bot', chatId: 42, chatName: 'Ana' })).toEqual({ token: TOKEN, bot: 'my_bot', chatId: 42, chatName: 'Ana' });
    expect(loadTelegram({ token: TOKEN, bot: 'my bot!', chatId: '42' })).toEqual({ token: TOKEN, bot: '' });
    expect(loadTelegram({ token: 'old' })).toBeNull();
    expect(loadTelegram(undefined)).toBeNull();
  });

  it('never repeats a token in an error', () => {
    expect(telegramError(400, `Bad Request: bot${TOKEN} is odd`)).not.toContain('SECRET');
    expect(telegramError(401)).toMatch(/token/);
    expect(telegramError(0)).toBe("couldn't reach Telegram");
  });
});

describe('the Start link', () => {
  const code = startCode(new Uint8Array(24).fill(7));
  const pending = { code, expiresAt: 1_000 };
  const u = (t: string, chatId = 42, type = 'private') => parseUpdate({ ...text(chatId, t), message: { ...text(chatId, t).message, chat: { id: chatId, type, first_name: 'Ana' } } })!;

  it('is a t.me link with a code Telegram accepts', () => {
    expect(code).toMatch(/^[\w-]{1,64}$/);
    expect(startUrl('my_bot', code)).toBe(`https://t.me/my_bot?start=${code}`);
    expect(startCommand(`/start ${code}`)).toBe(code);
    expect(startCommand(`/start@my_bot ${code}`)).toBe(code);
    expect(startCommand('/start')).toBe('');
    expect(startCommand('hello /start x')).toBeNull();
  });

  it('links the chat that sends the current code in time', () => {
    expect(linkAttempt(pending, u(`/start ${code}`), 500)).toEqual({ ok: true, chatId: 42, name: 'Ana' });
  });

  it('refuses a wrong code, a late one, a group, plain text and no link at all', () => {
    expect(linkAttempt(pending, u('/start nope'), 500)).toEqual({ ok: false, why: 'wrong code' });
    expect(linkAttempt(pending, u('/start'), 500)).toEqual({ ok: false, why: 'wrong code' });
    expect(linkAttempt(pending, u(`/start ${code}`), 1_001)).toMatchObject({ ok: false });
    expect(linkAttempt(pending, u(`/start ${code}`, -100, 'group'), 500)).toEqual({ ok: false, why: 'not a private chat' });
    expect(linkAttempt(pending, u('hi'), 500)).toMatchObject({ ok: false });
    expect(linkAttempt(null, u(`/start ${code}`), 500)).toMatchObject({ ok: false });
  });

  it('listens to the linked chat only', () => {
    expect(fromManager(42, u('hi'))).toBe(true);
    expect(fromManager(42, u('hi', 43))).toBe(false);
    expect(fromManager(undefined, u('hi'))).toBe(false);
  });
});

describe('telegram updates', () => {
  it('reads a text, with the message it replies to', () => {
    const r = parseUpdate(text(42, 'Ship it', { reply_to_message: { message_id: 9, text: '💬 Mimoun\nShall I merge #4?' } }));
    expect(r).toEqual({ id: 7, kind: 'text', chatId: 42, private: true, name: 'Ana', messageId: 11, text: 'Ship it', replyTo: { messageId: 9, text: '💬 Mimoun\nShall I merge #4?' } });
    expect(ceoText(r as Extract<TgUpdate, { kind: 'text' }>)).toBe('> 💬 Mimoun Shall I merge #4?\n\nShip it');
    expect(ceoText(parseUpdate(text(42, ' hi '))! as Extract<TgUpdate, { kind: 'text' }>)).toBe('hi');
  });

  it('reads a button press and its data', () => {
    const r = parseUpdate({ update_id: 8, callback_query: { id: 'cb1', data: 'a:req-1', message: { message_id: 12, chat: { id: 42 } } } });
    expect(r).toEqual({ id: 8, kind: 'callback', chatId: 42, callbackId: 'cb1', messageId: 12, data: 'a:req-1' });
    expect(parseDecision('a:req-1')).toEqual({ verdict: 'approve', id: 'req-1' });
    expect(parseDecision(decisionData('decline', 'f3c1a2b4-0000-4000-8000-123456789abc'))).toEqual({ verdict: 'decline', id: 'f3c1a2b4-0000-4000-8000-123456789abc' });
    expect(parseDecision('x:1')).toBeNull();
  });

  it('keeps anything else as "other", and refuses what is no update', () => {
    expect(parseUpdate({ update_id: 9, edited_message: {} })).toEqual({ id: 9, kind: 'other' });
    expect(parseUpdate({ update_id: 10, message: { message_id: 1, chat: { id: 1 }, sticker: {} } })).toEqual({ id: 10, kind: 'other' });
    expect(parseUpdate({ message: {} })).toBeNull();
    expect(parseUpdate('nope')).toBeNull();
  });
});

describe('what the bot sends', () => {
  it('a note with the office link at the end', () => {
    expect(telegramNote(note('needsHuman', 'PR #4 needs you', 'pixel-todo: Add login.'), 'https://office.example.ts.net/')).toBe('⚠️ PR #4 needs you\npixel-todo: Add login.\nhttps://office.example.ts.net/');
  });

  it('a button pair per team change, within 64 bytes of data', () => {
    const id = 'f3c1a2b4-0000-4000-8000-123456789abc';
    const kb = teamKeyboard([
      { id, name: 'Ana', kind: 'hire' },
      { id: 'x', name: 'Bo', kind: 'let-go' },
    ]);
    expect(kb.map((row) => row.map((b) => b.text))).toEqual([
      ['✅ Hire Ana', '✋ Decline'],
      ['✅ Let Bo go', '✋ Decline'],
    ]);
    expect(kb.flat().every((b) => Buffer.byteLength(b.callback_data) <= 64)).toBe(true);
  });

  it("splits long messages at Telegram's limit, on line breaks or spaces", () => {
    expect(splitMessage('short')).toEqual(['short']);
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i} ${'x'.repeat(20)}`).join('\n');
    const parts = splitMessage(lines);
    expect(parts.length).toBe(2);
    expect(parts.every((p) => p.length <= TELEGRAM_MAX)).toBe(true);
    expect(parts.join('\n')).toBe(lines);
    expect(parts[1].startsWith('line ')).toBe(true);
    const words = Array.from({ length: 1200 }, () => 'word').join(' ');
    expect(splitMessage(words, 100).every((p) => p.length <= 100 && !p.startsWith(' ') && !p.endsWith(' '))).toBe(true);
    // One long token: cut hard, but never inside an emoji's surrogate pair.
    const emoji = `${'a'.repeat(99)}😀${'b'.repeat(50)}`;
    const cut = splitMessage(emoji, 100);
    expect(cut[0]).toBe('a'.repeat(99));
    expect(cut.join('')).toBe(emoji);
  });
});

describe('the long poll backoff', () => {
  it('doubles from 1 s to a minute, and follows retry_after', () => {
    expect([0, 1, 2, 3, 6, 7, 20].map((n) => pollBackoff(n))).toEqual([0, 1000, 2000, 4000, 32_000, BACKOFF_MAX_MS, BACKOFF_MAX_MS]);
    expect(pollBackoff(1, 5)).toBe(5000);
  });

  it('reads the bot only with a token and the switch on (#126)', () => {
    expect(telegramPolls(true, true)).toBe(true);
    expect(telegramPolls(true, false)).toBe(false);
    expect(telegramPolls(false, true)).toBe(false);
  });

  it('says what to check only after repeated failures', () => {
    expect(pollAdvice(POLL_ADVICE_AFTER - 1, 0)).toBe('');
    expect(pollAdvice(POLL_ADVICE_AFTER, 0)).toMatch(/internet connection/);
    expect(pollAdvice(POLL_ADVICE_AFTER, 401)).toMatch(/revoked/);
  });
});

// ---------- the bot, on a fake Bot API ----------

function fakeApi() {
  let queue: unknown[] = [];
  let wake: (() => void) | null = null;
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  let failPolls = 0;
  const api: TelegramApi = {
    async call(token, method, params, signal) {
      calls.push({ method, params });
      if (token !== TOKEN) throw new TelegramCallError(401, 'Unauthorized');
      if (method === 'getMe') return { is_bot: true, username: 'office_bot' };
      if (method === 'sendMessage') return { message_id: calls.length };
      if (method !== 'getUpdates') return true;
      if (failPolls > 0) {
        failPolls--;
        throw new TelegramCallError(502, 'Bad Gateway');
      }
      if (!queue.length) await new Promise<void>((r) => ((wake = r), signal?.addEventListener('abort', () => r(), { once: true })));
      const out = queue;
      queue = [];
      return out;
    },
  };
  return {
    api,
    calls,
    failNext: (n: number) => (failPolls = n),
    push(u: unknown) {
      queue.push(u);
      wake?.();
    },
  };
}

const until = async (ok: () => boolean) => {
  for (let i = 0; i < 300 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(ok()).toBe(true);
};

function bot(switchOn = { on: true }) {
  const fake = fakeApi();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-telegram-'));
  const secretsFile = path.join(dir, 'secrets.json');
  const messages: string[] = [];
  const decided: string[] = [];
  const logs: string[] = [];
  const changes = { n: 0 };
  const b = new TelegramBot({
    api: fake.api,
    secretsFile,
    on: () => switchOn.on,
    message: async (t) => void messages.push(t),
    decide: (verdict, id) => {
      if (id === 'gone') throw new Error('That team change no longer exists');
      decided.push(`${verdict}:${id}`);
      return 'Done';
    },
    changed: () => void changes.n++,
    log: (l) => logs.push(l),
  });
  return { b, fake, secretsFile, messages, decided, logs, changes };
}

describe('the Telegram bot', () => {
  it('links the chat that presses Start, then hands its messages to the CEO and nobody else', async () => {
    const { b, fake, secretsFile, messages, logs } = bot();
    await expect(b.setToken('123:nope')).rejects.toThrow(/bot token/);
    const { startUrl: url, view } = await b.setToken(TOKEN);
    expect(view).toMatchObject({ set: true, bot: 'office_bot', linked: false, linking: true });
    const code = new URL(url).searchParams.get('start')!;

    fake.push({ ...text(99, '/start wrong'), update_id: 1 });
    fake.push({ ...text(42, `/start ${code}`), update_id: 2 });
    await until(() => b.linked());
    expect(b.view()).toMatchObject({ linked: true, chat: 'Ana', linking: false });
    // The used code can't link another chat.
    fake.push({ ...text(99, `/start ${code}`), update_id: 3 });
    fake.push({ ...text(99, 'hi from a stranger'), update_id: 4 });
    fake.push({ ...text(42, 'How is floor 1?'), update_id: 5 });
    await until(() => messages.length === 1);
    expect(messages).toEqual(['How is floor 1?']);
    const sends = fake.calls.filter((c) => c.method === 'sendMessage');
    expect(sends.every((c) => c.params.chat_id === 42)).toBe(true);

    const saved = fs.readFileSync(secretsFile, 'utf8');
    expect(JSON.parse(saved).telegram).toMatchObject({ token: TOKEN, bot: 'office_bot', chatId: 42 });
    expect(JSON.stringify(b.view())).not.toContain('SECRET');
    expect(logs.join('\n')).not.toContain('SECRET');
    expect(logs.join('\n')).not.toContain('42');
    await b.stop();
  });

  it('decides team changes from button presses and takes the buttons away', async () => {
    const { b, fake, decided } = bot();
    const { startUrl: url } = await b.setToken(TOKEN);
    fake.push({ ...text(42, `/start ${new URL(url).searchParams.get('start')}`), update_id: 1 });
    await until(() => b.linked());
    fake.push({ update_id: 2, callback_query: { id: 'cb', data: 'a:req-1', message: { message_id: 5, chat: { id: 42 } } } });
    fake.push({ update_id: 3, callback_query: { id: 'cb2', data: 'd:gone', message: { message_id: 6, chat: { id: 42 } } } });
    fake.push({ update_id: 4, callback_query: { id: 'cb3', data: 'a:req-9', message: { message_id: 7, chat: { id: 99 } } } });
    await until(() => fake.calls.filter((c) => c.method === 'editMessageReplyMarkup').length === 2);
    expect(decided).toEqual(['approve:req-1']);
    const answers = fake.calls.filter((c) => c.method === 'answerCallbackQuery').map((c) => [c.params.text, c.params.show_alert]);
    expect(answers).toEqual([
      ['Done', false],
      ['That team change no longer exists', true],
    ]);
    await b.stop();
  });

  it('keeps polling after errors, says so, and stops cleanly', async () => {
    const { b, fake } = bot();
    fake.failNext(1);
    await b.setToken(TOKEN);
    await until(() => b.view().polling === 'retrying');
    expect(b.view().error).toMatch(/502/);
    fake.push({ update_id: 1, edited_message: {} }); // the next poll answers: reading works again
    await until(() => b.view().polling === 'ok');
    await b.stop();
    const polls = fake.calls.filter((c) => c.method === 'getUpdates').length;
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.calls.filter((c) => c.method === 'getUpdates').length).toBe(polls);
  });

  it('sends long messages in pieces with the buttons under the last, and forgets everything on Remove', async () => {
    const { b, fake, secretsFile } = bot();
    expect(await b.send('hi')).toMatch(/linked/);
    const { startUrl: url } = await b.setToken(TOKEN);
    fake.push({ ...text(42, `/start ${new URL(url).searchParams.get('start')}`), update_id: 1 });
    await until(() => b.linked());
    const before = fake.calls.length;
    expect(await b.send('x '.repeat(3000), teamKeyboard([{ id: 'r', name: 'Ana', kind: 'hire' }]))).toBeNull();
    const parts = fake.calls.slice(before).filter((c) => c.method === 'sendMessage');
    expect(parts.length).toBe(2);
    expect(parts.map((p) => !!p.params.reply_markup)).toEqual([false, true]);
    await b.remove();
    expect(b.view()).toMatchObject({ set: false, linked: false, polling: 'off' });
    expect(JSON.parse(fs.readFileSync(secretsFile, 'utf8')).telegram).toBeUndefined();
  });

  it('switched off: stops reading and retrying, sends nothing, keeps the chat; on again resumes without relinking (#126)', async () => {
    const switchOn = { on: true };
    const { b, fake, changes } = bot(switchOn);
    const { startUrl: url } = await b.setToken(TOKEN);
    fake.push({ ...text(42, `/start ${new URL(url).searchParams.get('start')}`), update_id: 1 });
    await until(() => b.linked());
    await until(() => b.view().okAt !== null);
    fake.failNext(1000); // Telegram down: the poll retries
    fake.push({ update_id: 2, edited_message: {} });
    await until(() => b.view().polling === 'retrying');

    switchOn.on = false;
    b.refresh();
    expect(b.view()).toMatchObject({ on: false, polling: 'off', error: '', advice: '', linked: true, chat: 'Ana' });
    await new Promise((r) => setTimeout(r, 20));
    const polls = () => fake.calls.filter((c) => c.method === 'getUpdates').length;
    const before = { polls: polls(), all: fake.calls.length };
    expect(await b.send('hi')).toMatch(/off/);
    expect(b.active()).toBe(false);
    expect(() => b.retryNow()).toThrow(/off/);
    await new Promise((r) => setTimeout(r, 1200)); // past the first backoff: nothing retries
    expect(fake.calls.length).toBe(before.all);

    fake.failNext(0);
    switchOn.on = true;
    const changesBefore = changes.n;
    b.refresh();
    expect(changes.n).toBeGreaterThan(changesBefore); // open tabs hear it's on again
    await until(() => polls() > before.polls);
    expect(b.view()).toMatchObject({ on: true, polling: 'ok', linked: true });
    expect(await b.send('back')).toBeNull();
    expect(fake.calls.filter((c) => c.method === 'sendMessage').at(-1)?.params.chat_id).toBe(42);
    await b.stop();
  });
});
