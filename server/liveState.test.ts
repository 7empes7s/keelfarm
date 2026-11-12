import { describe, expect, it } from 'vitest';
import { alertDue, alertOnce, canNudge, classifyScreen, plainTurnError, forgetTold, NOT_STARTED_MS, NOTIFY_PROMPT_MS, printedResult, requiredKeys, RETRY_WAIT_MS, SessionWatch, stuckNotice, UNREGISTERED_MS, type WatchTick } from './liveState.ts';
import { QA_SCHEMA } from './qaReport.ts';

// Screens as the office's terminal mirror recorded them (trimmed).
const THEME = ` Welcome to Claude Code

 Let's get started.

 Choose the text style that looks best with your terminal
 To change this later, run /theme

 ❯ 1. Dark mode ✔
   2. Light mode
   3. Dark mode (colorblind-friendly)`;
const TRUST = ` Do you trust the files in this folder?

 /root/.cubefarm/machines/m1/work/acme__app

 Claude Code may read, write, or execute files contained in this directory.

 ❯ 1. Yes, proceed
   2. No, exit

 Enter to confirm · Esc to exit`;
const SIGN_IN = ` Claude Code can be used with your Claude subscription or billed based on API usage through your Console account.

 Select login method:

 ❯ 1. Claude account with subscription · Pro, Max, Team, or Enterprise
   2. Anthropic Console account · API usage billing`;
const CODEX_ENDED = `• Wrote the QA report above.

Token usage: total=48,211 input=40,002 output=8,209
To continue this session, run codex resume 0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b`;
const PERMISSION = ` Bash command
   npm run build
 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for npm commands in this folder
   3. No, and tell Claude what to do differently (esc)`;
const WORKING = `● Running the tests.
✻ Pondering… (12s · ↑ 1.2k tokens · esc to interrupt)`;
const CODEX_IDLE = `• Opened https://github.com/acme/app/pull/344

› Ask Codex to do anything
  ⏎ send   ⌃J newline   ⌃T transcript   ⌃C quit`;

const REPORT = { verdict: 'pass', summary: 'Works on desktop and at 390px; all tests pass.', checks: [{ name: 'Unit tests', result: 'pass', details: '41 passed' }], commands: [], screenshots: [] };

const CURL_401 = '● Bash(curl -i http://localhost:5224/api/me)\n  ⎿  HTTP/1.1 401 Unauthorized\n\n✻ Thinking… (12s · esc to interrupt)';
const SIGN_IN_DIFF = "● Update(server/liveState.ts)\n  ⎿  29 + const SIGN_IN = /Select login method|Not logged in|run \\/login/i;\n\n✻ Editing… (4s · esc to interrupt)";

describe('classifyScreen', () => {
  it('reads the theme, trust, sign-in and Codex session-ended screens', () => {
    expect(classifyScreen(THEME)).toEqual({ state: 'setup', reason: 'needs setup (the theme screen)' });
    expect(classifyScreen(TRUST)).toEqual({ state: 'setup', reason: 'needs setup (the folder-trust screen)' });
    expect(classifyScreen(SIGN_IN)).toEqual({ state: 'sign-in', reason: 'needs sign-in' });
    expect(classifyScreen(CODEX_ENDED).state).toBe('ended');
  });

  it('tells a menu, an error banner, work and an idle prompt apart', () => {
    expect(classifyScreen(PERMISSION).state).toBe('menu');
    expect(classifyScreen('  ⎿ API Error: 429 · rate limit exceeded').reason).toBe('a rate limit');
    expect(classifyScreen('Credit balance is too low').reason).toBe('out of credit');
    expect(classifyScreen(`API Error: 429 rate limit · retrying\n${WORKING}`).state).toBe('working'); // retrying, not stuck
    expect(classifyScreen(CODEX_IDLE).state).toBe('idle');
  });

  it('names a model newer than the bundled Claude Code in plain words (#546)', () => {
    const screen = '  ⎿ API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Claude Code 2.1.283 does not support this\n    model; version 2.1.290 or newer is required."}}';
    expect(plainTurnError('invalid_request', screen)).toBe("Claude Code 2.1.283 can't run this model: it needs 2.1.290 or newer. Update the office, or pick another model");
    expect(plainTurnError('invalid_request', 'prompt is too long')).toBeNull();
    expect(classifyScreen(screen)).toEqual({ state: 'error', reason: "Claude Code 2.1.283 can't run this model: it needs 2.1.290 or newer. Update the office, or pick another model" });
  });

  it('reads sign-in words above a working indicator as work', () => {
    expect(classifyScreen(CURL_401).state).toBe('working');
    expect(classifyScreen(SIGN_IN_DIFF).state).toBe('working');
  });
});

