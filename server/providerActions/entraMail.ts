// entra mail_app_ensure (#668): the office's own mail app for its shared mailboxes, made with the admin app credential
// from Settings → Providers. It works only in the tenant that owns the domain (techinsiderbytes.com by default): a
// tenant without it (KEEL's) is skipped untouched. The app gets no tenant-wide Graph mail permission; Exchange's RBAC
// for Applications gives it Mail.Send and Mail.ReadWrite over a management scope that names the listed shared
// mailboxes and nothing else (learn.microsoft.com/exchange/permissions-exo/application-rbac). Missing shared mailboxes
// are made. Exchange's cmdlets run through its admin API (InvokeCommand) with the same admin app. The client secret
// goes straight into the office's key store (ctx.mail) and is renewed 30 days before it ends; it is never returned.
import { z } from 'zod';
import { mailboxAddress } from '../../shared/comms.ts';
import { findApp, get, graphCall, GRAPH, GRAPH_APP, q, removeSecret, renewDue, SECRET_MS, send, spOf, type GraphApp } from './entra.ts';
import { ActionError, expectOk, keyById, withKeys, type ActionCtx, type ActionKey, type ActionPlan, type Call, type MailCred, type ProviderModule } from './types.ts';

const NAME = 'Microsoft Entra';
const EXO_SCOPE = 'https://outlook.office365.com/.default';
export const SCOPE_NAME = 'cubefarm shared mailboxes';
/** Exchange's application roles, and the role assignment the office names after each. */
export const MAIL_ROLES = [
  { role: 'Application Mail.Send', name: 'cubefarm mail send' },
  { role: 'Application Mail.ReadWrite', name: 'cubefarm mail readwrite' },
];
/** Graph's Mail.Send / Mail.ReadWrite / Mail.Read application permissions: granted tenant-wide they'd bypass the scope. */
const GRAPH_MAIL_ROLES = new Set(['b633e1c5-b582-4048-a93e-9f11b44c7e96', 'e2a3a72e-5f79-4c64-b1b1-878b674786c9', '810c84a8-4a9e-49e6-bf7d-12d183f40d01']);
const PERM_EXO = 'Exchange.ManageAsApp (application permission) with the Exchange Administrator role';
const PERM_DOMAIN = 'Domain.Read.All (application permission)';

type ExoBox = { PrimarySmtpAddress: string; RecipientTypeDetails: string };
type ExoScope = { Name: string; RecipientRestrictionFilter: string };
type ExoAssignment = { Name: string; Role: string; CustomResourceScope?: string; App?: string };
type ExoSp = { AppId: string; ObjectId?: string };
type RoleAssignment = { id: string; resourceId: string; appRoleId: string };

/** One Exchange cmdlet through its admin API; its result rows. */
async function exo<T>(x: Call, tenant: string, cmdlet: string, params: Record<string, unknown> = {}): Promise<T[]> {
  const b = await expectOk<{ value?: T[] }>(x, { method: 'POST', url: `https://outlook.office365.com/adminapi/beta/${tenant}/InvokeCommand`, auth: 'bearer', body: { CmdletInput: { CmdletName: cmdlet, Parameters: params } } }, PERM_EXO, 'Exchange Online');
  return b?.value ?? [];
}

/** The scope's filter: exactly the listed addresses (checked as plain local@domain, so nothing else gets in). */
const scopeFilter = (mailboxes: readonly string[]) => [...mailboxes].sort().map((m) => `PrimarySmtpAddress -eq '${m}'`).join(' -or ');

const cleanName = (n: unknown) => {
  const s = String(n ?? 'cubefarm Mail').trim() || 'cubefarm Mail';
  if (!/^[\w .()-]{1,80}$/.test(s)) throw new ActionError(`"${s}" isn't an app name like "cubefarm Mail".`);
  return s;
};

/** The tenant must own the domain: any other (KEEL's) is turned away before anything is read or written in it. */
async function ownsDomain(g: Call, domain: string, tenant: string) {
  const r = await g({ method: 'GET', url: `${GRAPH}/domains/${q(domain)}`, auth: 'bearer' });
  if (r.status === 401 || r.status === 403) throw new ActionError(`The key lacks ${PERM_DOMAIN}.`, PERM_DOMAIN);
  if (r.status === 0) throw new ActionError(`Couldn't reach ${NAME}.`);
  if (r.status >= 400 || !(r.body as { isVerified?: boolean } | undefined)?.isVerified) throw new ActionError(`Tenant ${tenant} doesn't own ${domain}: it is left alone.`, `${domain} as a verified domain`);
}

