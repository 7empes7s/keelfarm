// File leases (#24): the one office tool a builder or fixer gets while their floor has leases on, declare_files. They
// call it first with the files and folders they expect to touch; the scheduler keeps other issues off them until the
// PR merges or the agent stops (shared/practices.ts).
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { OfficeTools } from './ceo.ts';

const input = {
  files: z.array(z.string().min(1).max(200)).min(1).max(30).describe('Paths relative to the repository root; a folder (e.g. "server/swarm/") covers everything in it'),
};

/** The lease tool for one session. `declare` records the files and returns what the agent is told back. */
export function leaseTools(declare: (files: string[]) => string): OfficeTools {
  const defs = [
    tool('declare_files', 'Declare the files or folders you expect to touch on this task, so the office keeps teammates off them until your PR merges. Call it again if that changes.', input, async (a) => {
      try {
        return { content: [{ type: 'text' as const, text: declare(a.files) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: (err as Error).message }], isError: true };
      }
    }),
  ];
  return {
    server: createSdkMcpServer({ name: 'office', version: '1.0.0', tools: defs }),
    defs,
    serve: () => createSdkMcpServer({ name: 'office', version: '1.0.0', tools: defs }).instance,
    async call(name, args) {
      if (name !== 'declare_files') throw new Error(`No office tool ${name}`);
      const res = await defs[0].handler(args as never, undefined);
      return res.content.map((c) => ('text' in c ? c.text : '')).join('\n');
    },
  };
}