describe('canNudge', () => {
  it('never types into a menu, a sign-in or setup screen, or a printed result', () => {
    for (const screen of [PERMISSION, SIGN_IN, THEME, TRUST]) expect(canNudge(screen)).toBe(false);
    expect(canNudge(CODEX_IDLE, CODEX_IDLE.split('\n'))).toBe(false);
    expect(canNudge(WORKING, WORKING.split('\n'))).toBe(true);
    expect(canNudge('› Ask Codex to do anything')).toBe(true);
  });
});

describe('printedResult', () => {
  const qa = requiredKeys(QA_SCHEMA);

  it('reads a QA report off the screen, wrapped and inside a border', () => {
    const rows = ['● Here is my report.', '```json', ...JSON.stringify(REPORT, null, 2).split('\n').map((l) => `│ ${l}`), '```'];
    // the TUI wrapped the summary mid-sentence
    const wrapped = rows.flatMap((r) => (r.includes('summary') ? [r.slice(0, 40), `  ${r.slice(40)}`] : [r]));
    const got = printedResult(wrapped, qa);
    expect(got).not.toBeNull();
    expect(JSON.parse(got!.text.replace(/^```json\n|\n```$/g, ''))).toMatchObject({ verdict: 'pass', checks: [{ name: 'Unit tests' }] });
  });

  it("needs every key the report's schema requires", () => {
    expect(printedResult(['{"verdict": "pass"}'], qa)).toBeNull();
    expect(printedResult(['Summary so far: {"verdict": "pass", "summary": "x"', '... still testing'], qa)).toBeNull();
    expect(printedResult([JSON.stringify(QA_SCHEMA)], qa)).toBeNull(); // the schema's own properties object
  });

  it('reads a pull request opened, or a session that ended, for a build', () => {
    expect(printedResult(CODEX_IDLE.split('\n'), null)?.text).toContain('pull/344');
    expect(printedResult(CODEX_ENDED.split('\n'), null)).not.toBeNull();
    expect(printedResult(['● Reading the issue.'], null)).toBeNull();
  });
});

describe('SessionWatch', () => {
  const t0 = 1_000_000;
  const tick = (w: SessionWatch, at: number, screen: string, o: Partial<WatchTick> = {}) => w.tick({ now: t0 + at, begun: false, screen, tail: screen.split('\n'), quietMs: at, ...o });

  it('marks a sign-in screen blocked within seconds, once, and clears it when it goes', () => {
    const w = new SessionWatch(t0);
    expect(tick(w, 2_000, SIGN_IN)).toEqual({ do: 'none' });
    expect(tick(w, 8_000, SIGN_IN)).toEqual({ do: 'blocked', stuck: { kind: 'sign-in', reason: 'needs sign-in' } });
    expect(tick(w, 10_000, SIGN_IN)).toEqual({ do: 'none' }); // said once
    expect(tick(w, 12_000, WORKING, { begun: true })).toEqual({ do: 'clear' });
  });

  it('never marks a busy agent blocked for sign-in words on its screen', () => {
    for (const screen of [CURL_401, SIGN_IN_DIFF]) {
      const w = new SessionWatch(t0);
      for (let at = 0; at <= 20_000; at += 2_000) expect(tick(w, at, screen, { begun: true, quietMs: 0 }).do).not.toBe('blocked');
    }
  });

  it('gives the office a moment to answer a folder-trust screen itself', () => {
    const w = new SessionWatch(t0);
    expect(tick(w, 1_000, TRUST)).toEqual({ do: 'none' });
    expect(tick(w, 5_000, TRUST)).toEqual({ do: 'none' });
    expect(tick(w, 12_000, TRUST)).toMatchObject({ do: 'blocked', stuck: { kind: 'setup' } });
  });

  it('retries once a session with no model turn 90 s in, then marks it not started', () => {
    const w = new SessionWatch(t0);
    const blank = '❯ \n  ? for shortcuts';
    expect(tick(w, NOT_STARTED_MS - 1, blank)).toEqual({ do: 'none' });
    expect(tick(w, NOT_STARTED_MS, blank)).toEqual({ do: 'retry' });
    expect(tick(w, NOT_STARTED_MS + RETRY_WAIT_MS - 1, blank)).toEqual({ do: 'none' });
    expect(tick(w, NOT_STARTED_MS + RETRY_WAIT_MS, blank)).toMatchObject({ do: 'blocked', stuck: { kind: 'not-started' } });
    expect(tick(w, NOT_STARTED_MS + RETRY_WAIT_MS + 2_000, WORKING)).toEqual({ do: 'clear' }); // the working indicator counts as started
  });

  it('never presses Enter on a menu (blocked straight away), and leaves a session that began alone', () => {
    const menu = new SessionWatch(t0);
    expect(tick(menu, NOT_STARTED_MS, PERMISSION, { quietMs: 0 })).toMatchObject({ do: 'blocked', stuck: { kind: 'not-started' } });
    const begun = new SessionWatch(t0);
    expect(tick(begun, NOT_STARTED_MS * 2, '❯ ', { begun: true, quietMs: 0 })).toEqual({ do: 'none' });
    const opencode = new SessionWatch(t0, null, false);
    expect(tick(opencode, NOT_STARTED_MS * 2, '❯ ', { quietMs: 0 })).toEqual({ do: 'none' });
  });

  it('completes a session whose result has been on screen a minute, unregistered', () => {
    const w = new SessionWatch(t0, null);
    expect(tick(w, 1_000, WORKING, { quietMs: 0 })).toEqual({ do: 'none' });
    expect(tick(w, 3_000, CODEX_IDLE)).toEqual({ do: 'none' });
    expect(tick(w, 3_000 + UNREGISTERED_MS - 1, CODEX_IDLE)).toEqual({ do: 'none' });
    expect(tick(w, 3_000 + UNREGISTERED_MS, CODEX_IDLE)).toMatchObject({ do: 'complete', text: expect.stringContaining('pull/344') });
  });

  it('flags a session that ended without a report it can read', () => {
    const w = new SessionWatch(t0, requiredKeys(QA_SCHEMA));
    tick(w, 1_000, WORKING, { quietMs: 0 });
    expect(tick(w, 3_000, CODEX_ENDED)).toMatchObject({ do: 'blocked', stuck: { kind: 'unregistered' } });
  });

  it('marks a menu blocked only after a quiet minute (the office answers its own prompts first)', () => {
    const w = new SessionWatch(t0);
    tick(w, 1_000, WORKING, { quietMs: 0 });
    expect(tick(w, 2_000, PERMISSION, { quietMs: 1_000 })).toEqual({ do: 'none' });
    expect(tick(w, 62_000, PERMISSION, { quietMs: 61_000 })).toMatchObject({ do: 'blocked', stuck: { kind: 'menu' } });
  });
});

