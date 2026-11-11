// The demo's fake build, QA and fix sessions (#257), drawn in the agent's terminal, and Claude's made-up usage.
import crypto from 'node:crypto';
import { parseProgramStatus, programStatusStep } from '../programStatus.ts';
import path from 'node:path';
import type { LogEntry, SessionCallbacks, SessionHandle, SessionOptions, SessionResult } from '../agentRunner.ts';
import { actOn, requiredKeys, SessionWatch } from '../liveState.ts';
import { CLIS } from '../clis.ts';
import { screenStep, signInError } from '../cliScreens.ts';
import { demoSignedIn } from '../demoAccounts.ts';
import { HOME_DIR } from '../config.ts';
import { withDemoChat } from '../demoAgentChat.ts';
import { demoConsultSession } from '../demoAwake.ts';
import { demoPrFiles, demoPrSummary, demoTryIt } from '../demoMap.ts';
import { demoAsked, demoAsks } from '../demoPrompts.ts';
import { withLab } from '../demoTestLab.ts';
import { demoTranscript } from '../historySample.ts';
import type { UsageWarning } from '../pacing.ts';
import { charTokens } from '../../shared/startup.ts';
import { keyName } from '../../shared/termKeys.ts';
import { toolArgsLine } from '../../shared/tooling.ts';
import type { AgentCli, UsageReading } from '../../shared/types.ts';
import { ceoSession } from './ceo.ts';
import { itSession } from './itDesk.ts';
import { boxDeskRepo } from './cloud.ts';
import { registerDemo } from './registry.ts';
import { DARK_MODE_TITLE } from './seedRepos.ts';
import { fixPromptPull, fixScript, issueScript, qaScript, type Step } from './sessionScripts.ts';
import { fakeSha, now, repos, runChecks, signOuts, stalls, takeNumber } from './world.ts';

/** Claude Code's sign-in, as a session on a login nobody signed in yet opens on (the real one's words). */
const SIGN_IN_SCREEN = ['Select login method:', '❯ 1. Claude account with subscription · Pro, Max, Team, or Enterprise', '  2. Anthropic Console account · API usage billing', "Browser didn't open? Use the url below to sign in:", 'Paste code here if prompted >'];

/**
 * A session on a login account the demo hasn't signed in (#360): it opens on the sign-in, which the office can't answer
 * (cliScreens.ts reads it as one), so it ends signed out after a moment, the way cliRunner.ts ends a real one.
 */
function signInSession(opts: SessionOptions, cb: SessionCallbacks): SessionHandle | null {
  const dir = opts.env?.CLAUDE_CONFIG_DIR ?? opts.env?.CODEX_HOME ?? '';
  const id = /accounts[\\/]([^\\/]+)[\\/](?:claude|codex)$/.exec(dir)?.[1];
  const cli = opts.cli ?? 'claude';
  if (!id || demoSignedIn.has(id) || screenStep(SIGN_IN_SCREEN.join('\n'), cli)?.do !== 'sign-in') return null;
  const label = CLIS.find((c) => c.id === cli)?.label ?? 'Claude Code';
  cb.log(SIGN_IN_SCREEN.map((text) => ({ kind: 'system', text })));
  const timer = setTimeout(() => {
    cb.log([{ kind: 'error', text: `⚠ ${signInError(label, opts.account)}` }]);
    cb.finished({ ok: false, text: '', costUsd: 0, turns: 0, errors: [signInError(label, opts.account)], signedOut: true });
  }, 2500);
  return {
    send: () => undefined,
    stop() {
      clearTimeout(timer);
      cb.finished({ ok: false, text: '', costUsd: 0, turns: 0, errors: ['Stopped by manager'] });
    },
  };
}

/** The demo's sessions and the CLI that made each: one it never made (before a restart) or another CLI's isn't there to resume (#401). */
const made = new Map<string, AgentCli>();