/** Both tokens for a key whose tenant owns the domain. */
async function calls(ctx: ActionCtx, call: Call, k: ActionKey, domain: string) {
  const { g, tenant } = await graphCall(ctx, call, k);
  await ownsDomain(g, domain, tenant);
  const { g: x } = await graphCall(ctx, call, k, EXO_SCOPE);
  return { g, x, tenant };
}

async function state(g: Call, x: Call, tenant: string, name: string, mailboxes: string[], stored?: MailCred) {
  const app = await findApp(g, name, stored);
  const sp = app ? await spOf(g, app.appId) : undefined;
  const graphSp = await spOf(g, GRAPH_APP);
  const wide = sp && graphSp ? ((await get<{ value?: RoleAssignment[] }>(g, `/servicePrincipals/${sp.id}/appRoleAssignments`)).value ?? []).filter((r) => r.resourceId === graphSp.id && GRAPH_MAIL_ROLES.has(r.appRoleId)) : [];
  const boxes = await exo<ExoBox>(x, tenant, 'Get-Mailbox', { Filter: scopeFilter(mailboxes) });
  const exoSp = app ? (await exo<ExoSp>(x, tenant, 'Get-ServicePrincipal')).find((s) => s.AppId === app.appId) : undefined;
  const scope = (await exo<ExoScope>(x, tenant, 'Get-ManagementScope')).find((s) => s.Name === SCOPE_NAME);
  const assigned = (await exo<ExoAssignment>(x, tenant, 'Get-ManagementRoleAssignment')).filter((a) => MAIL_ROLES.some((r) => r.name === a.Name && r.role === a.Role) && a.CustomResourceScope === SCOPE_NAME && (!app || !a.App || a.App === app.appId));
  const box = (m: string) => boxes.find((b) => b.PrimarySmtpAddress.toLowerCase() === m);
  return { app, sp, wide, box, exoSp, scope, assigned };
}

const secretOk = (app: GraphApp, c: MailCred | undefined, tenant: string, now: number) => !!c && c.tenant === tenant && c.appObjectId === app.id && (app.passwordCredentials ?? []).some((p) => p.keyId === c.keyId) && !renewDue(c, now);

function args(a: { mailboxes?: unknown; domain?: unknown; name?: unknown }) {
  const domain = String(a.domain ?? 'techinsiderbytes.com').trim().toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) throw new ActionError(`"${domain}" isn't a domain like techinsiderbytes.com.`);
  let mailboxes: string[];
  try {
    mailboxes = [...new Set((a.mailboxes as string[]).map((m) => mailboxAddress(m, domain)))];
  } catch (err) {
    throw new ActionError((err as Error).message);
  }
  return { domain, mailboxes, name: cleanName(a.name) };
}

/** mail_app_ensure's plan: what the app, the mailboxes and the scope lack; nothing written. */
async function planMail(ctx: ActionCtx, a: Record<string, unknown>, now = Date.now()): Promise<ActionPlan> {
  const { domain, mailboxes, name } = args(a);
  return withKeys(ctx, NAME, async (call, k) => {
    const { g, x, tenant } = await calls(ctx, call, k, domain);
    const s = await state(g, x, tenant, name, mailboxes, ctx.mail?.get());
    const person = mailboxes.filter((m) => s.box(m) && s.box(m)!.RecipientTypeDetails !== 'SharedMailbox');
    if (person.length) throw new ActionError(`${person.join(', ')} ${person.length > 1 ? 'are' : 'is'} a person's mailbox, not a shared one: pick other names.`);
    const filter = scopeFilter(mailboxes);
    const scopeOk = s.scope?.RecipientRestrictionFilter === filter;
    const missingRoles = MAIL_ROLES.filter((r) => !s.assigned.some((x) => x.Name === r.name));
    const secret = !!s.app && secretOk(s.app, ctx.mail?.get(), tenant, now);
    const mark = (ok: boolean) => (ok ? ' ' : '+');
    const lines = [
      `${mark(!!s.app)} app "${name}"${s.app ? ` (${s.app.appId})` : ''} in tenant ${tenant} (owns ${domain}), with no tenant-wide mail permission`,
      `${mark(!!s.sp)}   its enterprise app (service principal)`,
      ...s.wide.map(() => '-   a tenant-wide Graph mail permission on it (it would reach every mailbox)'),
      `${mark(secret)}   a client secret (24 months), straight into the office's key store (not shown)`,
      ...mailboxes.map((m) => `${mark(!!s.box(m))} shared mailbox ${m}`),
      `${mark(!!s.exoSp)} Exchange service principal for the app`,
      `${mark(scopeOk)} management scope "${SCOPE_NAME}": ${filter}`,
      ...MAIL_ROLES.map((r) => `${mark(!missingRoles.includes(r))}   role assignment "${r.name}": ${r.role} over that scope only`),
    ];
    const done = !!s.app && !!s.sp && !s.wide.length && secret && mailboxes.every((m) => s.box(m)) && !!s.exoSp && scopeOk && !missingRoles.length;
    return {
      change: { provider: 'entra', op: 'mail_app_ensure', keyId: k.id, data: { name, tenant, domain, mailboxes } },
      summary: `lets the office read and send mail as ${mailboxes.join(', ')} only (tenant ${tenant})`,
      diff: `Microsoft Entra + Exchange Online:\n${lines.join('\n')}`,
      argv: ['entra', 'mail_app_ensure', ...mailboxes],
      undo: `Exchange: Remove-ManagementRoleAssignment "${MAIL_ROLES[0].name}" and "${MAIL_ROLES[1].name}", Remove-ManagementScope "${SCOPE_NAME}"; Entra: delete the app "${name}" (docs/comms.md). The shared mailboxes stay.`,
      ...(done && { already: `The office's mail app "${name}" reaches ${mailboxes.join(', ')} only, its secret in the office's key store.` }),
    };
  });
}

