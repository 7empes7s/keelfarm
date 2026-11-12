// The IT department's tools (#506, #524, #525): it_run (a read-only command now), it_propose (a change the manager runs
// from a card), it_recommend (#525: a health check's ranked options, one picked by the manager), it_health (the office's
// own readings), it_ticket (#542: answer and close a ticket), it_review and it_improve (#543: what keeps going wrong,
// and changes for the manager to approve), served to the IT lead's session only (itOfficeTools);
// the CEO gets ask_it instead (createOfficeTools, ceo.ts). it_report (#542) is every agent's and the CEO's. The office's
// side is server/swarm/itDesk.ts, itDept.ts, itTickets.ts and itWatch.ts.
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { runTool, toolServer, type OfficeTools } from './ceo.ts';
import { TICKET_WHERE } from '../shared/itTickets.ts';
import type { ItProposeArgs, ItRunArgs } from './swarm/itDesk.ts';
import type { ItRecommendArgs } from './swarm/itWatch.ts';
import type { ItImproveArgs } from './swarm/itImprove.ts';
import { IMPROVE_KINDS } from '../shared/itImprove.ts';
import { problemTools, type ProblemHandlers } from './ceoProblemTools.ts';

export interface ItHandlers {
  itRun(a: ItRunArgs): Promise<string>;
  itPropose(a: ItProposeArgs): string;
  itRecommend(a: ItRecommendArgs): string;
  itHealth(): string;
  itTicket(a: ItTicketArgs): Promise<string>;
  itReview(a: { days?: number }): string;
  itImprove(a: ItImproveArgs): string;
}

/** it_ticket's arguments: at least one of tell, close and code_fix. */
export interface ItTicketArgs {
  id: number;
  tell?: string;
  close?: string;
  code_fix?: string;
  cause?: string;
}

export interface ReportHandlers {
  itReport(a: unknown): string;
}

export interface AskItHandlers {
  askIt(a: { question: string }): string;
}

type Run = typeof runTool;

function itTools(h: ItHandlers, run: Run) {
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
    tool(
      'it_recommend',
      "Answer a health check that got worse with a card for the manager: what's wrong in one line, the evidence, and 1-4 options best first. They tap one; the office runs it through it_propose's never-list, measures again and posts before/after. Not now snoozes it a day. One per check: a new one replaces it.",
      {
        check: z.enum(['disk', 'memory', 'load', 'units', 'failed', 'docker', 'leftovers', 'qaShots', 'logs', 'files', 'backups', 'certs']),
        title: z.string().min(1).max(160).describe('e.g. "Disk: 7.9 GB free on /, full in 4 days"'),
        evidence: z.string().min(1).max(600).describe('The numbers: sizes, units, ages'),
        options: z
          .array(
            z.object({
              argv: z.array(z.string().min(1).max(1000)).min(1).max(60).describe('One program, no shell, e.g. ["docker", "builder", "prune", "-f"]'),
              does: z.string().min(1).max(120).describe('e.g. "Remove the Docker build cache"'),
              frees: z.string().min(1).max(120).describe('e.g. "frees 9 GB"'),
              risk: z.enum(['low', 'medium', 'high']),
              undo: z.string().min(1).max(160).describe('e.g. "rebuilt on the next build", or "can\'t be undone"'),
            }),
          )
          .min(1)
          .max(4),
      },
      (a) => run(() => h.itRecommend(a)),
    ),
    tool('it_health', "The office's own readings: memory, swap and load, sessions running, free disk and what agents' machines hold, the watchdog's findings, the IT desk's latest commands and the open tickets.", {}, () => run(() => h.itHealth())),
    tool(
      'it_ticket',
      'Act on an IT ticket: tell its reporting agents what to do (they get it as a message), close it with what was done, and/or ask the CEO for a code fix when the office itself needs changing. Every ticket ends with a close.',
      {
        id: z.number().int().min(1).describe('The ticket number'),
        tell: z.string().min(1).max(1000).optional().describe('To the agents who reported it, e.g. "Port 5644 is free again: start your dev server and carry on."'),
        close: z.string().min(1).max(600).optional().describe('What was done, e.g. "Freed 4 GB; told Dennis to retry."'),
        code_fix: z.string().min(1).max(1000).optional().describe('For the CEO to file: what in the office needs fixing, e.g. "The lab drops results on runs over 15 minutes."'),
        cause: z.string().min(1).max(120).optional().describe('With close: the root cause in a few words, the same words for the same cause, e.g. "Lab OOM: too many test workers". The weekly review groups by it.'),
      },
      (a) => run(() => h.itTicket(a)),
    ),
    tool(
      'it_review',
      "What keeps going wrong: the closed and open tickets of the last days grouped by cause, costliest first (agent minutes blocked, wasted session $, failed QA rounds), each new, recurring or fixed, with its cause key for it_improve, and the floors.",
      { days: z.number().int().min(1).max(56).optional().describe('How far back; 7 by default') },
      (a) => run(() => h.itReview(a)),
    ),
    tool(
      'it_improve',
      "Propose changes for the top causes of a review, each a card with Approve / Not now for the manager (chat and Telegram). Approve files the issue on its floor, or adds the line to the office playbook, a floor's playbook or its QA brief. Skip causes that are fixed. Nothing changes without the manager's tap.",
      {
        proposals: z
          .array(
            z.object({
              cause: z.string().min(1).max(200).describe('The cause key from it_review, e.g. "lab:test lab oom"'),
              kind: z.enum(IMPROVE_KINDS).describe('issue: a code fix on a floor; office_playbook / floor_playbook / qa_brief: a line to add'),
              title: z.string().min(1).max(120).describe("The issue's title, or what the line is for"),
              why: z.string().min(1).max(300).describe('The numbers, e.g. "5 tickets, 42 agent-minutes, $3.10 this week"'),
              floor: z.number().int().optional().describe('For issue, floor_playbook and qa_brief'),
              body: z.string().min(1).max(4000).optional().describe('issue: what, where in the code, and acceptance criteria'),
              line: z.string().min(1).max(400).optional().describe('The playbook or QA brief line, e.g. "Run vitest with --maxWorkers=2."'),
            }),
          )
          .min(1)
          .max(5),
      },
      (a) => run(() => h.itImprove(a)),
    ),
  ];
}

/** The IT lead's office server: its tools and the problems register's (#544). */
export const itOfficeTools = (h: ItHandlers & ProblemHandlers): OfficeTools => toolServer([...itTools(h, runTool), ...problemTools(h, runTool)]);

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

/** it_report: every agent's (their office server) and the CEO's. */
export function reportTools(h: ReportHandlers, run: Run) {
  return [
    tool(
      'it_report',
      "Report an office problem to the IT department: the test lab times out or loses a result, a port is taken, a sign-in screen, the disk is full, a preview won't start, CI is down. Returns a ticket number at once and what to do meanwhile. Report instead of sleep-looping or retrying blindly; a repeat joins the open ticket.",
      {
        what: z.string().min(1).max(200).describe('The problem in a line, e.g. "Lab result lost"'),
        where: z.enum(TICKET_WHERE),
        evidence: z.string().min(1).max(2000).describe('The error text, job id or command'),
        blocking: z.boolean().describe('true: you cannot go on until it is fixed; IT looks now and messages you'),
      },
      (a) => run(() => h.itReport(a)),
    ),
  ];
}

/** An agent's own office server with it_report. */
export const reportOfficeTools = (h: ReportHandlers): OfficeTools => toolServer(reportTools(h, runTool));
