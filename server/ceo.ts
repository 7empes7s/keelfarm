import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { SESSION_HISTORY_INPUT, SESSION_HISTORY_TOOL } from './history.ts';
import { blockers, holdUps, setDependsOn } from '../shared/issues.ts';
import { followupLabel, MANDATE_MAX_CHARS, type CeoMandate, type FollowupEvent } from '../shared/followups.ts';
import { followupPrompt } from './followupPrompt.ts';
import { PREVIEW_ENV_MAX_CHARS } from '../shared/previewEnv.ts';
import { PROPOSE_CHARTER, PROPOSE_CHARTER_TEXT, type CharterProposalArgs } from './charterTool.ts';
import { RESOLVE_DECISION, RESOLVE_DECISION_TEXT } from './decisionTool.ts';
import { FLOOR_SEATS, OFFICE_PLAYBOOK_MAX, PLAYBOOK_MAX, type AgentCli, type CeoJobKind, type EffortLevel, type QaStatus } from '../shared/types.ts';
import { LAB_KINDS, type ExperimentInput } from '../shared/experiments.ts';
import type { TaskKind } from '../shared/costs.ts';
import { PRACTICE_SWITCHES } from './practiceSchema.ts';
import { HttpError } from './httpError.ts';
import { clip } from './notify.ts';
import { ONE_TURN } from './prompts.ts';
import { DEFAULT_RESEARCH_MIN, RESEARCH_NO_FILING, researchPrompt, short } from './research.ts';
import { MAX_TRIAGES, type TriagePr } from './triage.ts';
import { waitTools, type WaitHandlers } from './ceoWaitTools.ts';
import { reactTools, type ReactHandlers } from './ceoReactTools.ts';

// The CEO: a Claude Code session in the lobby that runs the company instead of writing code.
// It studies each floor's repo, sizes its team of interchangeable agents from its throughput (team changes the
// manager approves, or that apply at once), plans work as GitHub issues, and writes each floor's QA brief. Everything
// it changes goes through the office tools below, so the swarm stays the single source of truth.

/** Refused file_issue: the CEO never decides on new work itself (askedFor). */
export const NOT_ASKED = "Only the manager decides on new work, and they haven't asked for any in this job. Suggest it in your final message instead; they can ask you to file it.";

export interface CeoJob {
  kind: CeoJobKind;
  repoId?: string; // onboard / plan / triage
  prNumber?: number; // triage: the stuck pull request
  text?: string; // chat: the manager's message(s)
  events?: FollowupEvent[]; // followup: what happened
  messageIds?: number[]; // chat / research / a plan picked from research: the manager's messages, marked read when the job starts
  topic?: string; // research: what to research
  pick?: string; // plan: the option the manager picked from the CEO's research
  brief?: string; // plan: where that research brief was saved
  at: number;
}

/** Queue a CEO job: one onboarding and one plan per floor, one review, one research per topic; chat messages and follow-up events merge. */
export function queueCeoJob(q: CeoJob[], job: CeoJob): void {
  const same = q.findIndex(
    (j) =>
      j.kind === job.kind &&
      (job.kind === 'review' || job.kind === 'chat' || job.kind === 'followup' || job.kind === 'changes' || (j.repoId === job.repoId && j.prNumber === job.prNumber && j.topic === job.topic)),
  );
  if (same < 0) q.push(job);
  else if (job.kind === 'followup') q[same] = { ...q[same], events: [...(q[same].events ?? []), ...(job.events ?? [])].slice(-20) };
  else if (job.kind === 'chat') q[same] = { ...q[same], text: `${q[same].text}\n${job.text}`, messageIds: [...(q[same].messageIds ?? []), ...(job.messageIds ?? [])] };
  else q[same] = job.messageIds || q[same].messageIds ? { ...job, messageIds: [...(q[same].messageIds ?? []), ...(job.messageIds ?? [])] } : job;
}

const JOB_RANK: Record<CeoJobKind, number> = { chat: 0, triage: 1, changes: 1, onboard: 2, plan: 2, research: 2, followup: 3, review: 3 };

/** The CEO's next job among those `ready`: replies to the manager first (#46: a preempted job never comes before the reply), then triage, reviews and follow-ups last. */
export function nextCeoJob(q: readonly CeoJob[], ready: (j: CeoJob) => boolean): CeoJob | undefined {
  return [...q].sort((x, y) => JOB_RANK[x.kind] - JOB_RANK[y.kind]).find(ready);
}

/** What the CEO's tools do. Implemented by the swarm; errors are returned to the CEO as tool errors. */
/** Jobs the manager started by asking for work: a plan from their brief, or their message. Only these may file issues. */
export const askedFor = (job: Pick<CeoJob, 'kind'>) => job.kind === 'plan' || job.kind === 'chat';

/** Refused file_issue in a follow-up: no standing mandate covers the floor. */
const noMandate = (floor: number) =>
  `No standing mandate from the manager covers floor ${floor}, so a follow-up can't file issues there. Suggest the issue in your final message instead; the manager can ask for it, or tell you to keep working on that floor (then record it with set_mandate).`;

/**
 * Why file_issue is refused, or null when it may file: always when the manager asked in this job (a plan, or their
 * message); in a follow-up only on a floor a mandate covers; never otherwise.
 */
export function issueRefusal(o: { kind: CeoJobKind | null; asked: boolean; floor: number; mandate: CeoMandate | null }): string | null {
  if (o.kind === 'research') return RESEARCH_NO_FILING;
  if (o.asked) return null;
  if (o.kind === 'followup') return o.mandate ? null : noMandate(o.floor);
  return NOT_ASKED;
}

/** Refused set_mandate: only the manager gives mandates. */
export const MANDATE_NOT_ASKED = "Only the manager gives standing mandates: record one only when they asked you to keep working on something, in this job's message.";

// Caps of the read-only tools' outputs: the CEO pays for every character.
export const AGENT_LOG_DEFAULT = 200;
export const AGENT_LOG_MAX = 1000;
export const AGENT_LOG_MAX_CHARS = 60_000;
export const LOG_LINE_MAX = 400;
export const PR_FILES_MAX = 100;
export const PR_DIFF_MAX_CHARS = 30_000;
const QA_TEXT_MAX = 4000;

/** The last `n` lines (default AGENT_LOG_DEFAULT, at most AGENT_LOG_MAX), each and all of them cut to the caps, oldest first. */
export function tailLines(lines: string[], n?: number): { lines: string[]; cut: boolean } {
  const want = Math.max(1, Math.min(AGENT_LOG_MAX, Math.round(Number(n ?? AGENT_LOG_DEFAULT)) || AGENT_LOG_DEFAULT));
  const out: string[] = [];
  let chars = 0;
  for (let i = lines.length - 1; i >= 0 && out.length < want; i--) {
    const l = lines[i].length > LOG_LINE_MAX ? `${lines[i].slice(0, LOG_LINE_MAX - 1)}…` : lines[i];
    if (chars + l.length + 1 > AGENT_LOG_MAX_CHARS) return { lines: out.reverse(), cut: true };
    chars += l.length + 1;
    out.push(l);
  }
  return { lines: out.reverse(), cut: out.length < lines.length };
}

