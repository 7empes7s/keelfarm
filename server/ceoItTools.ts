// The CEO's IT desk tools (#506): it_run (a read-only command now) and it_propose (a change the manager runs from a
// card). createOfficeTools (ceo.ts) adds them to the office's MCP server; the office's side is server/swarm/itDesk.ts.
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { ItProposeArgs, ItRunArgs } from './swarm/itDesk.ts';

export interface ItHandlers {
  itRun(a: ItRunArgs): Promise<string>;
  itPropose(a: ItProposeArgs): string;
}

type Run = (fn: () => string | Promise<string>) => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>;

export function itTools(h: ItHandlers, run: Run) {
  return [
    tool(
      'it_run',
      'Run one read-only command on this machine now: df, du, free, ls, stat, find, ps, systemctl status/is-active/list-units/list-timers/cat, journalctl --disk-usage or -u … -n, docker ps/images/system df/volume ls, snap list, git status/log/remote -v/branch -vv, uptime, lsblk, mount. No shell: no pipes, redirects or ;. Output masked, at most 20 KB.',
      {
        command: z.string().min(1).max(2000).describe('e.g. "du -sh /var/lib/docker /opt /root"'),
        sort: z.enum(['size']).optional().describe('size: lines biggest first by their first word (du output)'),
        lines: z.number().int().min(1).max(2000).optional().describe('Keep only the first N lines (after sorting)'),
      },
      (a) => run(() => h.itRun(a)),
    ),
    tool(
      'it_propose',
      "Propose a command that changes this machine: the manager sees it on a card with Run / Not now, and it runs only on their Run (output to the chat). One program per card, as argv, no shell. Never: pkill/killall, shutdown, docker volume prune or keel-postgres, /etc/keel, git push --force, the live office's folders, rm -rf of /, /root, /opt, /etc or /var.",
      {
        argv: z.array(z.string().min(1).max(1000)).min(1).max(60).describe('e.g. ["journalctl", "--vacuum-size=500M"]'),
        why: z.string().min(1).max(300).describe('Why, in a sentence the manager can decide on'),
        affects: z.string().min(1).max(200).describe('What it changes or frees, e.g. "frees about 2.1 GB of old logs"'),
        undo: z.string().min(1).max(200).describe('How to undo it, or "backed up to X", or "can\'t be undone"'),
        risk: z.enum(['low', 'medium', 'high']),
      },
      (a) => run(() => h.itPropose(a)),
    ),
  ];
}
