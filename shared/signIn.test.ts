import { describe, expect, it } from 'vitest';
import { codeProblem, inputShape, maskCode, menuKeys, signInCode, signInEnd, signInScreen } from './signIn.ts';

describe('signInCode', () => {
  it('sends exactly the code, its #state kept', () => {
    expect(signInCode('abc123#state456')).toBe('abc123#state456');
    expect(signInCode('  abc123#state456\r\n')).toBe('abc123#state456');
  });

  it('strips bracketed paste markers, other escapes and line breaks inside it', () => {
    expect(signInCode('\x1b[200~abc123#state456\x1b[201~')).toBe('abc123#state456');
    expect(signInCode('abc123\n#state\t456\x1b]8;;x\x07')).toBe('abc123#state456');
  });

  it('turns a copied callback address into code#state', () => {
    expect(signInCode('https://platform.claude.com/oauth/code/callback?code=abc123&state=state456')).toBe('abc123#state456');
    expect(signInCode('https://example.com/no-code')).toBe('https://example.com/no-code');
  });
});

describe('inputShape', () => {
  it('describes what was sent without the value', () => {
    expect(inputShape('abc123#state456')).toBe('15 characters, with #state');
    expect(inputShape(' \x1b[200~a')).toBe('8 characters, no #state, escape bytes, spaces around it');
  });
});

describe('signInEnd', () => {
  it('names the CLI’s HTTP status when it says one', () => {
    const end = signInEnd('login', 1, ['Paste code here if prompted > ', 'Login failed: Request failed with status code 400', '']);
    expect(end.ok).toBe(false);
    expect(end.note).toMatch(/^Sign-in failed \(400\)\. Try again/);
  });

  it('a clean exit is a success; other failures say the exit code', () => {
    expect(signInEnd('login', 0, [])).toEqual({ ok: true, note: 'Signed in.' });
    expect(signInEnd('setup-token', 0, []).note).toMatch(/copy it/);
    expect(signInEnd('login', 2, ['bye']).note).toBe('Sign-in failed (exit 2). Try again.');
    expect(signInEnd('login', -1, []).note).toMatch(/could not start/);
  });

  it('a CLI that isn’t installed says to install it, not to try again (#493)', () => {
    expect(signInEnd('login', -1, ['── Signing Gemini CLI in ──', "Couldn't start signing in: Gemini CLI isn't installed"])).toEqual({ ok: false, note: "Gemini CLI isn't installed. Tap Install." });
  });
});

// Real output, from `claude auth login` (Claude Code 2.x) and `codex login --device-auth` (codex-cli 0.166.0) in
// throwaway folders, as the terminal's unwrapped screen reads it (#350).
const START_CLAUDE = '── Signing Claude Code in ──';
const CLAUDE_URL =
  'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=org%3Acreate_api_key+user%3Aprofile+user%3Ainference+user%3Asessions%3Aclaude_code+user%3Amcp_servers+user%3Afile_upload+user%3Aplugins&code_challenge=hhuUE_dFmZsg-B2VkqAw6DsYoqxyL71ICyyl2k7uhcw&code_challenge_method=S256&state=JqzKsMJrwWFRbVCJe098AtKRjuOp4eNrchRoSyEHvaI';
const CLAUDE = ['', START_CLAUDE, 'Opening browser to sign in…', `If the browser didn't open, visit: ${CLAUDE_URL}`, 'Paste code here if prompted > ', ''].join('\n');
const CODEX = [
  '── Signing Codex in ──',
  'Welcome to Codex [v0.166.0]',
  "OpenAI's command-line coding agent",
  '',
  'Follow these steps to sign in with ChatGPT using device code authorization:',
  '',
  '1. Open this link in your browser and sign in to your account',
  '   https://auth.openai.com/codex/device',
  '',
  '2. Enter this one-time code (expires in 15 minutes)',
  '   B0VZ-0ZW5L',
  '',
  'Continue only if you started this login in Codex. If a website or another person gave you this code, cancel.',
].join('\n');
const LOGIN_MENU = [
  START_CLAUDE,
  ' Select login method:',
  '',
  ' ❯ 1. Claude account with subscription · Pro, Max, Team, or Enterprise',
  '   2. Anthropic Console account · API usage billing',
  '   3. 3rd-party platform · Amazon Bedrock, Microsoft Foundry, or Vertex AI',
].join('\n');

