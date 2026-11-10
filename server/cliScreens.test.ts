import { describe, expect, it } from 'vitest';
import { countAnswer, keyBytes, pick, screenStep } from './cliScreens.ts';

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
  });

  it("skips Codex's update offer and goes on without its hooks", () => {
    const update = ' ✨ Update available! 0.50.0 -> 0.51.0\n › 1. Update now (runs `npm install -g @openai/codex`)\n   2. Skip\n   3. Skip until next version\n Press enter to continue';
    expect(screenStep(update, 'codex')).toMatchObject({ do: 'keys', key: 'down', screen: { id: 'update' } });
    expect(screenStep(update, 'claude')).toBeNull();
  });

  it('sends nothing to a screen it only half recognises, or to a CLI at work', () => {
    expect(screenStep(' Choose the text style that looks best with your terminal', 'claude')).toBeNull(); // no options drawn yet
    expect(screenStep(' WARNING: Claude Code running in Bypass Permissions mode\n ❯ 1. No, exit', 'claude')).toBeNull();
    expect(screenStep(THEME, 'codex')).toBeNull();
    expect(screenStep('● Reading server/swarm.ts\n❯ Try "refactor <filepath>"', 'claude')).toBeNull();
    expect(screenStep(' ❯ 1. Yes\n   2. No\n Do you want to proceed?', 'claude')).toBeNull(); // the watchdog's permission dialog, not a start-up screen
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
