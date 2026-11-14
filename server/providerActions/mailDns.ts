// Cloudflare's mail_dns_check / mail_dns_ensure (#668): SPF, DKIM and DMARC for the Comms floor's domain as Exchange
// Online needs them (rules in shared/mailDns.ts), read from the zone, and the missing ones written on the manager's card.
// DKIM's targets come from Exchange (entra mail_app_ensure keeps them with the mail app); DMARC reports go to the first
// shared mailbox.
import { z } from 'zod';
import { cf, CfError, withKey, type CfApi } from '../cloudflare.ts';
import { checkLine, mailDnsChecks, type DnsFix, type DnsRec } from '../../shared/mailDns.ts';
import { DEFAULT_DOMAIN } from '../../shared/comms.ts';
import type { ActionCtx, ActionPlan, ActionResult } from './types.ts';

const ZONE = 'Zone › Zone › Read';
const DNS = 'Zone › DNS › Edit';
type Call = Parameters<Parameters<typeof withKey>[2]>[0];

const names = (domain: string) => [domain, `_dmarc.${domain}`, `selector1._domainkey.${domain}`, `selector2._domainkey.${domain}`];

async function read(call: Call, domain: string) {
  const zones = await cf<{ id: string; name: string }[]>(call, { method: 'GET', path: `/zones?name=${encodeURIComponent(domain)}` }, ZONE);
  if (!zones?.length) throw new CfError(`No Cloudflare zone holds ${domain}.`, ZONE);
  const recs: DnsRec[] = [];
  for (const n of names(domain)) recs.push(...((await cf<DnsRec[]>(call, { method: 'GET', path: `/zones/${zones[0].id}/dns_records?name=${encodeURIComponent(n)}` }, DNS)) ?? []));
  return { zone: zones[0].id, recs };
}

function checks(ctx: ActionCtx, domain: string, recs: DnsRec[]) {
  const m = ctx.mail?.get();
  const dkim = m && m.domain === domain ? (m.dkim ?? null) : null;
  return mailDnsChecks(domain, recs, dkim, m?.mailboxes[0] ?? `hello@${domain}`);
}

const domainOf = (ctx: ActionCtx, a: Record<string, unknown>) => String(a.domain ?? ctx.mail?.get()?.domain ?? DEFAULT_DOMAIN).trim().toLowerCase();

async function check(ctx: ActionCtx, a: Record<string, unknown>): Promise<string> {
  const domain = domainOf(ctx, a);
  return withKey(ctx.keys, ctx.cloudflareApi, async (call) => {
    const { recs } = await read(call, domain);
    const list = checks(ctx, domain, recs);
    return `${domain}:\n${list.map(checkLine).join('\n')}${list.some((c) => c.fix) ? '\nFix: cloudflare mail_dns_ensure (one card).' : ''}`;
  });
}

async function plan(ctx: ActionCtx, a: Record<string, unknown>): Promise<ActionPlan> {
  const domain = domainOf(ctx, a);
  return withKey(ctx.keys, ctx.cloudflareApi, async (call, k) => {
    const { zone, recs } = await read(call, domain);
    const list = checks(ctx, domain, recs);
    const fixes = list.flatMap((c) => (c.fix ? [c.fix] : []));
    return {
      change: { provider: 'cloudflare', op: 'mail_dns_ensure', keyId: k.id, data: { domain, zone, fixes } },
      summary: `fixes ${[...new Set(list.filter((c) => c.fix).map((c) => c.kind))].join(', ') || 'nothing'} for ${domain}'s mail`,
      diff: `DNS ${domain}:\n${list.map((c) => (c.fix ? `${c.fix.id ? '~' : '+'} ${c.fix.type} ${c.fix.name} "${c.fix.content}"${c.have ? `\n-   was "${c.have}"` : ''}` : `  ${checkLine(c)}`)).join('\n')}`,
      argv: ['cloudflare', 'mail_dns_ensure', domain],
      undo: 'delete the added records (or put back the old SPF) in Cloudflare → DNS',
      ...(!fixes.length && { already: list.map(checkLine).join('\n') }),
    };
  });
}

async function apply(ctx: ActionCtx, keyId: string, d: { domain: string; zone: string; fixes: DnsFix[] }): Promise<ActionResult> {
  const keys = ctx.keys.filter((k) => k.id === keyId).concat(ctx.keys.filter((k) => k.id !== keyId));
  try {
    return await withKey(keys, ctx.cloudflareApi as CfApi, async (call) => {
      for (const f of d.fixes) {
        const body = { type: f.type, name: f.name, content: f.content, ttl: 1, proxied: false, comment: 'cubefarm mail (#668)' };
        await cf(call, f.id ? { method: 'PUT', path: `/zones/${d.zone}/dns_records/${f.id}`, body } : { method: 'POST', path: `/zones/${d.zone}/dns_records`, body }, DNS);
      }
      const { recs } = await read(call, d.domain);
      const list = checks(ctx, d.domain, recs);
      const left = d.fixes.filter((f) => list.some((c) => c.fix && c.fix.name === f.name));
      return { ok: !left.length, text: `Read back ${d.domain}:\n${list.map(checkLine).join('\n')}${d.fixes.some((f) => f.type === 'CNAME') ? '\nNext: entra mail_app_ensure again turns DKIM signing on once the CNAMEs resolve.' : ''}` };
    });
  } catch (err) {
    return { ok: false, text: (err as Error).message };
  }
}

const args = z.object({ domain: z.string().min(3).max(120).optional() });
export const mailDnsOps = {
  mail_dns_check: { args, read: (ctx: ActionCtx, a: Record<string, unknown>) => check(ctx, a) },
  mail_dns_ensure: { args, plan: (ctx: ActionCtx, a: Record<string, unknown>) => plan(ctx, a) },
};
export const applyMailDns = (ctx: ActionCtx, keyId: string, data: Record<string, unknown>) => apply(ctx, keyId, data as { domain: string; zone: string; fixes: DnsFix[] });
