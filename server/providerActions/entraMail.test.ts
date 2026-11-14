// entra mail_app_ensure (#668) against the fake Graph and Exchange: the RBAC scope made over the listed shared mailboxes
// only, a send or read as any other mailbox refused (by the office and by Exchange), the KEEL tenant never touched,
// idempotent, the secret never in anything returned, its renewal; and Cloudflare's mail DNS checks and fixes.
import { describe, expect, it } from 'vitest';
import { fakeCloudflare } from '../demo/cloudflare.ts';
import { fakeProviderHttp } from '../demo/providerActions.ts';
import { readInbox, sendAs } from '../mail.ts';
import { RENEW_BEFORE_MS } from './entra.ts';
import { MAIL_ROLES, renewMailSecret, SCOPE_NAME } from './entraMail.ts';
import { applyAction, runAction } from './index.ts';
import type { ActionCtx, ActionKey, MailCred } from './types.ts';

const TIB = '7e57e57e-0000-4000-8000-00000000c1f0';
const KEEL = 'keelcorp.onmicrosoft.com';
const ADMIN = 'admin-client-id:admin-Secret~value-0001';
const BOXES = ['hello', 'sales', 'support'];

function setup(admin?: ActionKey[]) {
  const net = fakeProviderHttp();
  const cf = fakeCloudflare();
  let cred: MailCred | undefined;
  const mail = { get: () => cred, set: async (c: MailCred) => void (cred = c) };
  const base = { http: net.http, cloudflareApi: cf.api, boxes: null, mail };
  const entra: ActionCtx = { ...base, keys: admin ?? [{ id: 'adm', label: 'TIB admin', key: ADMIN, accountId: TIB, ok: true }] };
  const cloud: ActionCtx = { ...base, keys: [{ id: 'cf', label: 'Cloudflare', key: 'cf-live-token' }] };
  const outs: string[] = [];
  const act = async (ctx: ActionCtx, provider: string, op: string, args: Record<string, unknown> = {}) => {
    const out = await runAction(ctx, { provider, op, args });
    outs.push(JSON.stringify(out));
    if ('text' in out) return { text: out.text };
    if (out.plan.already) return { already: out.plan.already, diff: out.plan.diff };
    const r = await applyAction(ctx, out.plan.change);
    outs.push(JSON.stringify(r));
    return { diff: out.plan.diff, ...r };
  };
  const x = net.exchange.world;
  return { net, cf, x, entra, cloud, act, outs, cred: () => cred };
}