describe('signInScreen', () => {
  it('finds Claude Code’s link and its waiting prompt', () => {
    expect(signInScreen(CLAUDE)).toEqual({ url: CLAUDE_URL, deviceCode: null, waiting: true, menu: null, pick: null, result: null });
  });

  it('finds Codex’s link and one-time code, and never reads its numbered steps as a menu', () => {
    expect(signInScreen(CODEX)).toMatchObject({ url: 'https://auth.openai.com/codex/device', deviceCode: 'B0VZ-0ZW5L', waiting: false, menu: null });
  });

  it('answers the login method, the first-run theme and folder trust by itself', () => {
    expect(signInScreen(LOGIN_MENU)).toMatchObject({ url: null, menu: { text: 'Select login method:', at: 0 }, pick: 0 });
    const theme = signInScreen([' Choose the text style that looks best with your terminal', '', '   1. Light mode', ' ❯ 2. Dark mode ✔', '   3. Dark mode (colorblind-friendly)'].join('\n'));
    expect(theme).toMatchObject({ menu: { at: 1, options: ['Light mode', 'Dark mode', 'Dark mode (colorblind-friendly)'] }, pick: 1 });
    expect(signInScreen(' Do you trust the files in this folder?\n ❯ 1. Yes, proceed\n   2. No, exit').pick).toBe(0);
  });

  it('asks about a menu it doesn’t know, and forgets one with the link under it', () => {
    expect(signInScreen(' Pick an organization\n ❯ 1. Acme\n   2. Initech')).toMatchObject({ menu: { text: 'Pick an organization', options: ['Acme', 'Initech'] }, pick: null });
    expect(signInScreen(`${LOGIN_MENU}\n${CLAUDE}`.replace(START_CLAUDE + '\nOpening', 'Opening'))).toMatchObject({ menu: null, url: CLAUDE_URL, waiting: true });
  });

  it('tells success from failure, reading only this sign-in (what’s above its first line is an older one)', () => {
    expect(signInScreen(`${CLAUDE}\nLogin successful.`)).toMatchObject({ result: 'ok', waiting: false });
    expect(signInScreen(`${CODEX}\nSuccessfully logged in`).result).toBe('ok');
    expect(signInScreen(`${CLAUDE}\nLogin failed: Request failed with status code 400`)).toMatchObject({ result: 'failed', waiting: false });
    expect(signInScreen(`${CLAUDE}\nLogin failed: Request failed with status code 400\n${CLAUDE}`)).toMatchObject({ result: null, waiting: true });
  });
});

describe('menuKeys', () => {
  it('moves the highlight and chooses', () => {
    expect(menuKeys(0, 0)).toBe('\r');
    expect(menuKeys(0, 2)).toBe('\x1b[B\x1b[B\r');
    expect(menuKeys(2, 1, true)).toBe('\x1bOA\r');
  });
});

describe('codeProblem and maskCode', () => {
  it('says what is wrong with a paste before it is sent', () => {
    expect(codeProblem('')).toMatch(/Nothing pasted/);
    expect(codeProblem('https://claude.com/cai/oauth/authorize?code=true')).toMatch(/web address/);
    expect(codeProblem('Paste code here if prompted')).toMatch(/spaces/);
    expect(codeProblem('abc123#state456')).toBeNull();
    expect(codeProblem(' abc123#state456\n')).toBeNull(); // a copied newline is trimmed, as signInCode does
    expect(codeProblem('https://platform.claude.com/oauth/code/callback?code=abc&state=xyz')).toBeNull(); // a callback address carries the code
  });

  it('masks all but the first and last 4', () => {
    expect(maskCode('abcd1234567890wxyz')).toBe('abcd••••••••••wxyz');
    expect(maskCode('abc')).toBe('•••');
    expect(maskCode('')).toBe('');
  });
});