/** An agent's session: as cliRunner.ts ends one whose CLI can't find the session it was to resume, or the fake session. */
function agentSession(opts: SessionOptions, cb: SessionCallbacks, fullName: string): SessionHandle {
  const cli = opts.cli ?? 'claude';
  const id = opts.resumeSessionId;
  const minting: SessionCallbacks = {
    ...cb,
    sessionId: (sid) => {
      if (sid) made.set(sid, cli);
      cb.sessionId(sid);
    },
  };
  if (!id?.startsWith('demo-') || made.get(id) === cli) return fakeSession(opts, minting, fullName);
  cb.log([{ kind: 'error', text: cli === 'codex' ? `ERROR: No saved session found with ID ${id}. Run codex resume without an ID to choose from existing sessions.` : `No conversation found with session ID: ${id}` }]);
  const label = CLIS.find((c) => c.id === cli)?.label ?? 'Claude Code';
  const t = setTimeout(() => {
    cb.sessionId(null);
    cb.finished({ ok: false, text: '', costUsd: 0, turns: 0, errors: [`${label} couldn't find the session it was resuming.`], lostSession: true });
  }, 1000);
  return {
    send: () => undefined,
    stop() {
      clearTimeout(t);
      cb.finished({ ok: false, text: '', costUsd: 0, turns: 0, errors: ['Stopped by manager'] });
    },
  };
}

