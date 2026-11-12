import { describe, expect, it } from 'vitest';
import { DEFAULT_NOTIFY, noteTab, notifySettings, officeUrl, phoneReach } from './notify.ts';

describe('notification settings', () => {
  it('start with every event but merges on, on every channel', () => {
    expect(notifySettings(DEFAULT_NOTIFY, undefined)).toEqual(DEFAULT_NOTIFY);
    expect(DEFAULT_NOTIFY.events.merge).toBe(false);
    expect(Object.values(DEFAULT_NOTIFY.channels).every(Boolean)).toBe(true);
  });

  it('take a patch field by field and ignore anything else', () => {
    const s = notifySettings(DEFAULT_NOTIFY, { events: { merge: true, ceoMessage: 'yes', bogus: true }, channels: { ntfy: false, slack: true }, officeUrl: ' https://office.tail1234.ts.net ' });
    expect(s.events).toEqual({ ...DEFAULT_NOTIFY.events, merge: true });
    expect(s.channels).toEqual({ ...DEFAULT_NOTIFY.channels, ntfy: false });
    expect(s.officeUrl).toBe('https://office.tail1234.ts.net/');
    expect(notifySettings(s, { officeUrl: 'javascript:alert(1)' }).officeUrl).toBe('https://office.tail1234.ts.net/');
    expect(notifySettings(s, { officeUrl: '' }).officeUrl).toBe('');
    // An older saved state without the newer fields gets their defaults.
    expect(notifySettings(DEFAULT_NOTIFY, { events: { needsHuman: false } }).events.usage).toBe(true);
  });

  it('accept only http(s) office URLs', () => {
    expect(officeUrl('http://localhost:4317')).toBe('http://localhost:4317/');
    expect(officeUrl('ftp://x')).toBeNull();
    expect(officeUrl('not a url')).toBeNull();
    expect(officeUrl(42)).toBeNull();
    expect(officeUrl('  ')).toBe('');
  });

  it('open the pocket tab that fits the event', () => {
    expect(noteTab('needsHuman')).toBe('approvals');
    expect(noteTab('hire')).toBe('approvals');
    expect(noteTab('ceoMessage')).toBe('chat');
    expect(noteTab('agentError')).toBe('team');
    expect(noteTab('merge')).toBe('company');
  });
});

describe('what reaches the phone with the office closed (#538)', () => {
  const none = { pushDevices: 0, telegram: { linked: false }, webhooks: { ntfy: { set: false } } } as Parameters<typeof phoneReach>[0];
  it('counts push devices, a linked Telegram and ntfy, each only while it is on, and never desktop', () => {
    expect(phoneReach(none, DEFAULT_NOTIFY)).toEqual([]);
    const all = { pushDevices: 1, telegram: { linked: true }, webhooks: { ntfy: { set: true } } } as Parameters<typeof phoneReach>[0];
    expect(phoneReach(all, DEFAULT_NOTIFY)).toEqual(['push', 'Telegram', 'ntfy']);
    expect(phoneReach(all, notifySettings(DEFAULT_NOTIFY, { channels: { push: false, ntfy: false } }))).toEqual(['Telegram']);
  });
});