describe('entra mail_app_ensure (#668)', () => {
  it('makes the app, the missing shared mailboxes and an RBAC scope over exactly them, read back', async () => {
    const s = setup();
    const r = await s.act(s.entra, 'entra', 'mail_app_ensure', { mailboxes: BOXES });
    expect(r).toMatchObject({ ok: true, text: expect.stringContaining('can read and send as hello@techinsiderbytes.com, sales@techinsiderbytes.com, support@techinsiderbytes.com only') });
    expect(r.diff).toContain(`+ management scope "${SCOPE_NAME}"`);
    expect(s.x.scopes).toEqual([{ Name: SCOPE_NAME, RecipientRestrictionFilter: "PrimarySmtpAddress -eq 'hello@techinsiderbytes.com' -or PrimarySmtpAddress -eq 'sales@techinsiderbytes.com' -or PrimarySmtpAddress -eq 'support@techinsiderbytes.com'" }]);
    const app = s.cred()!.clientId;
    expect(s.x.assignments).toEqual(MAIL_ROLES.map((m) => ({ Name: m.name, Role: m.role, App: app, CustomResourceScope: SCOPE_NAME })));
    expect(s.x.mailboxes.filter((b) => b.RecipientTypeDetails === 'SharedMailbox').map((b) => b.PrimarySmtpAddress).sort()).toEqual(BOXES.map((b) => `${b}@techinsiderbytes.com`));
    expect(s.x.cmdlets.filter((c) => c === 'New-Mailbox')).toHaveLength(2); // hello@ was there already
    expect(s.cred()).toMatchObject({ tenant: TIB, mailboxes: BOXES.map((b) => `${b}@techinsiderbytes.com`), dkim: { selector1: expect.stringMatching(/^selector1-techinsiderbytes-com\._domainkey\./) } });
    expect(s.x.sps).toEqual([{ AppId: app, ObjectId: expect.any(String) }]);
    expect(s.x.dkimOn).toBe(true);
  });

  it('sends and reads only as the listed mailboxes: the office refuses others, and so does Exchange', async () => {
    const s = setup();
    await s.act(s.entra, 'entra', 'mail_app_ensure', { mailboxes: BOXES });
    const cred = s.cred()!;
    await sendAs(s.net.http, cred, 'sales@techinsiderbytes.com', { to: ['lead@example.com'], subject: 'Hi', text: 'Hello' });
    expect(s.x.sent).toEqual([{ mailbox: 'sales@techinsiderbytes.com', to: ['lead@example.com'], subject: 'Hi', text: 'Hello' }]);
    const before = s.net.calls.length;
    await expect(sendAs(s.net.http, cred, 'maro@techinsiderbytes.com', { to: ['x@example.com'], subject: 'Hi', text: 'x' })).rejects.toThrow(/isn't one of the mailboxes the office's mail app was set up for/);
    await expect(readInbox(s.net.http, cred, 'maro@techinsiderbytes.com')).rejects.toThrow(/isn't one of the mailboxes/);
    expect(s.net.calls.length).toBe(before); // refused before any network
    // and Exchange's scope refuses it even if the office's list were wrong
    const forged = { ...cred, mailboxes: [...cred.mailboxes, 'maro@techinsiderbytes.com'] };
    await expect(sendAs(s.net.http, forged, 'maro@techinsiderbytes.com', { to: ['x@example.com'], subject: 'Hi', text: 'x' })).rejects.toThrow(/Exchange refused it/);
    await expect(readInbox(s.net.http, forged, 'maro@techinsiderbytes.com')).rejects.toThrow(/Exchange refused it/);
    expect(s.x.sent).toHaveLength(1);
    s.net.exchange.deliver('support@techinsiderbytes.com', { from: 'Ana@Example.com', name: 'Ana', subject: 'Help', text: '<p>My clip <b>failed</b></p>' });
    expect(await readInbox(s.net.http, cred, 'support@techinsiderbytes.com')).toEqual([expect.objectContaining({ from: 'ana@example.com', fromName: 'Ana', subject: 'Help', text: 'My clip failed', read: false })]);
  });

  it('never touches a tenant that does not own the domain (KEEL), and never another mailbox', async () => {
    const s = setup([
      { id: 'keel', label: 'KEEL admin', key: 'keel-client:keel-secret-1', accountId: KEEL, ok: true },
      { id: 'adm', label: 'TIB admin', key: ADMIN, accountId: TIB },
    ]);
    const r = await s.act(s.entra, 'entra', 'mail_app_ensure', { mailboxes: BOXES });
    expect(r).toMatchObject({ ok: true });
    const keelCalls = s.net.calls.filter((c) => c.key.startsWith('keel-client') || c.url.includes(KEEL));
    expect(keelCalls.every((c) => c.method === 'GET' || c.auth === 'entra-token')).toBe(true); // a token and the domain read, nothing written
    expect(s.net.calls.filter((c) => c.url.includes('/adminapi/beta/')).every((c) => c.url.includes(`/${TIB}/`))).toBe(true);
    expect(s.cred()!.tenant).toBe(TIB);
    const only = setup([{ id: 'keel', label: 'KEEL admin', key: 'keel-client:keel-secret-1', accountId: KEEL }]);
    await expect(runAction(only.entra, { provider: 'entra', op: 'mail_app_ensure', args: { mailboxes: BOXES } })).rejects.toThrow(/"KEEL admin" lacks techinsiderbytes.com as a verified domain/);
    expect(only.x.cmdlets).toEqual([]);
  });

  it("refuses a person's mailbox, an address on another domain and a bad name", async () => {
    const s = setup();
    await expect(runAction(s.entra, { provider: 'entra', op: 'mail_app_ensure', args: { mailboxes: ['maro'] } })).rejects.toThrow(/maro@techinsiderbytes.com is a person's mailbox, not a shared one/);
    await expect(runAction(s.entra, { provider: 'entra', op: 'mail_app_ensure', args: { mailboxes: ['sales@keel.example'] } })).rejects.toThrow(/isn't a mailbox on techinsiderbytes.com/);
    await expect(runAction(s.entra, { provider: 'entra', op: 'mail_app_ensure', args: { mailboxes: ["x' -or Name -like '*"] } })).rejects.toThrow(/isn't a mailbox/);
    expect(s.x.cmdlets.filter((c) => !c.startsWith('Get-'))).toEqual([]);
  });

  it('changes nothing when run twice, and narrows the scope when a mailbox is dropped', async () => {
    const s = setup();
    await s.act(s.entra, 'entra', 'mail_app_ensure', { mailboxes: BOXES });
    const writes = s.x.cmdlets.filter((c) => !c.startsWith('Get-')).length;
    expect((await s.act(s.entra, 'entra', 'mail_app_ensure', { mailboxes: BOXES })).already).toMatch(/reaches hello@techinsiderbytes.com, sales@techinsiderbytes.com, support@techinsiderbytes.com only/);
    expect(s.x.cmdlets.filter((c) => !c.startsWith('Get-')).length).toBe(writes);
    const r = await s.act(s.entra, 'entra', 'mail_app_ensure', { mailboxes: ['sales'] });
    expect(r).toMatchObject({ ok: true });
    expect(s.x.scopes[0].RecipientRestrictionFilter).toBe("PrimarySmtpAddress -eq 'sales@techinsiderbytes.com'");
    await expect(sendAs(s.net.http, { ...s.cred()!, mailboxes: BOXES.map((b) => `${b}@techinsiderbytes.com`) }, 'hello@techinsiderbytes.com', { to: ['a@example.com'], subject: 's', text: 't' })).rejects.toThrow(/Exchange refused it/);
  });

  it('needs Exchange.ManageAsApp, and never shows a secret', async () => {
    const no = setup([{ id: 'adm', label: 'TIB admin', key: 'admin-noexo:secret-1', accountId: TIB }]);
    await expect(runAction(no.entra, { provider: 'entra', op: 'mail_app_ensure', args: { mailboxes: BOXES } })).rejects.toThrow(/Exchange.ManageAsApp/);
    const s = setup();
    await s.act(s.entra, 'entra', 'mail_app_ensure', { mailboxes: BOXES });
    await s.act(s.entra, 'entra', 'mail_app_ensure', { mailboxes: BOXES });
    const secrets = (s.net.world as unknown as { entra: { secrets: string[] } }).entra.secrets;
    expect(secrets).toHaveLength(1);
    for (const v of [...secrets, ADMIN.split(':')[1]]) expect(s.outs.join('\n')).not.toContain(v);
    expect(s.outs.join('\n')).not.toMatch(/graph-token-/);
  });

  it('renews the secret 30 days before it ends and removes the old one', async () => {
    const s = setup();
    await s.act(s.entra, 'entra', 'mail_app_ensure', { mailboxes: BOXES });
    const old = s.cred()!;
    expect(await renewMailSecret(s.entra, old.expiresAt - RENEW_BEFORE_MS - 1000)).toBeNull();
    const r = await renewMailSecret(s.entra, old.expiresAt - 1000);
    expect(r).toMatchObject({ ok: true, text: expect.stringMatching(/^Renewed the mail app's client secret \(ends .*\) and removed the old one\.$/) });
    expect(s.cred()!.keyId).not.toBe(old.keyId);
    expect(s.cred()!.mailboxes).toEqual(old.mailboxes);
    expect(JSON.stringify(r)).not.toContain(s.cred()!.secret);
    await sendAs(s.net.http, s.cred()!, 'hello@techinsiderbytes.com', { to: ['a@example.com'], subject: 's', text: 't' });
  });
});

describe('cloudflare mail_dns_check / mail_dns_ensure (#668)', () => {
  it("checks SPF, DKIM and DMARC and fixes them on one card, keeping the zone's other SPF senders", async () => {
    const s = setup();
    const before = await s.act(s.cloud, 'cloudflare', 'mail_dns_check');
    expect(before.text).toContain("✗ DKIM: Exchange's DKIM selectors aren't known yet");
    await s.act(s.entra, 'entra', 'mail_app_ensure', { mailboxes: BOXES });
    const check = await s.act(s.cloud, 'cloudflare', 'mail_dns_check');
    expect(check.text).toMatch(/✗ SPF: Missing include:spf.protection.outlook.com[\s\S]*✗ DMARC[\s\S]*✗ DKIM: 2 DKIM selector CNAMEs/);
    const fix = await s.act(s.cloud, 'cloudflare', 'mail_dns_ensure');
    expect(fix.diff).toContain('~ TXT techinsiderbytes.com "v=spf1 include:_spf.google.com include:spf.protection.outlook.com ~all"');
    expect(fix.diff).toContain('+ TXT _dmarc.techinsiderbytes.com "v=DMARC1; p=none; rua=mailto:hello@techinsiderbytes.com"');
    expect(fix).toMatchObject({ ok: true, text: expect.stringContaining('✓ SPF') });
    expect(fix.text).not.toContain('✗');
    expect((await s.act(s.cloud, 'cloudflare', 'mail_dns_ensure')).already).toContain('✓ DKIM: Both DKIM selectors point at Exchange.');
  });
});