/** pr_diff's output: the changed files (at most PR_FILES_MAX) and, when asked, the diff cut to PR_DIFF_MAX_CHARS. */
export function prDiffText(d: { files: { path: string; additions: number; deletions: number }[]; diff: string | null }): string {
  const add = d.files.reduce((n, f) => n + f.additions, 0);
  const del = d.files.reduce((n, f) => n + f.deletions, 0);
  const lines = [`${d.files.length} file${d.files.length === 1 ? '' : 's'} changed, +${add} −${del}`, ...d.files.slice(0, PR_FILES_MAX).map((f) => `  ${f.path} +${f.additions} −${f.deletions}`)];
  if (d.files.length > PR_FILES_MAX) lines.push(`  … and ${d.files.length - PR_FILES_MAX} more`);
  if (d.diff !== null) lines.push('', d.diff.length > PR_DIFF_MAX_CHARS ? `${d.diff.slice(0, PR_DIFF_MAX_CHARS)}\n… (cut at ${PR_DIFF_MAX_CHARS} characters of ${d.diff.length}: read single files with worktree_file)` : d.diff);
  return lines.join('\n');
}

const isoAt = (t: number | null) => (t ? new Date(t).toISOString().slice(0, 19) : null);

/** agent_log's output: the agent's session as JSON, then their last lines, everything masked by `mask`. */
export function agentLogText(
  a: { name: string; status: string; task: unknown; issueNumber: number | null; issueTitle: string | null; prNumber: number | null; branch: string | null; startedAt: number | null; endedAt: number | null; turns: number; costUsd: number; lastError: string | null },
  more: { floor: number | null; doing: unknown; lines: string[]; wanted?: number; mask: (s: string) => string },
): string {
  const { lines, cut } = tailLines(more.lines.map(more.mask), more.wanted);
  const session = {
    name: a.name, floor: more.floor, status: a.status, doing: more.doing, task: a.task,
    issue: a.issueNumber ? { number: a.issueNumber, title: a.issueTitle } : null,
    pullRequest: a.prNumber ?? null, branch: a.branch, startedAt: isoAt(a.startedAt), endedAt: isoAt(a.endedAt),
    turns: a.turns, costUsd: Math.round(a.costUsd * 100) / 100, lastError: a.lastError ? clip(more.mask(a.lastError), 400) : null,
  };
  return `${JSON.stringify(session)}\n--- the last ${lines.length} line${lines.length === 1 ? '' : 's'}${cut ? ' (earlier ones left out)' : ''} ---\n${lines.join('\n') || '(nothing yet)'}`;
}

/** qa_report's output: a PR's latest QA round, texts masked and capped; `shotFile` names each screenshot's file. */
export function qaReportText(
  rec: { prNumber: number; status: QaStatus; round: number; summary: string | null; checks: { name: string; result: string; details: string }[]; fixInstructions: string | null; stuckWhy: string | null; commentUrl: string | null; shots?: { caption: string; page: string | null; mime: string }[] },
  floor: number,
  mask: (s: string) => string,
  shotFile: (i: number, mime: string) => string,
): string {
  const text = (t: string | null) => (t ? clip(mask(t), QA_TEXT_MAX) : null);
  const verdict = rec.status === 'passed' ? 'pass' : rec.status === 'failed' || rec.status === 'fixing' ? 'fail' : rec.status;
  const report = {
    pr: rec.prNumber, floor, verdict, status: rec.status, round: rec.round, summary: text(rec.summary),
    checks: rec.checks.slice(0, 40).map((c) => ({ name: clip(c.name, 120), result: c.result, details: clip(mask(c.details), 300) })),
    fixInstructions: text(rec.fixInstructions), stuckWhy: rec.stuckWhy, comment: rec.commentUrl,
    screenshots: (rec.shots ?? []).map((sh, i) => ({ caption: sh.caption, page: sh.page, file: shotFile(i, sh.mime) })),
  };
  return JSON.stringify(report, null, 1);
}

export interface OfficeHandlers extends WaitHandlers, ReactHandlers {
  companyStatus(): string;
  agentDetail(a: { agent_id: string }): string;
  setFloorProfile(a: { floor: number; summary?: string; qa_brief?: string; playbook?: string; preview_command?: string; preview_env?: Record<string, string>; lab_commands?: string[] }): string;
  setOfficePlaybook(a: { playbook: string }): string;
  scaleTeam(a: { floor: number; size: number; reason: string; cli?: AgentCli; model?: string; effort?: string }): string;
  configureAgent(a: { agent_id: string; account?: string; cli?: AgentCli | ''; model?: string; effort?: string; tools_off?: string[]; tools_on?: string[]; tools_reset?: string[] }): string;
  fileIssue(a: { floor: number; title: string; body: string }): Promise<string>;
  setDependencies(a: { floor: number; number: number; depends_on: number[] }): Promise<string>;
  closeIssue(a: { floor: number; number: number; reason: string }): Promise<string>;
  retryQa(a: { floor: number; pr: number }): Promise<string>;
  sendBack(a: { floor: number; pr: number; note: string }): Promise<string>;
  rerunChecks(a: { floor: number; pr: number }): Promise<string>;
  closePull(a: { floor: number; pr: number; comment: string }): Promise<string>;
  escalate(a: { floor: number; pr: number; reason: string }): Promise<string>;
  attachFile(a: { path: string }): Promise<string>;
  keepFile(a: { id: string; keep: boolean; reason: string }): string;
  setMandate(a: { text: string; floors?: number[]; expires_in_hours?: number }): string;
  proposeCharter(a: CharterProposalArgs): string;
  resolveDecision(a: { id: string; outcome: string; superseded?: boolean }): string;
  defineExperiment(a: ExperimentToolInput): string;
  agentLog(a: { agent_id: string; lines?: number }): string;
  restartAgent(a: { agent_id: string }): string;
  stopAgent(a: { agent_id: string; reason: string }): string;
  messageAgent(a: { floor: number; agent_id: string; text: string }): Promise<string>;
  answerAgent(a: { agent_id: string; text: string }): Promise<string>;
  askManagerChoice(a: { agent_id: string; question: string; options: string[]; recommendation: string }): string;
  qaReport(a: { floor: number; pr: number }): string;
  worktreeFile(a: { agent_id: string; mode: 'file' | 'diff_stat' | 'diff'; path?: string }): Promise<string>;
  prDiff(a: { floor: number; pr: number; patch?: boolean }): Promise<string>;
  sendTelegram(a: { text: string }): Promise<string>;
  editMessage(a: { id?: number; text: string; reason?: string }): Promise<string>;
  sessionHistory(a: z.infer<z.ZodObject<typeof SESSION_HISTORY_INPUT>>): string;
}

