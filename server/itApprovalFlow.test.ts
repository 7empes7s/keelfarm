import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';
import { HOME_DIR } from './config.ts';
import type { OfficeTools } from './ceo.ts';
import type { NotifyRequest } from './notifier.ts';
import type { ServerEvent } from '../shared/types.ts';
import { DEFAULT_NOTIFY } from '../shared/notify.ts';
import { GRACE_MS, THREAD_GAP_MS } from './notify.ts';
import { DEMO_REPO, fakeProviderHttp } from './demo/providerActions.ts';

vi.mock('./config.ts', async (original) => {
  const config = await original<typeof import('./config.ts')>();
  return { ...config, HOME_DIR: path.join(config.HOME_DIR, 'it-approval-flow') };
});

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function office(push = true) {
  await fs.mkdir(HOME_DIR, { recursive: true });
  const logs: string[] = [];
  vi.spyOn(console, 'warn').mockImplementation((s) => void logs.push(String(s)));
  const backend = createDemoBackend();
  backend.providerHttp = fakeProviderHttp().http;
  const sends: NotifyRequest[] = [];
  let status = 201;
  backend.notify = { post: async (r) => { sends.push(r); return status; } };
  const swarm = new Swarm(backend);
  const o = swarm as unknown as { itTools(): OfficeTools; broadcast(e: ServerEvent): void; ensureCeo(a: unknown[]): void };
  o.ensureCeo([]);
  const events: ServerEvent[] = [];
  vi.spyOn(o, 'broadcast').mockImplementation((e) => void events.push(e));
  await swarm.notifier.init();
  for (const d of swarm.notifier.channelsView().devices) await swarm.notifier.removeDevice(d.id);
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  if (push) {
    await swarm.notifier.pushKey();
    await swarm.notifier.subscribe({ endpoint: 'https://push.example.test/mock', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } });
  }
  swarm.updateSettings({ itDept: { ...swarm.snapshot().settings.itDept, autoApprove: 'off' }, notify: { ...DEFAULT_NOTIFY, quietInApp: false, channels: { desktop: true, push: true, telegram: false, ntfy: false } } });
  await swarm.providers.add('github', 'ghp_mock_key_4242424242', 'Mock');
  vi.useFakeTimers({ toFake: ['Date'] });
  const propose = () => o.itTools().call('it_propose', { argv: ['journalctl', '--vacuum-size=500M'], why: 'private reason', affects: 'private path', undo: 'private argument', risk: 'low' });
  const flush = async () => {
    vi.setSystemTime(Date.now() + THREAD_GAP_MS + GRACE_MS + 1);
    swarm.notifier.flush();
    await new Promise((resolve) => setTimeout(resolve, 20));
  };
  return { swarm, o, sends, events, logs, propose, flush, payload: (r: NotifyRequest) => decrypt(r.body as Buffer, ua, auth), fail: () => { status = 503; } };
}

// Decrypt as the subscribed device would, checking the actual transport payload rather than its log text.
function decrypt(body: Buffer, ua: ReturnType<typeof crypto.createECDH>, auth: Buffer) {
  const salt = body.subarray(0, 16), end = 21 + body[20];
  const sender = body.subarray(21, end);
  const ikm = crypto.hkdfSync('sha256', ua.computeSecret(sender), auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), sender]), 32);
  const key = crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const decipher = crypto.createDecipheriv('aes-128-gcm', Buffer.from(key), Buffer.from(nonce));
  decipher.setAuthTag(body.subarray(-16));
  const plain = Buffer.concat([decipher.update(body.subarray(end, -16)), decipher.final()]);
  return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString('utf8'));
}

describe('pending IT approval notifications', () => {
  it('creates an in-app notice, hands off one safe push, dedups retries/snapshots, and notifies a later request', async () => {
    const { swarm, sends, events, propose, flush, payload } = await office();
    await propose();
    const [card] = swarm.snapshot().itDesk!.waiting;
    const notice = swarm.snapshot().notices.find((n) => n.id === card.id)!;
    expect(notice).toMatchObject({ kind: 'it', requestId: card.id, title: 'IT approval needed' });
    expect(notice.text).toContain('clear old system logs');
    expect(events.some((e) => e.type === 'toast' && e.id === card.id)).toBe(true);
    expect(await propose()).toMatch(/Refused: .*already waits/);
    swarm.snapshot(); swarm.snapshot();
    await flush();
    expect(sends).toHaveLength(1);
    expect(sends[0].channel).toBe('push');
    expect(payload(sends[0])).toMatchObject({ title: '⚠️ IT approval needed', body: notice.text, url: `/?tab=approvals&note=${card.id}` });
    expect(sends[0].text).not.toMatch(/500M|private/);
    const delivered = events.flatMap((e) => e.type === 'notify' ? [e.note] : []);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ event: 'needsHuman', url: `/?tab=approvals&note=${card.id}` });
    expect(swarm.notifier.channelsView().devices[0].last).toMatchObject({ ok: true });
    swarm.itDismiss([card.id]);
    await propose();
    expect(swarm.snapshot().itDesk!.waiting[0].id).not.toBe(card.id);
    await flush();
    expect(sends).toHaveLength(2);
  });

  it('covers provider cards while automatic actions do not ask for approval', async () => {
    const { swarm, o, sends, flush } = await office();
    const call = (op: string, args: object) => o.itTools().call('provider_action', { provider: 'github', op, args: { repo: DEMO_REPO, ...args } });
    swarm.updateSettings({ itDept: { ...swarm.snapshot().settings.itDept, autoApprove: 'routine' } });
    await call('run_rerun', { run_id: 4242 });
    await flush();
    expect(sends).toHaveLength(0);
    await call('repo_settings', { delete_branch_on_merge: true });
    await flush();
    expect(sends).toHaveLength(1);
    expect(sends[0].text).toContain('change merge settings');
    expect(sends[0].text).not.toContain(DEMO_REPO);
  });

  it('keeps the in-app alert when approval notifications are off and diagnoses the preference', async () => {
    const { swarm, sends, logs, propose, flush } = await office();
    const notify = swarm.snapshot().settings.notify;
    swarm.updateSettings({ notify: { ...notify, events: { ...notify.events, needsHuman: false } } });
    await propose(); await flush();
    expect(sends).toHaveLength(0);
    expect(swarm.snapshot().notices.some((n) => n.title === 'IT approval needed')).toBe(true);
    expect(logs.join('\n')).toContain('approval notifications are disabled');
  });

  it.each(['disabled', 'unsubscribed', 'failed'] as const)('distinguishes %s push from accepted delivery', async (mode) => {
    const { swarm, sends, logs, propose, flush, fail } = await office(mode !== 'unsubscribed');
    if (mode === 'disabled') {
      const notify = swarm.snapshot().settings.notify;
      swarm.updateSettings({ notify: { ...notify, channels: { ...notify.channels, push: false } } });
    }
    if (mode === 'failed') fail();
    await propose(); await flush();
    expect(sends).toHaveLength(mode === 'failed' ? 1 : 0);
    expect(logs.join('\n')).toContain(mode === 'disabled' ? 'push is disabled' : mode === 'unsubscribed' ? 'no subscribed device' : 'Push failed:');
    if (mode === 'failed') expect(swarm.notifier.channelsView().devices[0].last).toMatchObject({ ok: false });
  });
});
