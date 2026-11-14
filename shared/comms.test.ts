import { describe, expect, it } from 'vitest';
import { defaultComms, hasUnsubscribe, isUnsubscribeRequest, loadComms, mailboxAddress, makeDraft, mergeInbox, outreachCap, recordSent, countOutreach, sendCheck, upsertLead, type CommsState, type Incoming } from './comms';

const D = 'techinsiderbytes.com';
const NOW = Date.parse('2026-11-14T10:00:00Z');
const DAY = 86_400_000;

const inbox = (s: CommsState, mailbox: string, m: Partial<Incoming> & { from: string }) =>
  mergeInbox(s, mailbox, [{ id: `m${Math.random()}`, threadId: m.threadId ?? `t-${m.from}`, to: [mailbox], subject: 'Hello', text: 'Hi there', at: NOW, read: false, ...m }], NOW);

describe('the mailbox scope (#668)', () => {
  it('drafts and sends only as a listed shared mailbox', () => {
    const s = defaultComms();
    expect(() => makeDraft(s, { mailbox: `maro@${D}`, to: ['a@example.com'], subject: 'Hi', text: 'x' }, 'Mimoun', NOW)).toThrow(/isn't one of the office's shared mailboxes/);
    const d = makeDraft(s, { mailbox: `sales@${D}`, to: ['a@example.com'], subject: 'Hi', text: 'x' }, 'Mimoun', NOW);
    expect(sendCheck(s, d, NOW)).toEqual({ ok: true, auto: false });
    expect(sendCheck(s, { ...d, mailbox: `maro@${D}` }, NOW)).toMatchObject({ ok: false, why: expect.stringContaining("isn't one of the office's shared mailboxes") });
    expect(sendCheck(s, { ...d, mailbox: 'sales@other.example' }, NOW)).toMatchObject({ ok: false });
  });

  it('reads a mailbox name strictly, so nothing else reaches the Exchange filter', () => {
    expect(mailboxAddress('Sales', D)).toBe(`sales@${D}`);
    expect(mailboxAddress(`support@${D}`, D)).toBe(`support@${D}`);
    for (const bad of ['sales@keel.example', "x' -or Name -like '*", 'a b', '']) expect(() => mailboxAddress(bad, D)).toThrow();
  });
});

describe('sending needs the manager unless an auto rule matches (#668)', () => {
  it('auto-sends only replies from a mailbox whose auto-replies are on', () => {
    const s = defaultComms();
    inbox(s, `support@${D}`, { from: 'ana@example.com', threadId: 't1' });
    const reply = makeDraft(s, { threadId: 't1', text: 'On it.' }, 'Ada', NOW);
    expect(reply).toMatchObject({ mailbox: `support@${D}`, to: ['ana@example.com'], subject: 'Re: Hello' });
    expect(sendCheck(s, reply, NOW)).toEqual({ ok: true, auto: false });
    s.settings.mailboxes.find((m) => m.address === `support@${D}`)!.autoReplies = true;
    expect(sendCheck(s, reply, NOW)).toEqual({ ok: true, auto: true });
    const fresh = makeDraft(s, { mailbox: `support@${D}`, to: ['bo@example.com'], subject: 'News', text: 'x' }, 'Ada', NOW);
    expect(sendCheck(s, fresh, NOW)).toEqual({ ok: true, auto: false }); // a new email always waits
    const post = makeDraft(s, { channel: 'social', text: 'New feature!' }, 'Ada', NOW);
    expect(sendCheck(s, post, NOW)).toEqual({ ok: true, auto: false });
  });
});