function fakeSession(opts: SessionOptions, cb: SessionCallbacks, fullName: string): SessionHandle {
  const unsigned = signInSession(opts, cb);
  if (unsigned) return unsigned;
  const timers: NodeJS.Timeout[] = [];
  let stopped = false;
  let stalled = false; // stuck: no more output, and messages go unanswered
  if (opts.agentId) {
    stalls.set(opts.agentId, () => {
      stalled = true;
      timers.forEach(clearTimeout);
    });
  }
  // A cloud agent's session ends the way an expired login ends a real one when the fake account expires sign-ins.
  const signOut = opts.box && opts.agentId ? { boxId: opts.box.boxId, end: (credit?: boolean) => expired(credit) } : null;
  if (signOut) signOuts.set(opts.agentId!, signOut);
  const forgetSignOut = () => {
    if (signOut && signOuts.get(opts.agentId!) === signOut) signOuts.delete(opts.agentId!);
  };
  const nudged = /^You pushed nothing/.test(opts.prompt); // the office's nudge after a fix that pushed nothing
  const resumedFix = opts.resumeSessionId?.startsWith('demo-fix-') ?? false;
  // The task picks the script; a session started without one (a follow-up) is read from its prompt.
  const fixPrompt = !opts.task && /FAILED|taking over pull request|git push origin HEAD:/.test(opts.prompt);
  const kind = opts.task === 'qa' ? 'qa' : opts.task === 'fix' || nudged || resumedFix || fixPrompt ? 'fix' : 'issue';
  // Fix sessions can be resumed (the office's nudge), like real ones.
  if (kind === 'fix') cb.sessionId(opts.resumeSessionId ?? `demo-fix-${crypto.randomUUID()}`);
  const pull = fixPromptPull(opts.prompt);
  const issueMatch = opts.prompt.match(/#(\d+):\s*(.+)/);
  const number = kind === 'issue' ? Number(issueMatch?.[1] ?? 0) : pull.number;
  const { answered, question, title } = demoAsks(kind === 'issue', opts, number, (kind === 'issue' ? issueMatch?.[2]?.trim() : pull.title) ?? 'follow-up', repos.get(fullName)?.issues ?? []);
  const round = Number(opts.prompt.match(/QA round (\d+)/)?.[1] ?? 1);
  // Now and then a QA fix ends without pushing, so the office's nudge can be seen; half the nudged answer NO CHANGE NEEDED.
  const pushes = kind !== 'fix' || !(nudged || /FAILED|taking over pull request/.test(opts.prompt)) || Math.random() > (nudged ? 0.5 : 0.25);

  const tools = opts.tools ? toolArgsLine(opts.tools) : '';
  const header: Step = [
    { kind: 'system', text: `✻ Claude Code (demo) · ${opts.model} · ${opts.effort} effort` },
    { kind: 'system', text: `  cwd ${opts.cwd}` },
    ...(tools ? [{ kind: 'system' as const, text: `  $ claude --session-id … ${tools}` }] : []),
  ];
  const checks = opts.prompt.match(/^GitHub checks right now: .*$/m)?.[0] ?? 'GitHub checks right now: none';
  const body = kind === 'qa' ? qaScript(cb, number, title, round, checks) : kind === 'fix' ? fixScript(number, pushes, nudged) : issueScript(opts, cb, number, title);
  const script = [header, ...(question ? [...body.slice(0, 7), () => ((stopped = true), demoAsked(cb, question))] : answered ? [[{ kind: 'text', text: '● Thanks: going with that.' }] as LogEntry[], ...body.slice(-3)] : body)];

  const expired = (credit = false) => { // credit: as an Anthropic key out of credit ends it instead (#258)
    if (stopped) return;
    stopped = true;
    forgetSignOut();
    timers.forEach(clearTimeout);
    cb.tool(null);
    cb.log([{ kind: 'error', text: credit ? 'API Error: 400 · Your credit balance is too low to access the Anthropic API. (demo)' : 'API Error: 401 · Login expired · Please run /login (demo)' }]);
    const name = CLIS.find((c) => c.id === (opts.cli ?? 'claude'))?.label ?? 'Claude Code';
    cb.finished({ ok: false, text: '', costUsd: 0.1, turns: i, ...(credit ? { errors: ['Claude Code stopped: credit balance is too low'], keyTrouble: 'out-of-credit' } : { errors: [`${name} stopped: authentication failed`], signedOut: true }) });
  };

  const finish = () => {
    forgetSignOut();
    const costUsd = 0.3 + Math.random();
    const turns = 15 + Math.floor(Math.random() * 20);
    cb.tool(null);
    if (kind === 'qa') {
      // Most first rounds pass; some fail so the fix loop can be seen in action.
      const pass = round > 1 || (title !== DARK_MODE_TITLE && Math.random() > 0.35);
      const full = opts.prompt.includes('graphics: "full"'); // a 3D PR (qaPrompt.ts fullQualityLine) reports its full pass
      cb.log([{ kind: 'text', text: pass ? '● Everything checks out. Writing up the report.' : '● The toolbar overflows on a 375px screen. Failing this round.' }]);
      cb.finished({
        ok: true,
        text: '',
        costUsd,
        turns,
        errors: [],
        structured: {
          verdict: pass ? 'pass' : 'fail',
          summary: pass
            ? 'The change does what the issue asks: the feature works on desktop and mobile, all 41 tests pass, and lint and build are clean.'
            : 'The feature works on desktop, but on a 375px-wide screen the toolbar overflows and the new button is cut off.',
          checks: [
            { name: 'Unit tests', result: 'pass', details: '41 passed, 0 failed' },
            { name: 'Lint + build', result: 'pass', details: 'No lint errors; production build succeeds' },
            { name: 'Feature works on desktop', result: 'pass', details: 'Clicked through the new flow at 1280x800' },
            { name: 'Mobile layout (375px)', result: pass ? 'pass' : 'fail', details: pass ? 'Layout wraps correctly' : 'Toolbar overflows horizontally; button unreachable' },
            { name: 'Console errors', result: 'pass', details: 'None' },
            ...(full ? [{ name: 'Lab graphics profile', result: 'pass' as const, details: 'Canvas, controls, panels, 390px pocket mode, no console errors' }] : []),
            ...(full ? [{ name: 'Full-quality pass', result: 'pass' as const, details: 'Real graphics at 1280px, shadows and lighting; ran alone, browser restarted after' }] : []),
          ],
          commands: [
            { command: 'npm test -- --run', result: '41 passed' },
            { command: 'npm run lint && npm run build', result: 'clean, built in 1.84s' },
          ],
          screenshots: ['Home page', 'The changed page at 375px', ...(full ? ['Full quality · the changed scene at 1280px'] : [])],
          fixInstructions: pass ? undefined : 'Make the toolbar wrap (flex-wrap: wrap) below 480px so every button stays visible.',
          // QA's version of the PR's steps: the last one fails with the toolbar on a phone
          tryIt: (repos.get(fullName)?.pulls.find((p) => p.number === number)?.tryIt ?? []).map((s, i, all) => ({
            step: s.path ? s.text.replace(s.path, `\`${s.path}\``) : s.text,
            result: pass || i < all.length - 1 ? 'pass' : 'fail',
            ...(!pass && i === all.length - 1 && { note: 'At 375 px the toolbar overflows and the new button is cut off' }),
          })),
        },
      });
      return;
    }
    if (kind === 'fix') {
      const pr = repos.get(fullName)?.pulls.find((p) => p.number === number);
      if (pr && pushes) {
        pr.headSha = fakeSha();
        pr.mergeState = 'CLEAN';
        pr.mergeable = 'MERGEABLE';
        runChecks(pr, false);
      }
      const text = pushes
        ? `● Fixed PR #${number} and pushed. Ready for another QA round.`
        : nudged
          ? 'NO CHANGE NEEDED: main already makes the toolbar wrap, so the PR is right as it is.'
          : '● The toolbar wraps on narrow screens now. Ready for another QA round.';
      cb.log([{ kind: 'text', text }]);
      cb.finished({ ok: true, text, costUsd, turns, errors: [] });
      return;
    }
    const repo = repos.get(fullName);
    let url = '';
    if (repo && number) {
      const n = takeNumber(repo);
      url = `https://github.com/${fullName}/pull/${n}`;
      repo.pulls.unshift({
        number: n,
        title,
        url,
        headRefName: `swarm/issue-${number}-${path.basename(opts.cwd).replace(/-[0-9a-f]{4}$/, '')}`,
        state: 'OPEN',
        isDraft: false,
        mergeable: 'MERGEABLE',
        reviewDecision: null,
        closesIssues: [number],
        createdAt: now(),
        mergedAt: null,
        additions: 40 + ((number * 13) % 200),
        deletions: (number * 7) % 40,
        checks: 'pending',
        headSha: fakeSha(),
        mergeState: 'CLEAN',
        failedChecks: [],
        pendingChecks: [],
        files: demoPrFiles(fullName, repo.issues.find((i) => i.number === number), number),
        summary: demoPrSummary(repo.issues.find((i) => i.number === number)),
        tryIt: demoTryIt(title, n),
      });
      runChecks(repo.pulls[0]);
      cb.log([{ kind: 'result', text: `  ⎿ ${url}` }]);
    }
    cb.log([{ kind: 'text', text: `● Opened ${url || 'the pull request'}. It closes #${number} and includes tests.` }]);
    cb.finished({ ok: true, text: url, costUsd, turns, errors: [] });
  };

  let i = 0;
  const step = () => {
    if (stopped || stalled) return;
    if (i >= script.length) {
      if (opts.agentId) stalls.delete(opts.agentId);
      return finish();
    }
    const s = script[i++];
    if (typeof s === 'function') s();
    else {
      const tool = s.find((e) => e.kind === 'tool');
      cb.tool(tool?.tool ?? null);
      cb.log(s);
    }
    timers.push(setTimeout(step, 1600 + Math.random() * 3800));
  };
  timers.push(setTimeout(step, 600));

  return {
    send(text) {
      timers.push(
        setTimeout(() => {
          if (stopped || stalled) return;
          cb.log([{ kind: 'text', text: `● Got it — "${text.slice(0, 60)}". Adjusting my approach.` }]);
        }, 1500),
      );
    },
    stop() {
      stopped = true;
      forgetSignOut();
      if (opts.agentId) stalls.delete(opts.agentId);
      timers.forEach(clearTimeout);
      cb.finished({ ok: false, text: '', costUsd: 0.1, turns: i, errors: ['Stopped by manager'] });
    },
  };
}

// ---------- the terminal runtime ----------

const ANSI: Record<LogEntry['kind'], (text: string) => string> = {
  text: (t) => t.replace(/^● /, '\x1b[97m●\x1b[0m '),
  tool: (t) => `\x1b[32m●\x1b[0m \x1b[1m${t.replace(/^⏺ /, '')}\x1b[0m`,
  result: (t) => `\x1b[2m${t}\x1b[0m`,
  thinking: (t) => `\x1b[35m${t}\x1b[0m`,
  error: (t) => `\x1b[31m${t}\x1b[0m`,
  system: (t) => `\x1b[2m${t}\x1b[0m`,
  manager: (t) => `\x1b[36m${t.replace(/^▶ /, '❯ ')}\x1b[0m`,
  done: (t) => `\x1b[32m${t}\x1b[0m`,
};

/** How a fake session gets stuck (#359): left on its sign-in screen until the manager presses Enter there, or its result printed but never reported. */
type DemoStuck = 'sign-in' | 'result' | null;

const STUCK_SIGN_IN_SCREEN = [
  '',
  ' Welcome to Claude Code (demo)',
  '',
  ' Select login method:',
  '',
  ' \x1b[36m❯ 1. Claude account with subscription\x1b[0m · Pro, Max, Team, or Enterprise',
  '   2. Anthropic Console account · API usage billing',
  '',
  ' \x1b[2mPress Enter here to sign in (demo)\x1b[0m',
].join('\r\n');

/** What a fake session that never reports its end prints instead: the report or the pull request, as a CLI would. */
const printedLines = (r: SessionResult): string[] => (r.structured ? ['● Here is my report.', '```json', ...JSON.stringify(r.structured, null, 2).split('\n'), '```'] : [`● ${r.text}`]);

/**
 * With a terminal (the terminal runtime), the fake session's lines are drawn there the way Claude Code draws them,
 * and what the manager types into it is taken as a message. The office watches it as it watches a real CLI's
 * (liveState.ts): a sign-in screen is blocked, a result printed but never reported is completed a minute later.
 */
function inTerminal(opts: SessionOptions, cb: SessionCallbacks, start: (cb: SessionCallbacks) => SessionHandle, fake = false, stuck: DemoStuck = null): SessionHandle {
  const term = opts.terminal;
  if (!term) return start(cb);
  let lastWrite = Date.now();
  let logged = false;
  let ended = false;
  let held: SessionResult | null = null; // the result a 'result' session printed instead of reporting
  const watch = new SessionWatch(Date.now(), requiredKeys(opts.outputSchema));
  const end = (r: SessionResult) => {
    if (ended) return;
    ended = true;
    clearInterval(watching);
    term.bind(null);
    term.note(`── ${name} session ended ──`);
    cb.finished(r);
  };
  // The CEO and consults aren't builders: nothing to watch.
  const watching = !fake ? undefined : setInterval(() => {
    const now = Date.now();
    actOn(watch.tick({ now, begun: logged, screen: term.screen(), tail: term.tail(120), quietMs: now - lastWrite }), name, {
      log: (text, error) => cb.log([{ kind: error ? 'error' : 'system', text }]),
      blocked: (s) => cb.blocked?.(s?.reason ?? null, s?.kind),
      retry: () => undefined, // a fake session starts by itself
      complete: (text) => end({ ok: true, text, costUsd: held?.costUsd ?? 0.4, turns: held?.turns ?? 12, errors: [] }),
    });
  }, 2000);
  const name = CLIS.find((c) => c.id === (opts.cli ?? 'claude'))?.label ?? 'Claude Code';
  term.note(`── ${name}${opts.label ? ` · ${opts.label}` : ''} ──`);
  term.write(
    [
      '',
      ` \x1b[38;5;209m▐▛███▜▌\x1b[0m   \x1b[1m${name}\x1b[0m (demo)`,
      `\x1b[38;5;209m▝▜█████▛▘\x1b[0m  ${opts.model || 'default model'} · ${opts.effort} effort`,
      `\x1b[38;5;209m  ▘▘ ▝▝\x1b[0m    \x1b[2m${opts.cwd}\x1b[0m`,
      '',
      `\x1b[36m❯\x1b[0m ${opts.prompt.split('\n')[0].slice(0, 200)}`,
      '',
    ].join('\r\n'),
  );
  let handle: SessionHandle | null = null;
  let line = '';
  let signIn: (() => void) | null = null;
  term.bind({
    write: (data) => {
      // Keys with no character (Esc, arrows, Shift+Tab, Ctrl+C…) are echoed by name, so the key bar can be checked here.
      const key = keyName(data);
      if (key) return term.write(`\x1b[2m⟨${key}⟩\x1b[0m`);
      for (const ch of data.replace(/\x1b\[[0-9;?]*[A-Za-z~]|\x1b./g, '')) {
        if (ch === '\r' && signIn) {
          signIn();
        } else if (ch === '\r') {
          const text = line.trim();
          line = '';
          term.write('\r\n');
          if (text && handle) {
            cb.log([{ kind: 'manager', text: `▶ Typed in the terminal: ${text}` }]);
            handle.send(text);
          }
        } else if (ch === '\x7f' || ch === '\b') {
          if (line) term.write('\b \b');
          line = line.slice(0, -1);
        } else if (ch >= ' ') {
          line += ch;
          term.write(ch);
        }
      }
    },
    resize: () => undefined,
  });
  const begin = () => start({
    ...cb,
    blocked: (reason) => {
      // Fake CLI output exercises the same decoding and backup decision as a silent hook stream.
      const raw = `\x1b]7501;state=${reason ? 'blocked' : 'working'}:app=codex${reason ? `:msg=${Buffer.from(reason).toString('base64')}` : ''}\x1b\\`;
      const parsed = parseProgramStatus(undefined, raw);
      term.write(parsed.text);
      const status = parsed.statuses[0];
      const step = programStatusStep(status && { ...status, at: 20_000 }, 0, 20_000);
      cb.blocked?.(step.do === 'blocked' ? step.reason : null);
    },
    log: (entries) => {
      cb.log(entries);
      logged = true;
      lastWrite = Date.now();
      for (const e of entries) term.write(`${e.kind === 'tool' || (e.kind === 'text' && e.text.startsWith('●')) ? '\r\n' : ''}${ANSI[e.kind](e.text)}\r\n`);
    },
    finished: (r) => {
      if (stuck !== 'result' || !r.ok) return end(r);
      held = r; // printed, never reported: the office's watch completes it
      lastWrite = Date.now();
      term.write(`\r\n${printedLines(r).join('\r\n')}\r\n\r\n\x1b[36m❯\x1b[0m `);
    },
  });
  if (stuck === 'sign-in') {
    term.write(STUCK_SIGN_IN_SCREEN);
    signIn = () => {
      signIn = null;
      term.write('\x1b[2J\x1b[H\x1b[32m✓ Signed in (demo)\x1b[0m\r\n');
      handle = begin();
    };
    // Until then the office's Stop still ends it.
    return { kept: true, send: (text) => handle?.send(text), stop: () => (handle ? handle.stop() : end({ ok: false, text: '', costUsd: 0, turns: 0, errors: ['Stopped by manager'] })) };
  }
  handle = begin();
  return Object.assign(handle, { kept: true }); // as if the keeper held it: the demo's update restarts nothing
}

/**
 * Claude's usage on demand (the manager's console → Mission control, in the demo): a weekly-limit warning at 91% that
 * resets at midnight, or the 5-hour limit reached for 3 minutes.
 */
export function demoUsage(kind: 'warning' | 'limit', now: number): UsageWarning | { limitResetsAt: number } {
  if (kind === 'limit') return { limitResetsAt: now + 3 * 60_000 };
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return { resetsAt: midnight.getTime(), rateLimitType: 'seven_day', utilization: 0.91 };
}

// Claude's usage warning, faked once so the office can be seen pacing new work: the 4th session gets it, and the
// window "resets" 5 minutes later.
const USAGE_WARNING_AT = 4;
const USAGE_WARNING_MS = 5 * 60_000;
let sessionsStarted = 0;
const fakesStarted = { builds: 0, qa: 0 };

/** Now and then a fake session gets stuck (#359): the 2nd of every 8 builders on its sign-in screen, the 2nd of every 8 QAs printing its report without reporting it. */
function demoStuck(task: SessionOptions['task']): DemoStuck {
  if (task === 'qa') return ++fakesStarted.qa % 8 === 2 ? 'result' : null;
  return task === 'issue' && ++fakesStarted.builds % 8 === 2 ? 'sign-in' : null;
}

function fakeUsageWarning(cb: SessionCallbacks) {
  setTimeout(() => {
    const resetsAt = Date.now() + USAGE_WARNING_MS;
    cb.log([{ kind: 'error', text: `⚠ Subscription usage warning (five_hour) · resets ${new Date(resetsAt).toLocaleTimeString()} (demo)` }]);
    cb.usageWarning?.({ resetsAt, rateLimitType: 'five_hour', utilization: 0.82 });
  }, 3000);
}

// Claude's usage readings, made up: they climb through a fast fake window (30 minutes for "5 hours", 6 hours for the
// week) and reset, so the meter can be seen moving. Running sessions report them every 15 s, like a status line.
const FAKE_WINDOW_MS = 30 * 60_000;
const FAKE_WEEK_MS = 6 * 60 * 60_000;

/** The demo's readings at `now`: the 5-hour window, the week and a weekly Sonnet limit. */
function demoReadings(now: number): UsageReading[] {
  const fill = (period: number, from: number, span: number) => ({ pct: Math.round(from + (span * (now % period)) / period), resetsAt: now - (now % period) + period });
  return [
    { type: 'five_hour', ...fill(FAKE_WINDOW_MS, 8, 70), at: now },
    { type: 'seven_day', ...fill(FAKE_WEEK_MS, 35, 40), at: now },
    { type: 'seven_day_sonnet', ...fill(FAKE_WEEK_MS, 20, 30), at: now },
  ];
}

/** A session's callbacks that also report the made-up readings while it runs. */
function withReadings(cb: SessionCallbacks): SessionCallbacks {
  const feed = () => cb.usage?.(demoReadings(Date.now()));
  const first = setTimeout(feed, 4000);
  const every = setInterval(feed, 15_000);
  return {
    ...cb,
    finished: (result) => {
      clearTimeout(first);
      clearInterval(every);
      cb.finished(result);
    },
  };
}

registerDemo('sessions', ({ scale, deskRepo }) => ({
  startSession: (opts, cb) => {
    // The big company is for measuring the office at full speed, so it never paces.
    if (++sessionsStarted === USAGE_WARNING_AT && !scale) fakeUsageWarning(cb);
    if (!scale) cb = withReadings(cb);
    // Its first turn's size, as real sessions measured it here (#50): Claude Code's own ~23k, plus ~28k of
    // connectors and plugins unless the session is lean.
    if (!opts.resumeSessionId) cb.startup?.({ tokens: 23_500 + charTokens(opts.systemAppend.length + opts.prompt.length) + (opts.tools?.noConnectors ? 0 : 27_800), memoryChars: 24_000 });
    const fake = !opts.readOnly && opts.role !== 'ceo';
    const stuck = fake && !scale && !opts.box && !opts.resumeSessionId && opts.terminal ? demoStuck(opts.task) : null; // a cloud agent's sign-in is the office's own (docs/cloud.md)
    return inTerminal(opts, cb, (c) => (opts.readOnly ? demoConsultSession(opts, c) : opts.role === 'ceo' ? (signInSession(opts, c) ?? (opts.dept === 'it' ? itSession(opts, c) : ceoSession(opts, c))) : agentSession(opts, withDemoChat(opts, withLab(opts, c)), deskRepo.get(opts.cwd) ?? boxDeskRepo(opts.cwd) ?? [...repos.keys()][0])), fake, stuck);
  },
  sessionTranscript: (_cwd, sessionId, about) => demoTranscript(path.join(HOME_DIR, 'demo-transcripts'), sessionId, about),
  terminals: true,
  keeping: () => true,
  reconnectClis: async () => [], // fake sessions end with the office
  hooksReady: () => undefined,
  releaseClis: async () => undefined,
  // The idle check (#89) reads the made-up numbers; SWARM_DEMO_USAGE_CHECK=fail shows a check that can't read them.
  usageCheck: async () => (process.env.SWARM_DEMO_USAGE_CHECK === 'fail' ? { error: 'failed' } : { readings: demoReadings(Date.now()) }),
  simulateUsage: demoUsage,
}));