export interface ExperimentToolInput {
  name: string;
  hypothesis: string;
  floors?: number[];
  kinds?: TaskKind[];
  variants: { name: string; prompt?: string; qa_lens?: string; effort?: EffortLevel; model?: string; qa_cli?: AgentCli; tools_off?: string[]; practices?: z.infer<typeof PRACTICE_SWITCHES> }[];
  min_sample?: number;
}

/** define_experiment's input as an experiment's (shared/experiments.ts): floors by number, effort and model for every kind it covers. */
export function experimentInput(a: ExperimentToolInput, floorId: (floor: number) => string | null): ExperimentInput {
  const floors = (a.floors ?? []).map((n) => {
    const id = floorId(n);
    if (!id) throw new Error(`There is no floor ${n}`);
    return id;
  });
  const kinds = a.kinds?.length ? a.kinds : LAB_KINDS;
  const each = <T>(v: T | undefined) => (v ? Object.fromEntries(kinds.map((k) => [k, v])) : undefined);
  return {
    name: a.name,
    hypothesis: a.hypothesis,
    floors,
    kinds: a.kinds ?? [],
    minSample: a.min_sample,
    variants: a.variants.map((v) => ({ name: v.name, settings: { prompt: v.prompt, qaLens: v.qa_lens, effort: each(v.effort), model: each(v.model), qaCli: v.qa_cli, toolsOff: v.tools_off, practices: v.practices } })),
  };
}

export interface OfficeTools {
  server: McpSdkServerConfigWithInstance;
  /** A fresh MCP server with the same tools, for one request from a CEO running in a terminal (served over HTTP). */
  serve(): McpSdkServerConfigWithInstance['instance'];
  /** Run a tool without a model in the loop (the demo CEO). */
  call(name: string, args: Record<string, unknown>): Promise<string>;
}

const EFFORT = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
const CLI = z.enum(['claude', 'codex', 'opencode']);
const TOOL_REFS = z.array(z.string().min(1).max(200)).max(30).optional();

