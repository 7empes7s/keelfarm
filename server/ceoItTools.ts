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
import type { ItProposeArgs, ItRunArgs, ItRunbookArgs } from './swarm/itDesk.ts';
import type { ItRecommendArgs } from './swarm/itWatch.ts';
import type { ItImproveArgs } from './swarm/itImprove.ts';
import { IMPROVE_KINDS } from '../shared/itImprove.ts';
import { problemTools, type ProblemHandlers } from './ceoProblemTools.ts';
import { CF_OPS } from '../shared/cloudflare.ts';
import { ACTION_PROVIDERS, PROVIDER_ACTIONS } from '../shared/providerActions.ts';
import { APP_TARGETS, INSTALL_TARGETS, type KeyPart } from '../shared/keyInstall.ts';
import { PROVIDERS } from '../shared/providers.ts';

/** The cloudflare action's arguments (#586). */
export interface CloudflareArgs {
  op: (typeof CF_OPS)[number];
  hostname?: string;
  service?: string;
  tunnel?: string;
  emails?: string[];
  bypass?: string[];
  idps?: string[];
  auto_redirect?: boolean;
  name?: string;
  duration?: string;
  env_file?: string;
  why?: string;
}

/** provider_action's arguments (#602): the op's own arguments are checked by its module. */
export interface ProviderActionArgs {
  provider: string;
  op: string;
  args?: Record<string, unknown>;
  why?: string;
}

/** install_key's and save_provider_key's arguments (#609). */
export interface InstallKeyArgs {
  key: string;
  target: string;
  var_name: string;
  part?: KeyPart;
  why?: string;
}
export interface SaveKeyArgs {
  provider: string;
  label?: string;
  value?: string;
  /** #622: a file sent in chat holding the key (a service account's JSON), deleted once saved. */
  file?: string;
  uses?: string;
}

export interface CloudflareHandlers {
  cloudflare(a: CloudflareArgs): Promise<string>;
  providerAction(a: ProviderActionArgs): Promise<string>;
  installKey(a: InstallKeyArgs): Promise<string>;
  saveProviderKey(a: SaveKeyArgs): Promise<string>;
}

