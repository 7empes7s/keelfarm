// The demo's Comms inbox (#668): a few threads in the shared mailboxes (a lead, a support question, an unsubscribe,
// spam), a draft waiting for Approve, and a lead list fed from mail and from the agency's opportunities.
import { makeDraft, mergeInbox, upsertLead, type CommsState, type Incoming } from '../shared/comms.ts';

const H = 3_600_000;

export function commsSample(s: CommsState, now: number) {
  const d = s.settings.domain;
  upsertLead(s, { email: 'jonas@northwind-studio.lu', name: 'Jonas Weber', company: 'Northwind Studio', source: 'agency', stage: 'qualified', next_step: 'Send the sample clip on Monday' });
  upsertLead(s, { email: 'ines@brightpod.eu', name: 'Inès Martin', company: 'BrightPod', source: 'referral', stage: 'contacted', next_step: 'Follow up if no reply by Friday' });
  upsertLead(s, { email: 'lea@kitchenlab.tv', name: 'Léa Schmit', company: 'KitchenLab', source: 'agency', stage: 'new', next_step: 'Intro email' });
  const msg = (id: string, mailbox: string, from: string, fromName: string, subject: string, text: string, ago: number, read = false): Incoming => ({ id, threadId: `t-${id}`, from, fromName, to: [mailbox], subject, text, at: now - ago * H, read });
  mergeInbox(s, `sales@${d}`, [msg('m1', `sales@${d}`, 'jonas@northwind-studio.lu', 'Jonas Weber', 'Clips for our podcast', 'Hi! We publish a weekly 90-minute podcast and want 5 short clips per episode for TikTok and Shorts. What would that cost per month?', 2)], now);
  mergeInbox(s, `support@${d}`, [msg('m2', `support@${d}`, 'sam@creatorhub.io', 'Sam Okafor', 'Export stuck at 80%', 'My clip export has been stuck at 80% since this morning. Can you check?', 5)], now);
  mergeInbox(s, `hello@${d}`, [msg('m3', `hello@${d}`, 'paul@oldlist.example', 'Paul', 'unsubscribe', 'unsubscribe', 20, true)], now);
  mergeInbox(s, `hello@${d}`, [msg('m4', `hello@${d}`, 'promo@seo-deals.biz', 'SEO Deals', 'Rank #1 on Google in 7 days!!!', 'Guaranteed backlinks, limited offer.', 30, true)], now);
  const spam = s.threads.find((t) => t.id === 't-m4');
  if (spam) spam.label = 'spam';
  const reply = makeDraft(s, { threadId: 't-m1', text: "Hi Jonas,\n\nThanks for reaching out! For a weekly 90-minute episode, 5 clips each week is our Creator plan at €290 a month, captions and thumbnails included. I can make a free sample from your latest episode: shall I?" }, 'Mimoun', now - 1 * H);
  reply.status = 'waiting';
  const intro = makeDraft(s, { mailbox: `hello@${d}`, to: ['lea@kitchenlab.tv'], template: 'intro' }, 'Mimoun', now - 0.5 * H);
  intro.status = 'waiting';
  const post = makeDraft(s, { channel: 'social', subject: 'LinkedIn', text: 'New: 5 clips from every podcast episode, captions included. Free sample for the first 10 creators who reply.' }, 'Mimoun', now - 0.2 * H);
  post.status = 'waiting';
  s.drafts.push(reply, intro, post);
}
