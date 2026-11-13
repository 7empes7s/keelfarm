import { describe, expect, it } from 'vitest';
import { countAnswer, gaveUpNote, keyBytes, pick, SCREEN_TRIES, screenStep, screenTry, type ScreenKey } from './cliScreens.ts';

// Screens as the CLIs drew them in the office's terminals on 2026-11-08 (#360) and since.
const THEME = [
  ' Welcome to Claude Code',
  '',
  " Let's get started.",
  '',
  ' Choose the text style that looks best with your terminal',
  ' To change this later, run /theme',
  '',
  ' ❯ 1. Dark mode ✔',
  '   2. Light mode',
  '   3. Dark mode (colorblind-friendly)',
  '   4. Light mode (colorblind-friendly)',
].join('\n');
const TRUST = [
  ' Accessing workspace:',
  ' /root/.cubefarm/machines/0394689d/work/7empes7s__keelfarm',
  ' Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from your team).',
  " Claude Code'll be able to read, edit, and execute files here.",
  ' ❯ 1. Yes, I trust this folder',
  '   2. No, exit',
  ' Enter to confirm · Esc to cancel',
].join('\n');
const BYPASS = [
  ' WARNING: Claude Code running in Bypass Permissions mode',
  ' In Bypass Permissions mode, Claude Code will not ask for your approval before running potentially dangerous commands.',
  ' By proceeding, you accept all responsibility for actions taken while running in Bypass Permissions mode.',
  ' ❯ 1. No, exit',
  '   2. Yes, I accept',
].join('\n');
const SIGN_IN = [
  ' Browser didn\'t open? Use the url below to sign in (c to copy)',
  ' https://claude.ai/oauth/authorize?code=true&client_id=…',
  ' Paste code here if prompted >',
].join('\n');
const LOGIN_METHOD = [' Select login method:', ' ❯ 1. Claude account with subscription · Pro, Max, Team, or Enterprise', '   2. Anthropic Console account · API usage billing'].join('\n');

