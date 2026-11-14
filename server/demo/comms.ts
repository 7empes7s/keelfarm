// The demo CEO and Comms (#668): "set up mail" plans entra mail_app_ensure on a card (the fake Graph and Exchange,
// demo/exchange.ts); "check the inbox" reads the shared mailboxes, drafts a reply to the newest lead and puts it on the
// manager's Approve card, with the lead list updated; "check the mail DNS" runs Cloudflare's mail_dns_check.
import { registerCeoReply } from './registry.ts';

const first = (s: string) => s.split('\n')[0].replace(/^Refused:\s*/, '');

registerCeoReply('comms setup', async ({ text, use }) => {
  if (!/\bset up (the )?(mail|email|shared mailboxes)\b/i.test(text)) return null;
  const card = await use('provider_action', { provider: 'entra', op: 'mail_app_ensure', args: { mailboxes: ['hello', 'sales', 'support'] }, why: 'Mail for the Comms floor: the shared mailboxes only.' });
  return card.startsWith('Refused') ? `I couldn't plan it: ${first(card)}` : "It's on one card: an app in techinsiderbytes.com that can read and send as hello@, sales@ and support@ only (an Exchange scope over just those), the missing mailboxes made, its secret in the office's key store. Approve it and mail is live.";
}, { early: true });

registerCeoReply('comms dns', async ({ text, use }) => {
  if (!/\b(mail|email) dns\b|\bspf\b|\bdkim\b|\bdmarc\b/i.test(text)) return null;
  const out = await use('provider_action', { provider: 'cloudflare', op: 'mail_dns_check' });
  return `${out.replace(/^Refused:\s*/, '')}\n\nI can put the fixes on one card with cloudflare mail_dns_ensure.`;
}, { early: true });

registerCeoReply('comms inbox', async ({ text, use }) => {
  if (!/\b(check|read|show)( me)? (the )?(inbox|mail|emails|comms)\b|\blead list\b/i.test(text)) return null;
  const list = await use('mail_list', { unread: true });
  const thread = list.match(/^(t-\S+) · sales@/m)?.[1];
  if (!thread) return `Here's the inbox:\n${list}`;
  const read = await use('mail_read', { thread });
  const from = read.match(/with (\S+@\S+)/)?.[1];
  const draft = await use('mail_draft', { reply_to: thread, text: 'Thanks for writing! A free sample clip from your latest episode is on its way this week.' });
  const id = draft.match(/^Draft (d\d+)/)?.[1];
  const sent = id ? await use('mail_send', { draft: id }) : draft;
  if (from) await use('lead_update', { email: from, stage: 'replied', next_step: 'Send the sample clip' });
  return `${list.split('\n')[0]}\n\nI drafted a reply to the sales enquiry: ${first(sent)} Open Comms to Approve, Edit or Discard it.`;
});
