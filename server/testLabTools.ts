// The test lab's tools (#56) for builders, fixers and QA: an `office` MCP server with lab_screenshot,
// lab_browser_check, lab_run, lab_status and lab_result, served like the CEO's office tools. The office binds them to the session's
// agent, floor and worktree; the requests wait in the lab's queue (server/testLab.ts), with MCP progress notifications
// while they do (#560), so the CLI never gives up on a silent call.
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { OfficeTools } from './ceo.ts';
import type { LabJobInput, LabProgress } from './testLab.ts';

export interface LabHandlers {
  /** progress: null when the call carried no progressToken (TestLab.submit). signal: the call's, aborted when the client gives up on it (#562). */
  submit(input: LabJobInput, progress: LabProgress | null, signal?: AbortSignal): Promise<string>;
  status(): string;
  /** A finished job's kept report (#562). */
  result(jobId: string): string;
}

/** A tool call's heartbeat as MCP progress notifications on its progressToken; null when the client sent none (#560). */
export function labProgress(extra: unknown): LabProgress | null {
  const x = extra as { _meta?: { progressToken?: string | number }; sendNotification?: (n: { method: 'notifications/progress'; params: { progressToken: string | number; progress: number; message: string } }) => Promise<void> } | undefined;
  const token = x?._meta?.progressToken;
  const send = x?.sendNotification;
  if (token === undefined || !send) return null;
  let n = 0;
  return (b) => void send({ method: 'notifications/progress', params: { progressToken: token, progress: ++n, message: b.message } }).catch(() => undefined);
}

/**
 * Should an office MCP request be answered as a stream (SSE) rather than one JSON body? Only a tool call with a
 * progressToken: its progress notifications can only travel on a stream, and such a client asked for them.
 */
export function progressStream(body: unknown): boolean {
  return (Array.isArray(body) ? body : [body]).some((m) => {
    const msg = m as { method?: unknown; params?: { _meta?: { progressToken?: unknown } } } | null;
    return msg?.method === 'tools/call' && msg.params?._meta?.progressToken !== undefined;
  });
}

const PROFILE = z.enum(['desktop', 'phone', 'iphone']).optional().describe('desktop (default), phone (Android Chromium) or iphone (iPhone size, touch, 3× pixels)');
const THEME = z.enum(['light', 'dark']).optional().describe('prefers-color-scheme, default light');
const GRAPHICS = z
  .enum(['lab', 'full'])
  .optional()
  .describe("lab (default): the office's light 3D graphics, same UI and layout. full: the real graphics with shadows and lighting, for one pass on a PR that changes 3D/visual code; it runs alone and the browser restarts after");
const SELECTOR = z.string().max(300);
const TARGET = {
  url: z.string().max(2000).optional().describe('The page, e.g. http://localhost:5678/ (your own dev server)'),
  preview: z.boolean().optional().describe("Instead of url: your floor's app, started by the lab for your pull request (else the default branch)"),
};
const ACTION = z.object({
  do: z.enum(['click', 'type', 'press', 'scroll', 'wait']),
  selector: SELECTOR.optional(),
  text: z.string().max(500).optional().describe('type: the text; press: the key, e.g. Enter'),
  y: z.number().int().min(-20_000).max(20_000).optional().describe('scroll: pixels down'),
  ms: z.number().int().min(0).max(10_000).optional().describe('wait: milliseconds (or give a selector to wait for)'),
});
const STEP = z.object({
  do: z.enum(['goto', 'click', 'type', 'press', 'scroll', 'wait', 'expect_visible', 'expect_text', 'no_horizontal_scroll', 'no_console_errors', 'viewport_scale', 'axe']),
  selector: SELECTOR.optional(),
  text: z.string().max(500).optional(),
  url: z.string().max(2000).optional().describe('goto: a path or URL'),
  value: z.number().optional().describe('viewport_scale: expected scale (default 1); scroll: pixels; wait: ms'),
});

/** Every lab tool's description ends with this: the answer to a call that was cut off (#562). */
const AFTER_ABORT = ' If the call is cut off, the job still finishes: call lab_status, then lab_result with its job id, instead of asking again.';
const signalOf = (extra: unknown) => (extra as { signal?: AbortSignal } | undefined)?.signal;

const text = (fn: () => string | Promise<string>) =>
  Promise.resolve()
    .then(fn)
    .then(
      (t) => ({ content: [{ type: 'text' as const, text: t }], ...(t.startsWith('Refused:') ? { isError: true } : {}) }),
      (err: Error) => ({ content: [{ type: 'text' as const, text: `Refused: ${err.message}` }], isError: true }),
    );