describe('screenStep', () => {
  it('keeps the theme picker on its default', () => {
    expect(screenStep(THEME, 'claude')).toMatchObject({ do: 'keys', key: 'enter', screen: { id: 'theme' } });
    expect(screenStep(THEME.replace('❯ 1.', '  1.').replace('  2. Light', '❯ 2. Light'), 'claude')).toMatchObject({ do: 'keys', key: 'up' });
  });

  it('trusts the folder', () => {
    expect(screenStep(TRUST, 'claude')).toMatchObject({ do: 'keys', key: 'enter', screen: { id: 'trust' } });
  });

  it('accepts the Bypass Permissions warning by moving off "No, exit" first', () => {
    expect(screenStep(BYPASS, 'claude')).toMatchObject({ do: 'keys', key: 'down', screen: { id: 'bypass' } });
    expect(screenStep(BYPASS.replace('❯ 1.', '  1.').replace('  2. Yes', '❯ 2. Yes'), 'claude')).toMatchObject({ do: 'keys', key: 'enter' });
  });

  it("reads a sign-in as one nobody here can answer, and sends it no keys", () => {
    expect(screenStep(SIGN_IN, 'claude')).toEqual({ do: 'sign-in' });
    expect(screenStep(LOGIN_METHOD, 'claude')).toEqual({ do: 'sign-in' });
    expect(screenStep(' Sign in with ChatGPT\n › 1. Sign in with ChatGPT\n   2. Provide your own API key', 'codex')).toEqual({ do: 'sign-in' });
    expect(screenStep('> hi\n  ⎿ Not logged in · Please run /login', 'claude')).toEqual({ do: 'sign-in' });
  });

  it('reads sign-in phrases in commands and their output mid-turn as a hint only, never a sign-in', () => {
    const codex = ['• Ran rg -n "Paste code here" server', '  └ server/demo/sessions.ts:27:  \'Paste code here if prompted >\',', '    server/clis.ts:388: Not logged in · Please run /login', '', '› Explain this codebase'].join('\n');
    expect(screenStep(codex, 'codex')).toEqual({ do: 'sign-in-hint' });
    expect(screenStep('reading issue: Not logged in on claude-rvuese', 'opencode')).toEqual({ do: 'sign-in-hint' });
    expect(screenStep('● Bash(grep -n "Select login method" server/cliScreens.ts)\n  ⎿ 52: Select login method', 'claude')).toEqual({ do: 'sign-in-hint' });
    expect(screenStep(' Invalid API key · Fix external API key', 'claude')).toEqual({ do: 'sign-in-hint' });
  });

  it("skips Codex's update offer and goes on without its hooks", () => {
    const update = ' ✨ Update available! 0.50.0 -> 0.51.0\n › 1. Update now (runs `npm install -g @openai/codex`)\n   2. Skip\n   3. Skip until next version\n Press enter to continue';
    expect(screenStep(update, 'codex')).toMatchObject({ do: 'keys', key: 'down', screen: { id: 'update' } });
    expect(screenStep(update, 'claude')).toBeNull();
  });

  // Codex 0.166's start-up screens (#638), as its TUI draws them.
  const TRUST_0166 = ['  Folder access', '  /m/work/acme__web', '  Trust this folder? Codex can read, edit, and run files here, subject to your permission settings.', '› 1. Trust and continue', '  2. Quit', '  enter continue · esc quit'].join('\n');
  const HOOKS_0166 = ['  Hooks need review', '  5 hooks are new or changed.', '  Hooks can run outside the sandbox after you trust them.', '› 1. Review hooks', '  2. Trust all and continue', "  3. Continue without trusting (hooks won't run)"].join('\n');

  it("trusts the office's worktree on Codex 0.166's folder screen", () => {
    expect(screenStep(TRUST_0166, 'codex')).toMatchObject({ do: 'keys', key: 'enter', screen: { id: 'trust' } });
  });

  it("goes on past others' hooks only once the office's own are trusted, never trusting them, and never skips the office's", () => {
    expect(screenStep(HOOKS_0166, 'codex', { officeHooksTrusted: true })).toMatchObject({ do: 'keys', key: 'down', screen: { id: 'hooks' } });
    expect(screenStep(HOOKS_0166.replace('› 1.', '  1.').replace('  3. Continue', '› 3. Continue'), 'codex', { officeHooksTrusted: true })).toMatchObject({ key: 'enter' });
    expect(screenStep(HOOKS_0166, 'codex')).toBeNull(); // left to the manager: the live state says it needs setup
  });

  it('sends nothing to a screen it only half recognises, or to a CLI at work', () => {
    expect(screenStep(' Choose the text style that looks best with your terminal', 'claude')).toBeNull(); // no options drawn yet
    expect(screenStep(' WARNING: Claude Code running in Bypass Permissions mode\n ❯ 1. No, exit', 'claude')).toBeNull();
    expect(screenStep(THEME, 'codex')).toBeNull();
    expect(screenStep('● Reading server/swarm.ts\n❯ Try "refactor <filepath>"', 'claude')).toBeNull();
    expect(screenStep(' ❯ 1. Yes\n   2. No\n Do you want to proceed?', 'claude')).toBeNull(); // the watchdog's permission dialog, not a start-up screen
  });
});

