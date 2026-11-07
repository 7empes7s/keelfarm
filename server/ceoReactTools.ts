// The CEO's chat tools (#118): react (a reaction under the manager's message instead of words) and reply (an answer
// quoting the message it is about). Their handlers are the swarm's (server/swarm/reactions.ts); createOfficeTools
// (ceo.ts) adds them to the office's MCP server.
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { CEO_REACTIONS } from '../shared/reactions.ts';

/** The office's side of the chat tools (part of OfficeHandlers). */
export interface ReactHandlers {
  react(a: { emoji: string; message_id?: number }): string;
  reply(a: { message_id: number; text: string }): string;
}

type Run = (fn: () => string) => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>;

export function reactTools(h: ReactHandlers, run: Run) {
  return [
    tool(
      'react',
      'Put a reaction under one of the manager\'s messages, shown on their phone. Use it instead of a reply when no words are needed ("ok thanks": 👍; "go ahead": ✅ once done), then end with no text.',
      {
        emoji: z.enum(CEO_REACTIONS),
        message_id: z.number().int().nonnegative().optional().describe('From "(message N)"; default: the message you are answering'),
      },
      (a) => run(() => h.react(a)),
    ),
    tool(
      'reply',
      'Answer one of the manager\'s messages now, quoting it on their phone. For several messages in one job: answer each with reply, then end with no text.',
      { message_id: z.number().int().nonnegative().describe('From "(message N)"'), text: z.string().min(1).max(4000).describe('The answer, short, light Markdown') },
      (a) => run(() => h.reply(a)),
    ),
  ];
}