export function createLabTools(h: LabHandlers): OfficeTools {
  const defs = [
    tool(
      'lab_screenshot',
      "Screenshots from the office's test lab (one shared browser for everyone): the page at each viewport width, saved in your worktree's .lab/ folder (never committed), with console errors, page errors and failed requests. Waits in the lab's queue. Use this instead of starting a browser of your own." + AFTER_ABORT,
      {
        ...TARGET,
        viewports: z.array(z.number().int().min(240).max(3840)).min(1).max(4).optional().describe('Widths, e.g. [390, 1280]; default [1280]'),
        profile: PROFILE,
        theme: THEME,
        graphics: GRAPHICS,
        wait_for: SELECTOR.optional().describe('A selector to wait for before acting'),
        actions: z.array(ACTION).max(10).optional().describe('Done in order before the screenshot'),
        full_page: z.boolean().optional(),
      },
      (a, extra) => text(() => h.submit({ kind: 'screenshot', url: a.url, preview: a.preview, viewports: a.viewports ?? [1280], profile: a.profile ?? 'desktop', theme: a.theme ?? 'light', graphics: a.graphics, waitFor: a.wait_for, actions: a.actions ?? [], fullPage: !!a.full_page }, labProgress(extra), signalOf(extra))),
    ),
    tool(
      'lab_browser_check',
      'A scripted browser check in the test lab: steps and assertions run in order, each reported pass/fail, with a screenshot of every failure. Assertions: expect_visible (selector), expect_text (text, optional selector), no_horizontal_scroll, no_console_errors, viewport_scale (value), axe (serious/critical accessibility violations).' + AFTER_ABORT,
      {
        ...TARGET,
        viewport: z.number().int().min(240).max(3840).optional().describe('Width, default 1280'),
        profile: PROFILE,
        theme: THEME,
        graphics: GRAPHICS,
        steps: z.array(STEP).min(1).max(30),
      },
      (a, extra) => text(() => h.submit({ kind: 'check', url: a.url, preview: a.preview, viewport: a.viewport ?? 1280, profile: a.profile ?? 'desktop', theme: a.theme ?? 'light', graphics: a.graphics, steps: a.steps }, labProgress(extra), signalOf(extra))),
    ),
    tool(
      'lab_run',
      "A heavy command (full test suite, build, e2e spec) in the test lab, on a clean checkout of your committed HEAD (or a branch on GitHub), one at a time across the office. Only the floor's allowlist runs, e.g. npm test, npm run build, npx playwright test <spec>. Returns the exit code, duration, the last 200 lines and the artifacts." + AFTER_ABORT,
      {
        command: z.string().min(1).max(300).describe('e.g. "npm test" or "npx playwright test e2e/smoke.spec.ts"'),
        branch: z.string().max(200).regex(/^[\w./-]+$/).optional().describe('A branch on origin; default: your committed HEAD (no push needed)'),
        timeout_min: z.number().int().min(1).max(30).optional().describe('Default 15'),
      },
      (a, extra) => text(() => h.submit({ kind: 'run', command: a.command, branch: a.branch, timeoutMin: a.timeout_min }, labProgress(extra), signalOf(extra))),
    ),
    tool('lab_status', "The test lab's queue: what runs, your jobs' places and the estimated wait, and your finished jobs' ids.", {}, () => text(() => h.status())),
    tool(
      'lab_result',
      'A finished lab job\'s report, kept a day in your .lab/<job id>/result.json: for a lab call that was cut off before it answered. lab_status lists your job ids.',
      { job_id: z.string().min(1).max(40).regex(/^[\w-]+$/).describe('From lab_status, e.g. "mwd8tyd8a"') },
      (a) => text(() => h.result(a.job_id)),
    ),
  ];
  return {
    server: createSdkMcpServer({ name: 'office', version: '1.0.0', tools: defs }),
    defs,
    serve: () => createSdkMcpServer({ name: 'office', version: '1.0.0', tools: defs }).instance,
    async call(name, args) {
      const def = defs.find((d) => d.name === name);
      if (!def) throw new Error(`No lab tool ${name}`);
      const res = (await def.handler(args as never, undefined)) as { content: { text?: string }[] };
      return res.content.map((c) => c.text ?? '').join('\n');
    },
  };
}
