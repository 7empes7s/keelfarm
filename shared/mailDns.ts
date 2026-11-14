// Deliverability for the Comms floor's domain (#668), pure: SPF, DKIM and DMARC as Exchange Online needs them, checked
// against the zone's records and the fix for each one missing or wrong. Cloudflare's mail_dns_check / mail_dns_ensure
// (server/providerActions/mailDns.ts) read the records and write the fixes on the manager's card.

export interface DnsRec {
  id: string;
  type: string;
  name: string;
  content: string;
}
export interface DnsFix {
  type: 'TXT' | 'CNAME';
  name: string;
  content: string;
  id?: string; // the record it replaces
}
export interface MailDnsCheck {
  kind: 'SPF' | 'DKIM' | 'DMARC';
  ok: boolean;
  have: string | null;
  note: string;
  fix?: DnsFix;
}

const SPF_INCLUDE = 'include:spf.protection.outlook.com';
const unq = (s: string) => s.replace(/^"|"$/g, '').replace(/"\s*"/g, '');

/** SPF with Exchange's include added (before the all), or a new strict one. */
function spfWith(have: string | null): string {
  if (!have) return `v=spf1 ${SPF_INCLUDE} -all`;
  const parts = unq(have).trim().split(/\s+/);
  if (parts.includes(SPF_INCLUDE)) return unq(have);
  const all = parts.findIndex((p) => /^[~?+-]?all$/.test(p));
  if (all < 0) return [...parts, SPF_INCLUDE, '~all'].join(' ');
  return [...parts.slice(0, all), SPF_INCLUDE, ...parts.slice(all)].join(' ');
}

/**
 * The three checks: `records` are the TXT and CNAME records at the domain, _dmarc and the DKIM selectors; `dkim` the
 * CNAME targets Exchange gave (Get-DkimSigningConfig, read by entra mail_app_ensure), null when not known yet.
 */
export function mailDnsChecks(domain: string, records: readonly DnsRec[], dkim: { selector1: string; selector2: string } | null, report: string): MailDnsCheck[] {
  const at = (name: string, type: string) => records.filter((r) => r.type === type && r.name.toLowerCase() === name);
  const spfs = at(domain, 'TXT').filter((r) => /^"?v=spf1\b/i.test(r.content));
  const spf = spfs[0];
  const spfOk = spfs.length === 1 && unq(spf.content).split(/\s+/).includes(SPF_INCLUDE);
  const out: MailDnsCheck[] = [
    {
      kind: 'SPF',
      ok: spfOk,
      have: spf ? unq(spf.content) : null,
      note: spfs.length > 1 ? 'Two SPF records: receivers reject both. Merge them into one.' : spfOk ? 'Exchange Online may send for the domain.' : `Missing ${SPF_INCLUDE}: Exchange's mail fails SPF.`,
      ...(!spfOk && spfs.length <= 1 && { fix: { type: 'TXT' as const, name: domain, content: spfWith(spf?.content ?? null), ...(spf && { id: spf.id }) } }),
    },
  ];
  const dmarc = at(`_dmarc.${domain}`, 'TXT').find((r) => /^"?v=DMARC1\b/i.test(r.content));
  out.push({
    kind: 'DMARC',
    ok: !!dmarc,
    have: dmarc ? unq(dmarc.content) : null,
    note: dmarc ? 'A DMARC policy is published.' : 'No DMARC: Gmail and Yahoo junk bulk mail without one.',
    ...(!dmarc && { fix: { type: 'TXT' as const, name: `_dmarc.${domain}`, content: `v=DMARC1; p=none; rua=mailto:${report}` } }),
  });
  if (!dkim) {
    out.push({ kind: 'DKIM', ok: false, have: null, note: "Exchange's DKIM selectors aren't known yet: run entra mail_app_ensure (it reads them), then check again." });
    return out;
  }
  const want = [
    { name: `selector1._domainkey.${domain}`, content: dkim.selector1 },
    { name: `selector2._domainkey.${domain}`, content: dkim.selector2 },
  ];
  const wrong = want.filter((w) => at(w.name, 'CNAME')[0]?.content.toLowerCase().replace(/\.$/, '') !== w.content.toLowerCase());
  out.push({
    kind: 'DKIM',
    ok: !wrong.length,
    have: want.map((w) => at(w.name, 'CNAME')[0]?.content ?? '').filter(Boolean).join(', ') || null,
    note: wrong.length ? `${wrong.length} DKIM selector CNAME${wrong.length > 1 ? 's' : ''} missing or wrong.` : 'Both DKIM selectors point at Exchange.',
    ...(wrong[0] && { fix: { type: 'CNAME' as const, name: wrong[0].name, content: wrong[0].content, ...(at(wrong[0].name, 'CNAME')[0] && { id: at(wrong[0].name, 'CNAME')[0].id }) } }),
  });
  // the second selector's fix rides along as its own check line
  if (wrong[1]) out.push({ kind: 'DKIM', ok: false, have: at(wrong[1].name, 'CNAME')[0]?.content ?? null, note: 'Second DKIM selector.', fix: { type: 'CNAME', name: wrong[1].name, content: wrong[1].content, ...(at(wrong[1].name, 'CNAME')[0] && { id: at(wrong[1].name, 'CNAME')[0].id }) } });
  return out;
}

export const checkLine = (c: MailDnsCheck) => `${c.ok ? '✓' : '✗'} ${c.kind}: ${c.note}${c.have ? ` (now: ${c.have})` : ''}`;