/** Approve on mail_app_ensure: each part made, the secret stored, the scope read back. Never throws. */
async function applyMail(ctx: ActionCtx, keyId: string, d: { name: string; tenant: string; domain: string; mailboxes: string[] }, now = Date.now()) {
  const k = keyById(ctx, NAME, keyId);
  if (!('key' in k)) return k;
  try {
    const call: Call = (req) => ctx.http(k.key, req);
    const { g, x, tenant } = await calls(ctx, call, k, d.domain);
    if (tenant !== d.tenant) return { ok: false, text: `The ${NAME} connection's tenant changed since this card: ask for it again.` };
    const stored = ctx.mail?.get();
    let s = await state(g, x, tenant, d.name, d.mailboxes, stored);
    const app = s.app ?? (await send<GraphApp>(g, 'POST', '/applications', { displayName: d.name, signInAudience: 'AzureADMyOrg' }));
    const sp = s.sp ?? (await send<{ id: string }>(g, 'POST', '/servicePrincipals', { appId: app.appId }));
    for (const w of s.wide) await g({ method: 'DELETE', url: `${GRAPH}/servicePrincipals/${sp.id}/appRoleAssignments/${w.id}`, auth: 'bearer' });
    for (const m of d.mailboxes.filter((m) => !s.box(m))) {
      const local = m.split('@')[0];
      await exo(x, tenant, 'New-Mailbox', { Shared: true, Name: local, Alias: local, DisplayName: local.charAt(0).toUpperCase() + local.slice(1), PrimarySmtpAddress: m });
    }
    if (!s.exoSp) await exo(x, tenant, 'New-ServicePrincipal', { AppId: app.appId, ObjectId: sp.id, DisplayName: d.name });
    const filter = scopeFilter(d.mailboxes);
    if (!s.scope) await exo(x, tenant, 'New-ManagementScope', { Name: SCOPE_NAME, RecipientRestrictionFilter: filter });
    else if (s.scope.RecipientRestrictionFilter !== filter) await exo(x, tenant, 'Set-ManagementScope', { Identity: SCOPE_NAME, RecipientRestrictionFilter: filter });
    for (const r of MAIL_ROLES.filter((r) => !s.assigned.some((a) => a.Name === r.name))) await exo(x, tenant, 'New-ManagementRoleAssignment', { Name: r.name, App: app.appId, Role: r.role, CustomResourceScope: SCOPE_NAME });
    const dkim = (await exo<{ Selector1CNAME?: string; Selector2CNAME?: string; Enabled?: boolean }>(x, tenant, 'Get-DkimSigningConfig', { Identity: d.domain }).catch(() => []))[0];
    // DKIM signing on once its CNAMEs resolve (after cloudflare mail_dns_ensure); Exchange refuses it before, which is fine
    if (dkim && dkim.Enabled === false) await exo(x, tenant, 'Set-DkimSigningConfig', { Identity: d.domain, Enabled: true }).catch(() => undefined);
    const keep = { domain: d.domain, mailboxes: d.mailboxes, ...(dkim?.Selector1CNAME && dkim.Selector2CNAME && { dkim: { selector1: dkim.Selector1CNAME, selector2: dkim.Selector2CNAME } }) };
    if (!secretOk(app, stored, tenant, now)) {
      const r = await send<{ keyId?: string; secretText?: string; endDateTime?: string }>(g, 'POST', `/applications/${app.id}/addPassword`, { passwordCredential: { displayName: 'cubefarm: shared mailboxes', endDateTime: new Date(now + SECRET_MS).toISOString() } });
      if (!r.keyId || !r.secretText) throw new ActionError("Microsoft Graph made a secret but didn't return it: run mail_app_ensure again.");
      await ctx.mail?.set({ tenant, appObjectId: app.id, clientId: app.appId, keyId: r.keyId, secret: r.secretText, expiresAt: r.endDateTime ? Date.parse(r.endDateTime) : now + SECRET_MS, ...keep });
    } else await ctx.mail?.set({ ...stored!, ...keep });
    s = await state(g, x, tenant, d.name, d.mailboxes, ctx.mail?.get());
    const ok = !!s.app && !s.wide.length && d.mailboxes.every((m) => s.box(m)?.RecipientTypeDetails === 'SharedMailbox') && s.scope?.RecipientRestrictionFilter === filter && MAIL_ROLES.every((r) => s.assigned.some((a) => a.Name === r.name)) && ctx.mail?.get()?.clientId === app.appId;
    return { ok, text: ok ? `Read back: the mail app "${d.name}" (client ${app.appId}) can read and send as ${d.mailboxes.join(', ')} only, through the Exchange scope "${SCOPE_NAME}"; its secret is in the office's key store (renewed 30 days before it ends). Next: cloudflare mail_dns_check.` : `Read back, but the mail app isn't complete: run mail_app_ensure again.` };
  } catch (err) {
    return { ok: false, text: (err as Error).message };
  }
}