describe('the folder-trust screen (#575)', () => {
  const noSelected = TRUST.replace('❯ 1. Yes', '  1. Yes').replace('  2. No, exit', '❯ 2. No, exit');

  /**
   * Claude Code's trust menu as it behaved on floor 4: Down wraps, and every redraw lands below the frame before it
   * (a resize), so the old ❯ stays on screen above the new one. Runs the office's answers until it presses Enter.
   */
  function drive(start: 0 | 1): { keys: ScreenKey[]; confirmed?: string } {
    const frame = (at: number) => TRUST.replace('❯ 1. Yes', at === 0 ? '❯ 1. Yes' : '  1. Yes').replace('  2. No, exit', at === 1 ? '❯ 2. No, exit' : '  2. No, exit');
    let at: number = start;
    let screen = frame(at);
    const keys: ScreenKey[] = [];
    for (let i = 0; i < 10; i++) {
      const step = screenStep(screen, 'claude');
      if (step?.do !== 'keys') return { keys };
      keys.push(step.key);
      if (step.key === 'enter') return { keys, confirmed: at === 0 ? 'Yes, I trust this folder' : 'No, exit' };
      at = (at + (step.key === 'down' ? 1 : -1) + 2) % 2;
      screen = `${screen}\n${frame(at)}`.split('\n').slice(-30).join('\n');
    }
    return { keys };
  }

  it('with "No, exit" highlighted, ends on Yes and presses Enter once', () => {
    const run = drive(1);
    expect(run.confirmed).toBe('Yes, I trust this folder');
    expect(run.keys.filter((k) => k === 'enter')).toHaveLength(1);
    expect(run.keys.length).toBeLessThanOrEqual(2);
  });

  it('with Yes already highlighted, only presses Enter', () => {
    expect(drive(0).keys).toEqual(['enter']);
  });

  it('never presses Enter while "No, exit" is highlighted, whatever is left on screen above', () => {
    const key = (screen: string) => (screenStep(screen, 'claude') as { key?: ScreenKey } | null)?.key;
    expect(key(noSelected)).toBe('up');
    expect(key(`${TRUST}\n${noSelected}`)).toBe('up'); // an old frame with Yes selected above the live one
    expect(key(`${noSelected}\n${TRUST}\n${noSelected}`)).toBe('up');
    expect(key(`${noSelected}\n${TRUST}`)).toBe('enter'); // the live frame is the last one
    expect(key(noSelected.replace(/^ /gm, ' │ '))).toBe('up'); // drawn in a box
    expect(key(noSelected.replace('  1. Yes', '❯ 1. Yes'))).toBeUndefined(); // two selected in one frame: can't tell
  });

  it('stops after a few tries and says the agent needs setup', () => {
    const tries = new Map<string, number>();
    let gaveUp = 0;
    const got = Array.from({ length: SCREEN_TRIES + 3 }, () => screenTry(tries, 'trust', () => (gaveUp += 1)));
    expect(got).toEqual([...Array<boolean>(SCREEN_TRIES).fill(true), false, false, false]);
    expect(gaveUp).toBe(1);
    expect(screenTry(tries, 'theme', () => (gaveUp += 1))).toBe(true);
    const step = screenStep(TRUST, 'claude');
    if (step?.do === 'keys') expect(gaveUpNote('Alan', step.screen)).toBe(`⚠ Alan needs setup: the office answered their folder-trust question ${SCREEN_TRIES} times and it is still on screen. Open their terminal and pick the answer there.`);
  });
});

describe('pick and keys', () => {
  it('finds the wanted option relative to the selected one', () => {
    expect(pick('❯ 1. A\n  2. B', /^B/)).toBe('down');
    expect(pick('  1. A\n❯ 2. B', /^A/)).toBe('up');
    expect(pick('❯ 1. A\n  2. B', /^C/)).toBeNull();
    expect(pick('  1. A\n  2. B', /^A/)).toBeNull(); // nothing selected: not a menu we can read
  });

  it('turns keys into terminal bytes, in either cursor mode', () => {
    expect(keyBytes('enter', false)).toBe('\r');
    expect(keyBytes('down', false)).toBe('\x1b[B');
    expect(keyBytes('up', true)).toBe('\x1bOA');
  });

  it('counts answers per account and screen', () => {
    expect(countAnswer('claude-x', 'theme')).toBe(1);
    expect(countAnswer('claude-x', 'theme')).toBe(2);
    expect(countAnswer('claude-y', 'theme')).toBe(1);
    expect(countAnswer(undefined, 'theme')).toBe(1);
  });
});
