// The Agency floor in the demo (#667): "open a floor for <name>" makes the demo CEO call create_floor with the
// manager's message as asked_in; "approve <slug>" / "not now <slug or ax-N>" answer through agency_decide; "agency
// shortlist" ranks floor's opportunities (agency_opportunities), "draft a gig proposal" queues agency_propose_action
// and "mark ax-N done" shows agency_action_done refusing anything not approved.
import { refused } from './ceo.ts';
import { registerCeoReply } from './registry.ts';

const askedIn = (text: string) => Number(text.match(/\(message (\d+)\)/)?.[1] ?? NaN);
const said = (out: string) => (out.startsWith('Refused') ? `I couldn't: ${refused(out)}` : out);

registerCeoReply('agency', async ({ text, s, use }) => {
  const asked_in = askedIn(text);
  const agency = s.floors.find((f) => /agency/i.test(f.repo));
  const open = text.match(/\b(?:open|create) a (?:new )?floor (?:for|called) ([A-Za-z0-9 -]{2,40})/i);
  if (open && Number.isInteger(asked_in)) {
    const name = open[1].trim();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return said(await use('create_floor', { name, repo_slug: slug, use_case: /agency|market/i.test(name) ? 'agency' : 'web-app', description: `${name}, as the manager asked`, asked_in }));
  }
  if (!agency) return null;
  const decide = text.match(/\b(approve|not now) (ax-\d+|[a-z0-9][a-z0-9-]+)\b/i);
  if (decide && Number.isInteger(asked_in)) return said(await use('agency_decide', { id: decide[2], approve: /approve/i.test(decide[1]), asked_in }));
  if (/\bagency shortlist\b/i.test(text)) return said(await use('agency_opportunities', { floor: agency.floor }));
  if (/\bdraft a gig proposal\b/i.test(text)) {
    return said(await use('agency_propose_action', { floor: agency.floor, opportunity: 'shopify-store-setup', kind: 'proposal', target: 'Upwork: "Shopify store for a tea shop"', summary: 'A $400 proposal for a 3-day store setup', draft: 'Hi! We set up Shopify stores end to end in 3 days for $400: theme, products, payments, shipping.' }));
  }
  const done = text.match(/\bmark (ax-\d+) done\b/i);
  if (done) return said(await use('agency_action_done', { id: done[1], result: 'Sent on Upwork' }));
  return null;
});
