// The mail tools (#668), the CEO's and the Comms floor agents' (their office server): mail_list and mail_read over the
// shared mailboxes, mail_draft (a reply or a new email, from a template, with the mailbox's signature), mail_send (on
// the manager's Approve card unless the mailbox's auto-replies cover it) and lead_update. Every one works only on the
// office's listed shared mailboxes. The office's side is server/swarm/comms.ts; rules in shared/comms.ts.
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { LEAD_STAGES, MAIL_LABELS, MAIL_TEMPLATES } from '../shared/comms.ts';
import { runTool, toolServer, type OfficeTools } from './ceo.ts';

export interface MailListArgs {
  mailbox?: string;
  unread?: boolean;
  label?: (typeof MAIL_LABELS)[number];
}
export interface MailDraftArgs {
  mailbox?: string;
  to?: string[];
  subject?: string;
  text?: string;
  template?: string;
  reply_to?: string;
  channel?: 'email' | 'social' | 'newsletter';
}
export interface LeadUpdateArgs {
  email: string;
  name?: string;
  company?: string;
  source?: string;
  stage?: (typeof LEAD_STAGES)[number];
  next_step?: string;
}

export interface MailHandlers {
  mailList(a: MailListArgs): string;
  mailRead(a: { thread: string }): string;
  mailDraft(a: MailDraftArgs): string;
  mailSend(a: { draft: string }): Promise<string>;
  leadUpdate(a: LeadUpdateArgs): string;
}

export function mailTools(h: MailHandlers, run: typeof runTool) {
  return [
    tool(
      'mail_list',
      "The shared mailboxes' threads, newest first (id, mailbox, from, subject, label, unread), plus drafts waiting for the manager and the outreach left today.",
      { mailbox: z.string().max(120).optional().describe('e.g. "support@…"; default all'), unread: z.boolean().optional(), label: z.enum(MAIL_LABELS).optional() },
      (a) => run(() => h.mailList(a)),
    ),
    tool('mail_read', "One thread's messages, oldest first (marks it read).", { thread: z.string().min(1).max(200) }, (a) => run(() => h.mailRead(a))),
    tool(
      'mail_draft',
      `Write a draft from a shared mailbox: reply_to a thread id, or a new email (to + subject; it gets the unsubscribe line and counts as outreach: never to bought lists). template fills the text: ${Object.keys(MAIL_TEMPLATES).join(', ')}. channel social/newsletter queues a post for the manager's Approve too. Nothing is sent: mail_send.`,
      {
        mailbox: z.string().max(120).optional(),
        to: z.array(z.string().max(200)).max(20).optional(),
        subject: z.string().max(200).optional(),
        text: z.string().max(20_000).optional(),
        template: z.string().max(30).optional(),
        reply_to: z.string().max(200).optional().describe('A thread id from mail_list'),
        channel: z.enum(['email', 'social', 'newsletter']).optional(),
      },
      (a) => run(() => h.mailDraft(a)),
    ),
    tool(
      'mail_send',
      "Send a draft: it goes on the manager's phone as a card (Approve / Edit / Discard) unless its mailbox's auto-replies cover it. Refused for a mailbox outside the office's list, a suppressed address or past today's outreach cap.",
      { draft: z.string().min(1).max(20).describe('e.g. "d4"') },
      (a) => run(() => h.mailSend(a)),
    ),
    tool(
      'lead_update',
      'Add or update a lead on the Comms lead list by email: name, company, source (mail, agency, referral…), stage, next step.',
      { email: z.string().max(200), name: z.string().max(100).optional(), company: z.string().max(100).optional(), source: z.string().max(40).optional(), stage: z.enum(LEAD_STAGES).optional(), next_step: z.string().max(200).optional() },
      (a) => run(() => h.leadUpdate(a)),
    ),
  ];
}

/** A Comms floor agent's office server with the mail tools. */
export const mailOfficeTools = (h: MailHandlers): OfficeTools => toolServer(mailTools(h, runTool));
