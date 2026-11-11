// The IT department's tools (#506, #524): it_run (a read-only command now), it_propose (a change the manager runs from a
// card) and it_health (the office's own readings), served to the IT lead's session only (itOfficeTools); the CEO gets
// ask_it instead (createOfficeTools, ceo.ts). The office's side is server/swarm/itDesk.ts and server/swarm/itDept.ts.
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { runTool, toolServer, type OfficeTools } from './ceo.ts';
import type { ItProposeArgs, ItRunArgs } from './swarm/itDesk.ts';

export interface ItHandlers {
  itRun(a: ItRunArgs): Promise<string>;
  itPropose(a: ItProposeArgs): string;
  itHealth(): string;
}

export interface AskItHandlers {
  askIt(a: { question: string }): string;
}

type Run = typeof runTool;

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
      "Propose a command that changes this machine: the manager sees it on a card with Run / Not now (chat and Telegram), and it runs only on their Run; you then get its output to check. One program per card, as argv, no shell. Never: pkill/killall, shutdown, docker volume prune or keel-postgres, /etc/keel, git push --force, the live office's folders, rm -rf of /, /root, /opt, /etc or /var.",
      {
        argv: z.array(z.string().min(1).max(1000)).min(1).max(60).describe('e.g. ["journalctl", "--vacuum-size=500M"]'),
        why: z.string().min(1).max(300).describe('Why, in a sentence the manager can decide on'),
        affects: z.string().min(1).max(200).describe('What it changes or frees, e.g. "frees about 2.1 GB of old logs"'),
        undo: z.string().min(1).max(200).describe('How to undo it, or "backed up to X", or "can\'t be undone"'),
        risk: z.enum(['low', 'medium', 'high']),
      },
      (a) => run(() => h.itPropose(a)),
    ),
    tool('it_health', "The office's own readings: memory, swap and load, sessions running, free disk and what agents' machines hold, the watchdog's findings, and the IT desk's latest commands.", {}, () => run(() => h.itHealth())),
  ];
}

/** The IT lead's office server: its tools only. */
export const itOfficeTools = (h: ItHandlers): OfficeTools => toolServer(itTools(h, runTool));

export function askItTools(h: AskItHandlers, run: Run) {
  return [
    tool(
      'ask_it',
      "Hand a question or job about this machine (disk, memory, services, logs, clean-ups) to the IT department: it opens in IT's chat, IT looks and proposes changes for the manager to run, and IT's answer reaches you in your next job. You never run machine commands yourself.",
      { question: z.string().min(1).max(2000).describe('What to find out or fix, with what you know, e.g. "Uploads are refused: the disk is at 95%. What can go?"') },
      (a) => run(() => h.askIt(a)),
    ),
  ];
}