/** The mail app's secret renewed 30 days before it ends: a new one stored, then the old removed. Never throws; no secret in the text. */
export async function renewMailSecret(ctx: ActionCtx, now = Date.now()): Promise<{ ok: boolean; text: string } | null> {
  const c = ctx.mail?.get();
  if (!c || !renewDue(c, now)) return null;
  const k = ctx.keys.find((x) => (x.accountId ?? '').trim().toLowerCase() === c.tenant);
  if (!k) return { ok: false, text: `The mail app's secret ends ${new Date(c.expiresAt).toISOString().slice(0, 10)} and no ${NAME} connection for tenant ${c.tenant} is left to renew it.` };
  try {
    const { g } = await graphCall(ctx, (req) => ctx.http(k.key, req), k);
    const r = await send<{ keyId?: string; secretText?: string; endDateTime?: string }>(g, 'POST', `/applications/${c.appObjectId}/addPassword`, { passwordCredential: { displayName: 'cubefarm: shared mailboxes', endDateTime: new Date(now + SECRET_MS).toISOString() } });
    if (!r.keyId || !r.secretText) throw new ActionError('Graph returned no secret.');
    const expiresAt = r.endDateTime ? Date.parse(r.endDateTime) : now + SECRET_MS;
    await ctx.mail!.set({ ...c, keyId: r.keyId, secret: r.secretText, expiresAt });
    const gone = await removeSecret(g, c.appObjectId, c.keyId);
    return { ok: true, text: `Renewed the mail app's client secret (ends ${new Date(expiresAt).toISOString().slice(0, 10)})${gone.status < 300 ? ' and removed the old one' : ", but the old one couldn't be removed: it ends by itself"}.` };
  } catch (err) {
    return { ok: false, text: `Couldn't renew the mail app's secret (ends ${new Date(c.expiresAt).toISOString().slice(0, 10)}; the old one still works): ${(err as Error).message}` };
  }
}

const mailAppArgs = z.object({ mailboxes: z.array(z.string().min(1).max(120)).min(1).max(10), domain: z.string().min(3).max(120).optional(), name: z.string().min(1).max(80).optional() });

/** The Entra module with mail_app_ensure added (kept here so entra.ts doesn't import this file back). */
export function withMail(mod: ProviderModule): ProviderModule {
  return {
    ...mod,
    ops: { ...mod.ops, mail_app_ensure: { args: mailAppArgs, plan: (ctx, a) => planMail(ctx, a) } },
    apply: (ctx, c) => (c.op === 'mail_app_ensure' ? applyMail(ctx, c.keyId, c.data as { name: string; tenant: string; domain: string; mailboxes: string[] }) : mod.apply(ctx, c)),
  };
}