describe('unsubscribe and suppression (#668)', () => {
  it('puts the unsubscribe line on every new email, not on replies, and refuses outreach without it', () => {
    const s = defaultComms();
    const d = makeDraft(s, { mailbox: `hello@${D}`, to: ['lea@kitchenlab.tv'], template: 'intro' }, 'Mimoun', NOW);
    expect(hasUnsubscribe(d.text, `hello@${D}`)).toBe(true);
    expect(d.text).toContain('Hello · Tech Insider Bytes'); // the signature
    expect(sendCheck(s, { ...d, text: 'Hi, buy now' }, NOW)).toEqual({ ok: false, why: 'Outreach needs its unsubscribe line: keep the last paragraph.' });
    inbox(s, `support@${D}`, { from: 'ana@example.com', threadId: 't1' });
    expect(hasUnsubscribe(makeDraft(s, { threadId: 't1', text: 'Sure' }, 'Ada', NOW).text, `support@${D}`)).toBe(false);
  });

  it('suppresses whoever replies unsubscribe and refuses outreach to them, but still answers them', () => {
    const s = defaultComms();
    upsertLead(s, { email: 'paul@example.com', name: 'Paul', stage: 'contacted' });
    inbox(s, `hello@${D}`, { from: 'Paul@Example.com', subject: 'Re: Short clips', text: 'unsubscribe\n\n> old text', threadId: 't9' });
    expect(s.suppressed.map((x) => x.email)).toEqual(['paul@example.com']);
    expect(s.leads[0].stage).toBe('lost');
    const out = makeDraft(s, { mailbox: `sales@${D}`, to: ['paul@example.com'], subject: 'Again', text: 'x' }, 'Mimoun', NOW);
    expect(sendCheck(s, out, NOW)).toEqual({ ok: false, why: 'paul@example.com asked not to be emailed (suppression list).' });
    expect(sendCheck(s, makeDraft(s, { threadId: 't9', text: 'Done, you are off the list.' }, 'Mimoun', NOW), NOW)).toEqual({ ok: true, auto: false });
  });

  it('tells an unsubscribe request from a message that mentions it', () => {
    expect(isUnsubscribeRequest({ subject: 'Unsubscribe', text: '' })).toBe(true);
    expect(isUnsubscribeRequest({ subject: 'Re: hi', text: 'STOP' })).toBe(true);
    expect(isUnsubscribeRequest({ subject: 'Question', text: 'How do I unsubscribe my team from your newsletter and keep the clips?' })).toBe(false);
  });
});

describe('warm-up (#668)', () => {
  it('caps outreach at 20 a day the first week, doubling weekly up to the setting', () => {
    expect(outreachCap(0, NOW, 200)).toBe(20);
    expect(outreachCap(NOW, NOW + 6 * DAY, 200)).toBe(20);
    expect(outreachCap(NOW, NOW + 7 * DAY, 200)).toBe(40);
    expect(outreachCap(NOW, NOW + 30 * DAY, 200)).toBe(200);
    const s = defaultComms();
    for (let i = 0; i < 20; i++) {
      const d = makeDraft(s, { mailbox: `hello@${D}`, to: [`p${i}@example.com`], subject: 'Hi', text: 'x' }, 'M', NOW);
      expect(sendCheck(s, d, NOW).ok).toBe(true);
      countOutreach(s, d, NOW);
      recordSent(s, d, NOW);
    }
    const one = makeDraft(s, { mailbox: `hello@${D}`, to: ['late@example.com'], subject: 'Hi', text: 'x' }, 'M', NOW);
    expect(sendCheck(s, one, NOW)).toMatchObject({ ok: false, why: expect.stringContaining("Today's outreach cap is reached (20 a day") });
    expect(sendCheck(s, one, NOW + DAY)).toMatchObject({ ok: true });
  });
});

describe('the inbox and leads (#668)', () => {
  it('threads messages, labels support and sales, and adds a new sales enquiry as a lead', () => {
    const s = defaultComms();
    inbox(s, `sales@${D}`, { from: 'jonas@northwind.lu', fromName: 'Jonas Weber', threadId: 'c1' });
    inbox(s, `sales@${D}`, { from: 'jonas@northwind.lu', threadId: 'c1', at: NOW + 1000 });
    inbox(s, `support@${D}`, { from: 'sam@creator.io', threadId: 'c2' });
    expect(s.threads.map((t) => [t.id, t.label, t.messages.length])).toEqual([['c1', 'lead', 2], ['c2', 'support', 1]]);
    expect(s.leads).toEqual([expect.objectContaining({ email: 'jonas@northwind.lu', name: 'Jonas Weber', source: 'mail', stage: 'new' })]);
  });

  it('loads saved state defensively', () => {
    expect(loadComms(null).settings.mailboxes.map((m) => m.address)).toEqual([`hello@${D}`, `sales@${D}`, `support@${D}`]);
    expect(loadComms({ settings: { mailboxes: [{ address: 'not an email' }], dailyOutreach: -3 }, threads: [null, 4] })).toMatchObject({ threads: [], settings: { dailyOutreach: 200 } });
  });
});
