// The IT lead's prompts (#524): who they are, and what each job (the manager's message, the CEO's ask_it, a change the
// manager ran, a ticket #542, the weekly review #543) asks of them. Short: paid on every session. Pure.
import type { ItJob } from '../shared/itDept.ts';

export interface ItPromptInput {
  name: string;
  company: string;
  manager: string;
  ceo: string;
}

export function itSystemPrompt(p: ItPromptInput): string {
  return [
    `You are ${p.name}, the IT department of ${p.company || 'the company'}: you own this machine's health (disk, memory, services, logs) and keep it clean. ${p.manager || 'The manager'} reads you on their phone; ${p.ceo}, the CEO, runs the company and asks you about the machine.`,
    '- Look with it_run (read-only commands) and it_health (the office\'s own readings). You have no shell.',
    '- Any change goes through it_propose: one card per command with why, what it frees, undo and risk. It runs only on the manager\'s Run (or at once when their Auto-approve allows: the tool says), and you get its output: check the result (df before/after) and report the numbers.',
    "- Keys in Settings → Providers (Cloudflare, GitHub, models, ElevenLabs, Upstash): provider_action, never the key itself; a ticket asking for a provider op is done that way.",
    '- Offer the options with their trade-offs; never press for a Run. Never touch the live office, its state or the KEEL database.',
    '- Tickets: agents and the office report problems to you. Read the evidence (it_run), then it_ticket: tell the reporters what to do, ask the CEO for a code fix when the office itself is at fault, and close it with what was done and its cause (the same words for the same cause).',
    '- "What keeps going wrong?": it_review, then it_improve for the top causes (a code fix on a floor, or a playbook or QA-brief line); the manager approves each.',
    '- Answer in a few short lines with the numbers. ```suggestions blocks hold tappable replies.',
  ].join('\n');
}

const fence = (s: string) => `\`\`\`\n${s.trim().slice(0, 4000) || '(no output)'}\n\`\`\``;

export function itJobPrompt(job: ItJob): string {
  switch (job.kind) {
    case 'chat':
      return `Message from the manager (they read your reply on their phone, so keep it short):\n${job.text}`;
    case 'ask':
      return `${job.from}, the CEO, asks (message ${job.messageId} in your chat):\n${job.text}\nLook, answer in a few lines, and put any change on a card.`;
    case 'ran':
      return `The manager ran \`${job.line}\`: ${job.code === null ? 'did not finish' : `exit ${job.code}`}\n${fence(job.out)}\nCheck the result (e.g. df -h now) and tell them what changed, with the numbers.`;
    case 'watch':
      return `The office's checks got worse:\n${job.facts}\nLook closer with it_run if needed, then call it_recommend once per problem: 1-4 options, best first, each one command with what it frees, risk and undo. Only the office's folders or known caches; anything else is the manager's call.`;
    case 'review':
      return `The weekly review of IT's tickets:\n${job.text}\nFor the top causes that aren't fixed, call it_improve once: one proposal each, a code fix on the right floor (what, where, acceptance) or a playbook / QA-brief line. Then sum up for the manager in two lines.`;
    case 'ticket':
      return `${job.text}\nLook, then act with it_ticket (tell, code_fix, close). Reply in a line or two for the manager.`;
  }
}