export interface ItHandlers extends CloudflareHandlers {
  itRun(a: ItRunArgs): Promise<string>;
  itPropose(a: ItProposeArgs): Promise<string>;
  itRunbook(a: ItRunbookArgs): Promise<string>;
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
      "Propose a command that changes this machine: the manager sees it on a card with Run / Not now (chat and Telegram), and it runs only on their Run; you then get its output to check. With the manager's Auto-approve on, a routine step (git fetch/pull --ff-only, your own units, installing a unit or Caddy file, caddy validate then reload) runs at once and the reply has its output. One program per card, as argv, no shell. Never: pkill/killall, shutdown, docker volume prune or keel-postgres, /etc/keel, git push --force, the live office's folders, rm -rf of /, /root, /opt, /etc or /var.",
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
      'it_runbook',
      "Run a floor's install runbook (markdown: ```bash lines, ```env <file> [from <template>] with NAME=generate or NAME=provider:<id>, ```caddy <host>, a Health check section) as ONE job: one card, progress per step, stop at the first failure, the check last, an Undo for all of it. Inside auto-approve (the project's /opt/<project>, /etc/<project>, <project>* units, its compose file, its clone, its Caddy block) it runs with no tap; else one Approve. Secrets are generated or come from Providers and never shown. Use it instead of it_propose for installs.",
      {
        floor: z.number().int().min(1).describe('The floor whose repo has the runbook'),
        path: z.string().min(1).max(300).describe('Its path in the repo, e.g. "ops/postiz/RUNBOOK.md"'),
        project: z.string().min(2).max(31).describe('What it installs, lower case: its scope is /opt/<project>, /etc/<project> and <project>* units, e.g. "postiz"'),
      },
      (a) => run(() => h.itRunbook(a)),
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
    ...cloudflareTools(h, run),
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

/** Each provider's ops, providers with the same ops on one line: "openai/openrouter: key_test, models, credit". */
const OPS_LINE = (() => {
  const byOps = new Map<string, string[]>();
  for (const p of ACTION_PROVIDERS) {
    const ops = PROVIDER_ACTIONS[p].map((o) => o.op).join(', ');
    byOps.set(ops, [...(byOps.get(ops) ?? []), p]);
  }
  return [...byOps].map(([ops, ps]) => `${ps.join('/')}: ${ops}`).join('; ');
})();

/** cloudflare (#586) and provider_action (#602): the IT lead's and the CEO's. */
export function cloudflareTools(h: CloudflareHandlers, run: Run) {
  return [
    tool(
      'provider_action',
      `Use a key from Settings → Providers through the office (never shown to you). Reads answer now; a write puts a card with its diff to the manager (Approve / Not now), or applies at once when their IT auto-approve allows (destructive ones always ask), then reads back. A wrong op or args lists the right ones. ${OPS_LINE}.`,
      {
        provider: z.enum(ACTION_PROVIDERS as [string, ...string[]]),
        op: z.string().min(1).max(40),
        args: z.record(z.string(), z.unknown()).optional().describe('The op\'s own, e.g. {"repo":"owner/name","run_id":123}; GitHub\'s repo defaults to the first floor\'s'),
        why: z.string().min(1).max(300).optional().describe('For the card: why, in a sentence'),
      },
      (a) => run(() => h.providerAction(a)),
    ),
    tool(
      'install_key',
      `Install a Settings → Providers key into a service's env file as VAR=value (the value never reaches you, a card or a log): a card with Approve / Not now, or at once with the manager's IT auto-approve; the file keeps its other lines, mode 600, a backup kept, then its unit restarts. The only way to write a credential file. Targets: ${INSTALL_TARGETS.map((t) => `${t.file} (${t.name})`).join(', ')}; or an app's own Settings, then its Test: ${APP_TARGETS.map((t) => `"${t.id}"`).join(', ')}.`,
      {
        key: z.string().min(1).max(80).describe('The Providers key: its id, name, or provider when it has one key, e.g. "openai"'),
        target: z.string().min(2).max(300).describe('One of the targets above, e.g. "/etc/clipfarm/clipfarm.env" or "clipfarm app"'),
        var_name: z.string().min(1).max(64).describe('e.g. "OPENAI_API_KEY"'),
        part: z.enum(['id', 'secret']).optional().describe('For an "id:secret" pair (Twitch): which half, e.g. TWITCH_CLIENT_ID → id'),
        why: z.string().min(1).max(300).optional().describe('For the card: why, in a sentence'),
      },
      (a) => run(() => h.installKey(a)),
    ),
    tool(
      'save_provider_key',
      'The manager pasted a key in chat (value), or sent it as a file (file: its id; a Google Cloud service account JSON): save it in Settings → Providers right away (tested where the provider allows); the chat shows "•••• (saved to Providers as …)" instead of a pasted one, and a file is deleted. Then install_key puts it where it is used. Never repeat the value in your reply.',
      {
        provider: z.enum(PROVIDERS.filter((p) => p.home === 'providers' && p.auth === 'api-key').map((p) => p.id) as [string, ...string[]]).describe('e.g. "openai", "twitch", "youtube", "postiz", or "other-key" for anything else'),
        value: z.string().min(1).max(400).optional().describe('The key exactly as pasted; Twitch: "client_id:client_secret"'),
        file: z.string().regex(/^[a-f0-9]{24}$/).optional().describe('Instead of value: the file id of a key file sent in chat'),
        label: z.string().min(1).max(60).optional().describe('Its name, e.g. "Twitch (clipfarm)"'),
        uses: z.string().min(1).max(200).optional().describe('What uses it, e.g. "clipfarm transcription"'),
      },
      (a) => run(() => h.saveProviderKey(a)),
    ),
    tool(
      'cloudflare',
      "Cloudflare through the office's own key (never shown to you): tunnel_ingress_get and token_scopes read now (token_scopes names any missing permission); tunnel_ingress_add (hostname → service before the catch-all, every rule kept), dns_cname_ensure (proxied CNAME to the tunnel), access_app_ensure (an email allow-list, optional bypass paths; idps adds logins by name, keeping the app's others), access_idp_ensure (the Entra ID login from provider_action entra entra_app_ensure's app; its secret stays in the office) and access_service_token_ensure (a service token by name with a Service Auth policy on the hostname's app; its secret goes only into env_file as CF_ACCESS_CLIENT_ID/SECRET, mode 600) put a diff card to the manager with Approve / Not now, then apply and read back.",
      {
        op: z.enum(CF_OPS),
        hostname: z.string().min(4).max(253).optional().describe('e.g. "clip.techinsiderbytes.com"; needed by the writes'),
        service: z.string().min(1).max(200).optional().describe('tunnel_ingress_add: e.g. "http://localhost:80"'),
        tunnel: z.string().min(1).max(100).optional().describe("The tunnel's name or id, when the account has several"),
        emails: z.array(z.string().email().max(200)).min(1).max(50).optional().describe('access_app_ensure: who may sign in'),
        bypass: z.array(z.string().min(1).max(200)).max(10).optional().describe('access_app_ensure: paths without sign-in, e.g. ["/api/health"]'),
        idps: z.array(z.string().min(1).max(60)).max(10).optional().describe('access_app_ensure: logins to add by name, e.g. ["Entra ID"]'),
        auto_redirect: z.boolean().optional().describe('access_app_ensure: skip the login picker (only with one login)'),
        name: z.string().min(1).max(100).optional().describe('access_service_token_ensure: the token\'s name, e.g. "clipfarm e2e"; access_idp_ensure: the login\'s name (default "Entra ID")'),
        duration: z.string().min(2).max(10).optional().describe('access_service_token_ensure: e.g. "8760h" (Cloudflare\'s default when left out)'),
        env_file: z.string().min(2).max(500).optional().describe("access_service_token_ensure: the absolute path of the env file the service reads; left out, one in the office's own secrets folder"),
        why: z.string().min(1).max(300).optional().describe('For the card: why, in a sentence'),
      },
      (a) => run(() => h.cloudflare(a)),
    ),
  ];
}

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
      "Report an office problem to the IT department: the test lab times out or loses a result, a port is taken, a sign-in screen, the disk is full, a preview won't start, CI is down. Returns a ticket number at once and what to do meanwhile. Report instead of sleep-looping or retrying blindly; a repeat joins the open ticket. Also for what needs a Providers key (rerun CI, a repo setting, a key's models): IT does it with the office's key; you never get the key.",
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