describe('alerts', () => {
  const at = 5_000_000;

  it('tells a sign-in at once, a prompt after five minutes', () => {
    expect(alertDue({ reason: 'needs sign-in', since: at, told: false, kind: 'sign-in' }, at)).toBe(true);
    expect(alertDue({ reason: 'a prompt', since: at, told: false }, at + NOTIFY_PROMPT_MS - 1)).toBe(false);
    expect(alertDue({ reason: 'a prompt', since: at, told: false }, at + NOTIFY_PROMPT_MS)).toBe(true);
    expect(alertDue({ reason: 'needs sign-in', since: at, told: true, kind: 'sign-in' }, at)).toBe(false);
    expect(alertDue(null, at)).toBe(false);
  });

  it('fires the notification and the CEO job once per state of a task, even if it clears and comes back', () => {
    const told = new Set<string>();
    const blocked = () => ({ reason: 'needs sign-in', since: at, told: false, kind: 'sign-in' as const });
    expect(alertOnce(told, 'a1@1', blocked(), at)).toBe(true);
    expect(alertOnce(told, 'a1@1', blocked(), at + 1)).toBe(false); // back on the same screen
    expect(alertOnce(told, 'a1@1', { ...blocked(), kind: 'not-started' }, at)).toBe(true); // a new state
    expect(alertOnce(told, 'a1@2', blocked(), at)).toBe(true); // a new task
    forgetTold(told, new Set(['a1@2']));
    expect([...told]).toEqual(['a1@2:sign-in']);
  });

  it('words the notice with what fixes it', () => {
    expect(stuckNotice('Ken', { reason: 'needs sign-in', since: at, told: false, kind: 'sign-in' }, at, 2)).toEqual({
      title: 'Ken needs sign-in',
      body: 'Their coding agent is on its sign-in screen on floor 2. Open their terminal and sign in there.',
      who: 'Ken (floor 2)',
      actions: ['terminal'],
    });
    expect(stuckNotice('Ken', { reason: 'x', since: at, told: false, kind: 'not-started' }, at).actions).toEqual(['terminal', 'retry']);
    expect(stuckNotice('Ada', { reason: "a permission prompt the office couldn't answer.", since: at, told: false }, at + NOTIFY_PROMPT_MS, 2).body).toBe(
      "Waiting 5 minutes on a permission prompt the office couldn't answer on floor 2. Open their terminal to answer it.",
    );
  });
});