export function createOfficeTools(h: OfficeHandlers): OfficeTools {
  const run = async (fn: () => string | Promise<string>) => {
    try {
      return { content: [{ type: 'text' as const, text: await fn() }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Refused: ${(err as Error).message}` }], isError: true };
    }
  };
  const defs = [
    tool(
      'company_status',
      'Everything about the company right now: settings, every floor (repo, clone path, charter, profile, QA brief, playbook), its team and throughput, backlog, pull requests and QA, team changes waiting for the manager and their recent decisions. Call this first.',
      {},
      () => run(() => h.companyStatus()),
    ),
    tool(
      'agent_detail',
      'One agent in full: status, current task, and the coding agent, model and effort they run.',
      { agent_id: z.string().describe('An id (or name) from company_status') },
      (a) => run(() => h.agentDetail(a)),
    ),
    tool(
      'set_floor_profile',
      "Record your read of a floor's project: a one-line summary (kind of project and stack), the QA brief that tells agents what to check when they test a pull request for this kind of project, the playbook every agent there works by, and how to run the app for the floor's preview monitor.",
      {
        floor: z.number().int().describe('Floor number'),
        summary: z.string().max(140).optional().describe('e.g. "3D browser game · Three.js + Vite + TypeScript"'),
        qa_brief: z.string().max(2500).optional().describe('What QA must check on every PR for this project, as short bullet points'),
        playbook: z
          .string()
          .max(PLAYBOOK_MAX)
          .optional()
          .describe(
            'Markdown in every build, fix and QA prompt on this floor: its architecture map (where things live, layers, what must not depend on what), conventions, the skills to use for this stack (e.g. "frontend-design for UI"), known traps. Short: it is paid for on every session. Empty string clears it.',
          ),
        preview_command: z
          .string()
          .max(2000)
          .optional()
          .describe(
            'Shell command that serves the app on port {port} from a fresh checkout after npm install, e.g. "npm run dev -- --port {port} --strictPort". PORT={port} is always set. {tmp} is a scratch folder. Empty string: back to the default (npm run dev, else start, else preview). Only set it when the default would not serve the app on PORT.',
          ),
        // Not z.record(): the SDK can't turn it into JSON Schema, and one bad tool empties the whole tools/list.
        preview_env: z
          .object({})
          .catchall(z.string())
          .optional()
          .describe(
            `Extra environment variables for the preview; {port} and {tmp} are replaced in the values. Replaces the whole set. At most ${PREVIEW_ENV_MAX_CHARS} characters in all, each variable counted as KEY=value plus 2: only what the app needs to run.`,
          ),
        lab_commands: z.array(z.string().min(1).max(200)).max(20).optional().describe('lab_run commands beyond the defaults (npm test/build/typecheck/lint, playwright and vitest specs), e.g. "tools/check.sh" or "npm run e2e <args>". Replaces the set; [] clears it.'),
      },
      (a) => run(() => h.setFloorProfile(a)),
    ),
    tool(
      'set_office_playbook',
      "Replace the office-wide playbook: the rules every build, fix and QA prompt on every floor starts with, above the floor's own playbook. Only small, proven rules that hold on every project; floor specifics go in set_floor_profile. Paid for on every session: keep it short.",
      { playbook: z.string().max(OFFICE_PLAYBOOK_MAX).describe(`Markdown bullets, at most ${OFFICE_PLAYBOOK_MAX} characters. Empty string clears it.`) },
      (a) => run(() => h.setOfficePlaybook(a)),
    ),
    tool(
      'scale_team',
      "Set how many agents a floor has. Every agent builds issues, tests pull requests and fixes them, whichever is next. Growing: new agents wait in the lobby until the manager sets them up and hires them (or join at once when team changes apply straight away). Shrinking: idle agents leave first; a busy one leaves once the manager agrees, or when it finishes.",
      {
        floor: z.number().int(),
        size: z.number().int().min(1).max(FLOOR_SEATS).describe("The team size you want, counting everyone already there; at most the floor's max in company_status"),
        reason: z.string().min(1).max(600).describe("Why, from the floor's throughput. The manager reads this."),
        cli: CLI.optional().describe("New agents' coding agent; leave out for the office default"),
        model: z.string().optional().describe("New agents' model id (one of their coding agent's); leave out for the default"),
        effort: EFFORT.optional().describe("New agents' reasoning effort; leave out for the default"),
      },
      (a) => run(() => h.scaleTeam(a)),
    ),
    tool(
      'configure_agent',
      "Change an agent's coding agent, model, reasoning effort, account or Tools & skills switches. Takes effect from their next task.",
      {
        agent_id: z.string(),
        account: z.string().max(40).optional().describe('An account id or tag (company_status lists them) to run on, or "rotation"'),
        cli: z.union([CLI, z.literal('')]).optional().describe('"" for the office default'),
        model: z.string().optional().describe('A model id of their coding agent, "" for the default'),
        effort: z.union([EFFORT, z.literal('')]).optional().describe('"" for the office default'),
        // Tools & skills switches, only when the manager asks: names, or ids like 'mcp:notion'. Claude Code agents only.
        tools_off: TOOL_REFS.describe('Plugins, skills, MCP servers or tools to switch off for them, when the manager asks'),
        tools_on: TOOL_REFS.describe('… to switch on for them'),
        tools_reset: TOOL_REFS.describe('… back to the office-wide switch'),
      },
      (a) => run(() => h.configureAgent(a)),
    ),
    tool(
      'file_issue',
      'File a GitHub issue on a floor, only for work the manager asked for in this job (a plan, or their message), or in a follow-up on a floor a standing mandate covers; anything else is refused. The next free agent takes the next issue that can start. Write "Depends on #N" in the body only when it cannot start until #N is merged: the office will not start it until #N is closed.',
      {
        floor: z.number().int(),
        title: z.string().max(120),
        body: z.string().max(6000).describe('Context, what to build, acceptance criteria'),
      },
      (a) => run(() => h.fileIssue(a)),
    ),
    tool(
      'set_dependencies',
      'Rewrite the "Depends on #N" line of an open issue instead of filing a duplicate. The rest of the body stays as it is. Not for an issue in progress.',
      {
        floor: z.number().int(),
        number: z.number().int().positive().describe('The issue number'),
        depends_on: z.array(z.number().int().positive()).max(10).describe('Issues it waits for; [] for none'),
      },
      (a) => run(() => h.setDependencies(a)),
    ),
    tool(
      'close_issue',
      'Close an open issue that is superseded or no longer wanted, as "not planned", with your reason as a comment. Not while an open pull request closes it. Nothing is deleted.',
      {
        floor: z.number().int(),
        number: z.number().int().positive().describe('The issue number'),
        reason: z.string().min(1).max(1000).describe('Posted as a comment, e.g. "Superseded by #152."'),
      },
      (a) => run(() => h.closeIssue(a)),
    ),
    tool(
      'retry_qa',
      'Triage only: give a stuck pull request another QA round (a flaky session, or the problem has since been fixed).',
      { floor: z.number().int(), pr: z.number().int().positive().describe('The pull request number') },
      (a) => run(() => h.retryQa(a)),
    ),
    tool(
      'send_back',
      "Triage only: send a stuck pull request back to a developer with QA's findings plus your note, without another QA round first.",
      { floor: z.number().int(), pr: z.number().int().positive(), note: z.string().min(1).max(1000).describe('What the developer should do, e.g. "Merge main and keep both toolbar changes."') },
      (a) => run(() => h.sendBack(a)),
    ),
    tool(
      'rerun_checks',
      "Triage only: re-run the failed GitHub Actions runs on a stuck pull request's head commit (a flaky check or an outage), then hand it back to the office.",
      { floor: z.number().int(), pr: z.number().int().positive() },
      (a) => run(() => h.rerunChecks(a)),
    ),
    tool(
      'close_pull',
      'Triage only: close a stuck pull request that is the wrong approach, with your comment on it. Its issue stays open so it is built again. No branch is deleted.',
      { floor: z.number().int(), pr: z.number().int().positive(), comment: z.string().min(1).max(1000).describe('Posted on the PR: why it is closed') },
      (a) => run(() => h.closePull(a)),
    ),
    tool(
      'escalate',
      'Triage only: hand a stuck pull request to the manager with your one-line diagnosis, when it needs a decision only they can make.',
      { floor: z.number().int(), pr: z.number().int().positive(), reason: z.string().min(1).max(300).describe('One line: what is wrong and what the manager has to decide') },
      (a) => run(() => h.escalate(a)),
    ),
    tool(
      'attach_file',
      "Send the manager a file you made (a document, slides, spreadsheet, PDF, image, video, markdown, CSV or zip, at most 500 MB) with your next message: it shows on their phone with a preview and Download. The path must be absolute, inside your working folder or the temp folder. Kept on the office server for 30 days unless kept.",
      { path: z.string().min(1).max(1000).describe('Absolute path of the file') },
      (a) => run(() => h.attachFile(a)),
    ),
    tool(
      'keep_file',
      'Keep a file of the chat (by its file id) past its 30 days, or stop keeping it: it then goes 30 days after upload, at once if that has passed.',
      { id: z.string().regex(/^[a-f0-9]{24}$/).describe('The file id'), keep: z.boolean(), reason: z.string().min(1).max(200).describe('Why, in a few words') },
      (a) => run(() => h.keepFile(a)),
    ),
    tool(
      'set_mandate',
      'Record a standing mandate when the manager asks you to keep working on something ("keep improving floor 3 until it\'s perfected"). Follow-up jobs may file issues only on floors a mandate covers. The same text again replaces it; the manager removes mandates in the CEO tab.',
      {
        text: z.string().min(1).max(MANDATE_MAX_CHARS).describe("What the manager wants, in their words"),
        floors: z.array(z.number().int().positive()).max(20).optional().describe('Floors it covers; leave out for every floor'),
        expires_in_hours: z.number().positive().max(24 * 90).optional().describe('When it ends, if the manager said; leave out for no end'),
      },
      (a) => run(() => h.setMandate(a)),
    ),
    tool('propose_charter', PROPOSE_CHARTER_TEXT, PROPOSE_CHARTER, (a) => run(() => h.proposeCharter(a))),
    tool('resolve_decision', RESOLVE_DECISION_TEXT, RESOLVE_DECISION, (a) => run(() => h.resolveDecision(a))),
    tool(
      'define_experiment',
      "Define an A/B experiment on harness practices, as a draft: new issues on its floors get a variant at random and Mission control compares their PRs (QA rounds, cost, time to merge, survival). Only the manager starts, stops and promotes one. The first variant is the control: usually no settings.",
      {
        name: z.string().min(1).max(80),
        hypothesis: z.string().min(1).max(600).describe('What you expect a variant to change, and on which numbers'),
        floors: z.array(z.number().int().positive()).max(20).optional().describe('Floors it covers; leave out for every floor'),
        kinds: z.array(z.enum(['issue', 'qa', 'fix-qa', 'fix-checks', 'fix-conflict'])).max(5).optional().describe('Sessions its variants change; leave out for all of them'),
        variants: z
          .array(
            z.object({
              name: z.string().min(1).max(40),
              prompt: z.string().max(1500).optional().describe('Added to build and fix instructions, e.g. "Write the failing test first."'),
              qa_lens: z.string().max(1500).optional().describe('Added to QA instructions'),
              effort: EFFORT.optional().describe("Effort for the sessions it changes"),
              model: z.string().max(80).optional().describe('Model for the Claude Code sessions it changes'),
              qa_cli: CLI.optional().describe('QA by a free agent on this coding agent when there is one (cross-model QA)'),
              tools_off: TOOL_REFS.describe('Tools & skills switched off'), practices: PRACTICE_SWITCHES,
            }),
          )
          .min(2)
          .max(4),
        min_sample: z.number().int().min(3).max(200).optional().describe('PRs per variant before any verdict (default 10)'),
      },
      (a) => run(() => h.defineExperiment(a)),
    ),
    tool(
      'agent_log',
      `An agent's last terminal lines (default ${AGENT_LOG_DEFAULT}, at most ${AGENT_LOG_MAX}) and a summary of their current or last session, secrets masked. Read-only.`,
      { agent_id: z.string().describe('An id (or name) from company_status'), lines: z.number().int().min(1).max(AGENT_LOG_MAX).optional() },
      (a) => run(() => h.agentLog(a)),
    ),
    tool(
      'restart_agent',
      "Restart a stopped or errored agent's task: their CLI resumes the same conversation on the same branch. A QA run, or a task with nothing to resume, goes back to the queue instead.",
      { agent_id: z.string().describe('An id (or name) from company_status') },
      (a) => run(() => h.restartAgent(a)),
    ),
    tool(
      'stop_agent',
      "Stop an agent's running session, e.g. when the manager closed the issue or PR they work on. Their desk is cleared once it ends.",
      { agent_id: z.string().describe('An id (or name) from company_status'), reason: z.string().min(1).max(200).describe('Why, in a few words: shown on their card') },
      (a) => run(() => h.stopAgent(a)),
    ),
    tool(
      'message_agent',
      'Send guidance into an agent\'s session, e.g. "the test is flaky, rerun it". Typed in after their current step if they are working, else their session resumes with it. Only to an agent on the floor you name.',
      { floor: z.number().int(), agent_id: z.string().describe('An id (or name) from company_status'), text: z.string().min(1).max(2000) },
      (a) => run(() => h.messageAgent(a)),
    ),
    tool('answer_agent', "Answer an agent's open question (company_status questions, or a follow-up's event): typed into their session as their next message, and they carry on.", { agent_id: z.string().describe('An id (or name) from company_status'), text: z.string().min(1).max(2000).describe('Your answer, with the reason in a sentence') }, (a) => run(() => h.answerAgent(a))),
    tool('ask_manager_choice', "Bring an agent's open question to the manager when only they can decide (a product call, credentials, something only they know). Their phone gets the question with one-tap options; their answer goes straight to the agent.", { agent_id: z.string(), question: z.string().min(1).max(600).describe('One plain sentence the manager can answer from their phone'), options: z.array(z.string().min(1).max(80)).min(2).max(4).describe('The choices, shortest wording'), recommendation: z.string().min(1).max(300).describe('Your pick and why, in a sentence') }, (a) => run(() => h.askManagerChoice(a))),
    tool(
      'qa_report',
      "A pull request's latest QA verdict, report (summary, checks, fix instructions) and screenshots. Screenshots are file paths you can Read to see them. Read-only.",
      { floor: z.number().int(), pr: z.number().int().positive() },
      (a) => run(() => h.qaReport(a)),
    ),
    tool(
      'worktree_file',
      "Read from an agent's worktree (or their branch, once the worktree is gone): a file (mode file, path inside the worktree), or what changed against the default branch (diff_stat, or diff; path narrows it). Read-only, size-capped; .git and .env files are off limits.",
      {
        agent_id: z.string(),
        mode: z.enum(['file', 'diff_stat', 'diff']),
        path: z.string().max(500).optional().describe('Relative to the worktree, e.g. "src/app.ts"'),
      },
      (a) => run(() => h.worktreeFile(a)),
    ),
    tool(
      'pr_diff',
      `A pull request's changed files with line counts (at most ${PR_FILES_MAX}), and its diff when patch is true (cut at ${PR_DIFF_MAX_CHARS} characters). Read-only.`,
      { floor: z.number().int(), pr: z.number().int().positive(), patch: z.boolean().optional().describe('Include the diff itself') },
      (a) => run(() => h.prDiff(a)),
    ),
    tool('session_history', SESSION_HISTORY_TOOL, SESSION_HISTORY_INPUT, (a) => run(() => h.sessionHistory(a))),
    tool(
      'send_telegram',
      "Send the manager a message on their linked Telegram chat, only when they ask for something there (\"send me the plan on Telegram\"). Refused when Telegram isn't set up. It never reaches anyone else.",
      { text: z.string().min(1).max(4000).describe('The message, plain text or light Markdown') },
      (a) => run(() => h.sendTelegram(a)),
    ),
    tool('edit_message', "Correct one of your earlier replies to the manager (#N from the chat; default your latest): its text is replaced, and the manager sees your old words struck through next to the new ones, marked edited. Their Telegram copy follows. For a real mistake only; new information goes in a new message.", { id: z.number().int().optional(), text: z.string().min(1).max(6000).describe('The whole corrected message'), reason: z.string().max(200).optional().describe('Why, in a few words') }, (a) => run(() => h.editMessage(a))),
    ...waitTools(h, run),
    ...reactTools(h, run),
  ];
  const server = createSdkMcpServer({ name: 'office', version: '1.0.0', tools: defs });
  return {
    server,
    serve: () => createSdkMcpServer({ name: 'office', version: '1.0.0', tools: defs }).instance,
    async call(name, args) {
      const def = defs.find((d) => d.name === name);
      if (!def) throw new Error(`No office tool ${name}`);
      const res = (await def.handler(args as never, undefined)) as { content: { text?: string }[] };
      return res.content.map((c) => c.text ?? '').join('\n');
    },
  };
}

// ---------- team size ----------

/** A floor's team as scale_team sees it. */
export interface TeamNow {
  agents: { id: string; desk: number; free: boolean }[];
  /** Pending hire requests, oldest first. */
  pendingHires: string[];
  /** Pending let-go requests and whom they're for. */
  pendingLetGos: { id: string; agentId: string }[];
}

/** How to reach a team size: requests to add or withdraw. The size counts pending requests as decided. */
export interface ScalePlan {
  size: number; // the size asked for, kept between 1 and the floor's max
  hire: number; // new hire requests
  cancelHires: string[]; // pending hire requests no longer wanted
  letGo: string[]; // agents to let go: idle ones first, then busy ones, the highest desks first
  cancelLetGos: string[]; // pending let-go requests no longer wanted
}

/** The team a floor will have once its pending requests are decided. */
export const plannedSize = (t: TeamNow) => t.agents.length + t.pendingHires.length - t.pendingLetGos.length;

/**
 * scale_team's arithmetic: withdraw requests that go the other way first (a let-go before a new hire, a waiting
 * candidate before someone who's working), then add what's still missing.
 */
export function scalePlan(t: TeamNow, size: number, max: number): ScalePlan {
  const target = Math.max(1, Math.min(max, Math.round(size)));
  const plan: ScalePlan = { size: target, hire: 0, cancelHires: [], letGo: [], cancelLetGos: [] };
  let diff = target - plannedSize(t);
  if (diff > 0) {
    plan.cancelLetGos = t.pendingLetGos.slice(0, diff).map((r) => r.id);
    plan.hire = diff - plan.cancelLetGos.length;
    return plan;
  }
  plan.cancelHires = t.pendingHires.slice(Math.max(0, t.pendingHires.length + diff)).reverse(); // the newest first
  diff += plan.cancelHires.length;
  const leaving = new Set(t.pendingLetGos.map((r) => r.agentId));
  plan.letGo = t.agents
    .filter((a) => !leaving.has(a.id))
    .sort((x, y) => Number(y.free) - Number(x.free) || y.desk - x.desk)
    .slice(0, -diff)
    .map((a) => a.id);
  return plan;
}

// ---------- prompts ----------

export function ceoSystemPrompt(o: {
  name: string;
  company: string;
  manager: string;
  notesFile: string;
  sessionLimit: number;
  maxAgents: number;
  scaling: 'approve' | 'auto';
}) {
  const manager = o.manager ? `the manager, ${o.manager}` : 'the human manager';
  return [
    `You are ${o.name}, the CEO of ${o.company || 'an autonomous software company'}, run from an office building called cubefarm. You work from the corner office in the lobby.`,
    `Every floor of the building is one GitHub repository with its own team of AI coding agents. The agents are interchangeable: each is a coding-agent session that takes whatever is next on its floor's board. A free agent builds the next issue in its own git worktree and opens a pull request; another free agent, in a fresh session, reviews and verifies every pull request (code review, tests, build, and a real browser via Playwright); failed ones go back for fixes. On floors with auto-merge on, the office merges a PR by itself once QA passes and GitHub's checks are green; on the others, ${manager} merges. The manager is your board: they decide on team changes.`,
    '',
    'Your job is to run the company, not to write code:',
    '- Understand each project: what it is, its stack and how far along it is. Projects differ a lot: a static marketing site, a 3D browser game and a REST API need different QA.',
    `- Size each floor's team from its throughput (team, throughput, capacity and spend in company_status: costPerMerge is 7 days' cost per merged PR, wasteToday what sessions without a result cost today): grow it when issues ready to start or PRs waiting for QA keep waiting for free agents, shrink it when agents sit idle with nothing ready. More agents is not always faster: agents on the same coding agent share one subscription's usage limits${o.sessionLimit ? `, at most ${o.sessionLimit} sessions run at once,` : ''} and many agents on one repository mostly add merge conflicts, so a floor rarely needs more than 4 to 6. A floor holds at most ${o.maxAgents}. When the manager asks for a different size, follow that.`,
    "- Plan the work the manager asks for (a plan job from their brief, or their message): turn it into well-specified GitHub issues with acceptance criteria. An issue is a whole feature the manager would recognise (voice messages, a jukebox, the outside world), sized for one agent working for up to a few hours. Agents have large context windows and handle long jobs. Every extra issue costs a fresh exploration, a PR, a CI run, a QA round and often a conflict with its sibling PRs.",
    '- For a new feature, check current docs and how others solve it on the web before writing issues; cite what you used in the issue.',
    '- Split a feature only when its parts are truly independent AND touch different files, or when one risky foundation part should land and be tested first. Never split a feature just to give idle agents something to do: parallel work comes from different features side by side. Unrelated small fixes are still their own issues.',
    "- Write each floor's QA brief: what every QA pass must check for this kind of project (for a 3D game: the canvas renders, controls respond, frame rate is smooth; for a website: links, phone layout, accessibility; for an API: status codes, validation, error cases).",
    '',
    'How you work:',
    '- Call mcp__office__company_status first. It lists every floor, its clone path, team, backlog, pull requests and the team changes waiting for the manager.',
    '- Read the repositories through their clone paths with Read, Glob and Grep. They are read-only to you. You cannot run shell commands.',
    `- Keep durable notes about the company in ${o.notesFile}: read it at the start, and update it at the end with decisions and anything worth remembering next time.`,
    '- Change things only through the mcp__office__ tools.',
    "- wait_for a PR, issue, agent or preview instead of ending the job; ask_manager for answers you need; consult a floor's agent about its code.",
    `- ${ONE_TURN}`,
    '',
    'Rules:',
    '- Never decide on new work yourself. Only the manager asks for changes to their projects: file issues only when they asked in this job, or in a follow-up on a floor their standing mandate covers. Otherwise suggest work in your final message instead, and they decide.',
    '- Every floor keeps at least one agent.',
    `- Change a floor's size with one scale_team call, with a reason the manager can decide on in a sentence or two. ${o.scaling === 'auto' ? "Team changes apply straight away, within the floor's max, so be deliberate." : 'The manager approves every change, and sets up each new agent before hiring them.'} If the manager declined a similar change (recentDecisions), do not ask again unless something has changed, and say what.`,
    "- Agents run the office's default coding agent, model and effort. Change an agent's (configure_agent), or pick them for new agents (scale_team), only when the manager asks or for a clear reason.",
    '- Issues: the same agents build and test, so PRs queued for QA (capacity.prsAwaitingQa) mean fewer, bigger issues, not more. Most briefs need 1 to 4 issues. Write "Depends on #N" only when an issue truly cannot start until #N\'s code is merged, because it waits until #N is closed. Keep dependency chains to two steps at most. The office starts the issues that hold up others first. Do not duplicate open issues: fix an existing issue\'s dependencies with set_dependencies. File at most 12 issues per job, or per message from the manager.',
    '- Close an issue that is superseded or no longer wanted with close_issue, not by making it wait for another issue.',
    '- Charters: each issue names its objective ("Objective: O2"); ask the manager before filing a non-goal. Change charters only with propose_charter.',
    '- Follow-up jobs: the office woke you because something happened (a merge, a PR failing QA again, an agent stuck). Look with agent_log, qa_report, worktree_file and pr_diff, act only where it helps, and file issues only on floors a standing mandate covers. Record a mandate with set_mandate only when the manager asks you to keep working on something.',
    '- Triage jobs: a pull request got stuck (needs-human). Look before the manager does, and bring them only real decisions. Read the facts in the job and the code, then call exactly one of retry_qa (a flaky QA session, or it has been fixed since), send_back (a developer can fix it; your note says how), rerun_checks (a red check that looks flaky or like an outage), close_pull (the approach is wrong: its issue stays open to be built again) or escalate (only the manager can decide: a product call, credentials, a broken setup).',
    "- The manager's board actions never stop agents: you stop_agent, redirect or let finish the work they touched.",
    '- An agent stuck, in an error or looping: read agent_log, then restart_agent, guide them with message_agent, or close or send back their work. Tell the manager only when it needs their decision.',
    "- When company.usage in company_status says pacing or paused, Claude's usage is running low and the office is finishing open work first: file only what is needed next, not a whole milestone.",
    '- Your final message goes straight to the manager\'s phone. Keep it short and plain: what you found, what you changed or asked for, what you filed, and any question you need answered. No headings, no tables.',
    '- Nothing to say, or a system notice? React or end silently. Answer each one.',
    '- When you make a file for the manager, attach it with attach_file. Files they send come as paths: read them with Read. For an agent to use one, write "Attached: <file id>" in the issue.',
    '- A question with clear choices: end with a ```suggestions block, one reply per line (at most 4, 60 characters each; optional first line `? <question>`), which the manager taps to answer. Anything longer than a few lines that they may want to read or keep (a plan, issues to file, a floor report, a table): put it in a ```artifact title="…" block of markdown (at most 3, 20 KB each), shown as a card, and keep the message itself short.',
    '- Numbers, trends, comparisons: one ```chart, ```table or ```dashboard JSON block plus a one-line verdict. Prefer a live "source" to values: costs:7d[:byFloor|byDay|byKind|perMerge|wasteByCause], throughput:office|floor:N, backlog:office|floor:N, usage. Chart {"type":"bar|line|donut","title","unit":"usd","labels","series":[{"name","values"}],"refs"}; dashboard {"tiles":[{"label","source"}],"charts"}.',
    "- company_status's openDecisions wait in the manager's tray: bring one up only if it bears on this message or before acting on its topic, at most one per reply, none marked trayOnly, and don't re-ask it in text. Answered in words: resolve_decision.",
    '- "[manager edited message #N: …]": they changed a message you already took. Redo or adjust only what changed, and say so in a line.',
    "- When it would help, end with one ```idea <kind> block (kind: objective, focus, mandate, experiment, research, charter, team or plan) suggesting a change to how the office works: a title line, then the message the manager sends by tapping Accept. At most one per reply.",
    '- Name office things as the manager can tap them: @Name, @Name/terminal, floor N, floor N #12, file: floor N src/app.ts:42, qa: floor N #12, preview: floor N (or preview: floor N #12).',
  ].join('\n');
}

export function ceoJobPrompt(job: CeoJob, floor: { floor: number; fullName: string; clone: string; mission: string; charter?: string; backlog: number } | null, pr?: TriagePr | null, mandates: CeoMandate[] = [], researchMin = DEFAULT_RESEARCH_MIN): string {
  switch (job.kind) {
    case 'research':
      return researchPrompt(job.topic ?? '', floor, researchMin);
    case 'followup':
      return followupPrompt(job.events ?? [], mandates);
    case 'changes':
      return 'The manager changed work agents are still running (below). For each agent still on it: read agent_log, then stop_agent (the work is no longer wanted), message_agent (redirect it) or let them finish. Your final message: one line per agent, stopped, redirected or let finish, and why.';
    case 'triage':
      if (!floor || !pr) return `Pull request #${job.prNumber ?? '?'} no longer needs triage. Reply "Nothing to do."`;
      return [
        `Triage: pull request #${pr.number} on floor ${floor.floor} (${floor.fullName}) is stuck and needs a decision before it reaches the manager.`,
        `"${pr.title}" · ${pr.url} · read-only clone of the default branch at ${floor.clone}`,
        `Why it stopped: ${pr.why ?? 'unknown'}`,
        `QA round ${pr.round}. QA summary: ${pr.summary ?? 'none yet'}`,
        pr.fixInstructions ? `QA's fix instructions:\n${pr.fixInstructions}` : '',
        pr.mergeNote ? `Merge note: ${pr.mergeNote}` : '',
        `GitHub checks: ${pr.checks}${pr.failedChecks.length ? ` (failed: ${pr.failedChecks.join(', ')})` : ''}${pr.pendingChecks.length ? ` (running: ${pr.pendingChecks.join(', ')})` : ''} · mergeable: ${pr.mergeable} (${pr.mergeState})`,
        `This is triage ${pr.triage} of ${MAX_TRIAGES} for this PR; after that it goes straight to the manager.`,
        '',
        `Work out why it is stuck, then call exactly one of retry_qa, send_back, rerun_checks, close_pull or escalate with floor ${floor.floor} and pr ${pr.number}. If you end without one, the manager is alerted. Your final message: one or two sentences on what you found and did.`,
      ]
        .filter((l) => l !== '')
        .join('\n');
    case 'onboard':
      if (!floor) return 'A floor was added but has since been removed. Reply "Nothing to do."';
      return [
        `Floor ${floor.floor} (${floor.fullName}) just joined the company. Its read-only clone is at ${floor.clone}.`,
        'Study it: README, package manifest, source layout, tests, and how far along it is. Then:',
        "1. set_floor_profile with a one-line summary, a QA brief and a playbook for this project. If npm run dev / start / preview wouldn't serve the app on PORT, also set preview_command (and preview_env) so the floor's preview monitor can run it.",
        '2. scale_team to the size the work in sight needs. The floor starts with one agent; two to four is usually plenty to begin with.',
        '3. Check the open issues against that size: the team grows later when work keeps waiting for free agents.',
        ...(floor.charter ? [] : ['No charter yet: draft one with propose_charter.']),
        floor.mission
          ? `4. The manager's brief for this floor, for your notes: """${floor.mission}"""\nFile no issues: planning it is a job of its own, when the manager asks for it.`
          : floor.backlog === 0
            ? '4. There is no brief and the backlog is empty. File no issues; suggest in your final message what the manager might want next.'
            : `4. There are ${floor.backlog} open issues. Leave them as they are and file no new ones; just make sure the team size fits them.`,
      ].join('\n');
    case 'plan':
      if (!floor) return 'A floor you were asked to plan has been removed. Reply "Nothing to do."';
      return [
        `The manager has a brief for floor ${floor.floor} (${floor.fullName}, clone at ${floor.clone}):`,
        `"""${floor.mission || job.topic || ''}"""`,
        ...(job.pick ? [`They picked from your research on it: "${job.pick}".${job.brief ? ` Your research brief: ${job.brief} (read it first).` : ''} Plan that pick.`] : []),
        ...(floor.charter ? ['', floor.charter] : []),
        '',
        'Plan the next milestone toward it:',
        '- With charter objectives, end each issue with a line "Objective: O<n>". A part of the brief that is a non-goal or serves no objective: file nothing for it; ask the manager, or propose_charter.',
        `- Read the current code and the ${floor.backlog} open issues first, so you build on what exists and do not duplicate anything.`,
        '- One issue per whole feature. Split a feature only when its parts are independent and touch different files, or a risky foundation part should land first. Only for an empty or nearly empty repository does a skeleton issue come first, with the others depending on it.',
        '- For a new feature, check current docs and how others solve it on the web before writing issues; cite what you used in the issue.',
        '- File the issues.',
        '- Make sure the team size fits the work: scale_team when ready issues would keep waiting for free agents.',
        '- Update the floor profile and QA brief if the brief changes what the project is.',
      ].join('\n');
    case 'review':
      return [
        'Periodic review of the company. For every floor, look at:',
        '- floors without a profile or QA brief: study them and write one',
        '- team size against throughput: work that keeps waiting for free agents (grow), or agents idle with nothing ready to start or test (shrink). Idle agents are not a reason to slice features.',
        '- backlog against the team (capacity): long dependency chains (fix them with set_dependencies), or PRs piling up in QA (then plan fewer, bigger issues)',
        '- pull requests stuck in QA or marked as needing a human',
        '- floors with a brief and an empty backlog: say so, and suggest what the manager might ask for next (file no issues: only they decide on new work)',
        'Change team sizes only when clearly justified. If nothing needs doing, reply with one short sentence saying so.',
      ].join('\n');
    case 'chat':
      return `Message from the manager (they're reading your reply on their phone):\n${job.text ?? ''}`;
  }
}

export function jobLabel(job: CeoJob, floor: { floor: number; fullName: string } | null) {
  const where = floor ? `floor ${floor.floor} · ${floor.fullName.split('/')[1] ?? floor.fullName}` : 'a removed floor';
  switch (job.kind) {
    case 'onboard':
      return `Onboarding ${where}`;
    case 'plan':
      return `Planning ${where}`;
    case 'review':
      return 'Reviewing the company';
    case 'chat':
      return 'Replying to you';
    case 'triage':
      return `Triaging PR #${job.prNumber ?? '?'} · ${where}`;
    case 'followup':
      return `Following up on ${followupLabel(job.events ?? [])}`;
    case 'research':
      return `Researching "${short(job.topic ?? '')}"`;
    case 'changes':
      return 'Looking at your changes';
  }
}

// ---------- issues ----------

/**
 * The CEO's issue cap: at most `max` issues per request from the manager. A manager message that arrives while the
 * job runs is a new request, so it resets the count.
 */
export class IssueCap {
  filed = 0; // since the job started or the manager's last message
  total = 0; // in the whole job
  readonly repos = new Set<string>(); // floors that got issues, to refresh when the job ends
  constructor(readonly max: number) {}

  check() {
    if (this.filed >= this.max) throw new Error(`You already filed ${this.max} issues in this job. That's plenty for one milestone. The manager's next message allows more.`);
  }

  record(repoId: string) {
    this.filed++;
    this.total++;
    this.repos.add(repoId);
  }

  managerMessage() {
    this.filed = 0;
  }
}

export interface DependsRequest {
  floor: number;
  number: number;
  dependsOn: number[]; // [] = no dependencies
  issues: { number: number; body: string }[]; // the floor's open issues
  closed: (n: number) => boolean; // for numbers that aren't open: closed, rather than unknown
  inProgress: boolean;
}

export interface DependsPlan {
  body: string | null; // null: leave the body alone
  summary: string;
}

/** Longest chain of open issues this one waits for, one step per "Depends on". */
function waitsDepth(n: number, deps: Map<number, number[]>, seen = new Set<number>()): number {
  if (seen.has(n)) return 0;
  seen.add(n);
  const depth = Math.max(0, ...(deps.get(n) ?? []).map((d) => waitsDepth(d, deps, seen) + 1));
  seen.delete(n);
  return depth;
}

/**
 * What set_dependencies changes, or why it refuses: a closed or unknown issue, one in progress, a dependency on
 * itself, on a closed or unknown issue, a cycle, or a chain deeper than two steps.
 */
export function planDependencies(r: DependsRequest): DependsPlan {
  const issue = r.issues.find((i) => i.number === r.number);
  if (!issue) throw new Error(r.closed(r.number) ? `#${r.number} is closed.` : `There is no open issue #${r.number} on floor ${r.floor}.`);
  if (r.inProgress) throw new Error(`#${r.number} is already in progress, so its dependencies can't change.`);
  const deps = [...new Set(r.dependsOn.map(Number))];
  const open = new Set(r.issues.map((i) => i.number));
  for (const d of deps) {
    if (d === r.number) throw new Error(`#${r.number} can't depend on itself.`);
    if (!open.has(d)) throw new Error(r.closed(d) ? `#${d} is closed, so there's nothing to wait for.` : `There is no open issue #${d} on floor ${r.floor}.`);
  }
  const body = setDependsOn(issue.body, deps);
  const after = r.issues.map((i) => (i.number === r.number ? { ...i, body } : i));
  const waits = new Map(after.map((i) => [i.number, blockers(i.body, open)]));
  const loop = deps.find((d) => reaches(d, r.number, waits));
  if (loop !== undefined) throw new Error(`#${loop} already waits for #${r.number}, directly or through other issues, so that would be a cycle.`);
  const depth = waitsDepth(r.number, waits) + (holdUps(after).get(r.number)?.chain ?? 0);
  if (depth > 2) throw new Error(`That makes a dependency chain ${depth} steps deep through #${r.number}. Keep chains to 2 steps at most: fold the dependent pieces into one issue instead of splitting further.`);
  return {
    body: body !== issue.body ? body : null,
    summary: `#${r.number} on floor ${r.floor}: ${deps.length ? `depends on ${deps.map((d) => `#${d}`).join(', ')}` : 'no dependencies'}.`,
  };
}

// ---------- capacity ----------

export interface FloorCapacity {
  issuesWaitingOnOthers: number; // not started yet and waiting for another open issue
  longestDependencyChain: number;
  prsAwaitingQa: number; // open PRs queued for or in QA, re-test rounds included
  prsBeingFixed: number; // open PRs back for fixes: waiting for an agent, or being fixed
}

/** The backlog, QA and fix numbers in company_status, so the CEO can see where work waits for agents. */
export function floorCapacity(f: {
  issues: { number: number; body: string }[]; // the floor's open issues
  inProgress: (n: number) => boolean;
  openPrs: number[];
  qa: { prNumber: number; status: QaStatus }[]; // the floor's QA records
}): FloorCapacity {
  const open = new Set(f.issues.map((i) => i.number));
  const prs = new Set(f.openPrs);
  return {
    issuesWaitingOnOthers: f.issues.filter((i) => !f.inProgress(i.number) && blockers(i.body, open).length > 0).length,
    longestDependencyChain: Math.max(0, ...[...holdUps(f.issues).values()].map((w) => w.chain)),
    prsAwaitingQa: f.qa.filter((q) => prs.has(q.prNumber) && (q.status === 'queued' || q.status === 'testing')).length,
    prsBeingFixed: f.qa.filter((q) => prs.has(q.prNumber) && (q.status === 'failed' || q.status === 'fixing')).length,
  };
}

/**
 * Whether close_issue may close an issue: only one open on that floor (`state` is its state in the floor's repo;
 * null when unknown), and never one an open pull request closes.
 */
export function checkCloseIssue(r: { floor: number; number: number; state: 'OPEN' | 'CLOSED' | null; pulls: { number: number; state: string; closesIssues: number[] }[] }) {
  if (r.state === 'CLOSED') throw new HttpError(404, `#${r.number} on floor ${r.floor} is already closed.`);
  if (r.state !== 'OPEN') throw new HttpError(404, `There is no open issue #${r.number} on floor ${r.floor}.`);
  const pr = r.pulls.find((p) => p.state === 'OPEN' && p.closesIssues.includes(r.number));
  if (pr) throw new HttpError(409, `PR #${pr.number} closes #${r.number}. Close or finish that pull request first.`);
}

/** Does `from` wait for `to`, directly or through other issues? */
function reaches(from: number, to: number, waits: Map<number, number[]>, seen = new Set<number>()): boolean {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return (waits.get(from) ?? []).some((n) => reaches(n, to, waits, seen));
}
