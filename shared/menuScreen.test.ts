import { describe, expect, it } from 'vitest';
import { menuClass, menuDetails, menuKey, menuReason, readMenu } from './menuScreen.ts';

// Codex's usage-limit menu as it held Ada and Grace (#640, IT tickets #54 and #64).
const CODEX_LIMIT = `• Ran npm test -- --maxWorkers=2
  └ 214 passed

  ■ You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), or try again at 3:05 PM.

  Switch to gpt-6-luna for lower credit usage?

› 1. Switch to gpt-6-luna
  2. Keep current model
  3. Keep current model (never show again)

  Press enter to confirm or esc to go back`;
const TRUST = ` Do you trust the files in this folder?

 /root/.cubefarm/machines/m1/work/acme__app

 ❯ 1. Yes, proceed
   2. No, exit

 Enter to confirm · Esc to exit`;

// The same menu with its message wrapped in a narrow terminal (the rows of the #400 test in accountRotation.test.ts).
const WRAPPED = ['■ You’ve hit your usage limit.', 'Upgrade to Pro (https://chatgpt.com/explore/pro),', 'visit https://chatgpt.com/settings/usage to', 'purchase more credits or try again at', '9:08 PM.'].flatMap((l) => l.match(/.{1,40}/gu) ?? []);
const CODEX_WRAPPED = ['• Ran npm test -- --maxWorkers=2', '  └ 214 passed', '', ...WRAPPED, '', 'Switch to gpt-6-luna for lower credit usage?', '', '› 1. Switch to gpt-6-luna', '  2. Keep current model', '  3. Keep current model (never show again)'].join('\n');
const BASH_LOGIN = ` Bash command

   gh auth login --with-token
   Sign in to GitHub with a token

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for gh auth login commands
   3. No, and tell Claude what to do differently (esc)`;
const EDIT_BILLING = ` Edit file

 Do you want to make this edit to billing.ts?
 ❯ 1. Yes
   2. Yes, allow all edits during this session
   3. No, and tell Claude what to do differently (esc)`;

describe('readMenu', () => {
  it("reads Codex's usage-limit menu: its title, every option, the last step, the class and the reset", () => {
    const m = readMenu(CODEX_LIMIT)!;
    expect(m).toEqual({
      class: 'account/usage limit',
      title: ["■ You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), or try again at 3:05 PM.", 'Switch to gpt-6-luna for lower credit usage?'],
      options: ['› 1. Switch to gpt-6-luna', '2. Keep current model', '3. Keep current model (never show again)'],
      lastStep: '└ 214 passed',
      reset: '3:05 PM',
    });
    expect(menuReason(m)).toBe('the account is at its usage limit (resets 3:05 PM)');
    const details = menuDetails(m);
    expect(details).toContain('Class: account/usage limit');
    for (const line of [...m.title, ...m.options, 'Last step: └ 214 passed']) expect(details).toContain(line);
  });

  it("reads Codex's usage-limit menu wrapped in a narrow terminal as one message (#400)", () => {
    const m = readMenu(CODEX_WRAPPED)!;
    expect(m).toMatchObject({ class: 'account/usage limit', reset: '9:08 PM', lastStep: '└ 214 passed' });
    expect(m.title).toEqual([...WRAPPED.map((l) => l.trim()), 'Switch to gpt-6-luna for lower credit usage?']);
    expect(menuReason(m)).toBe('the account is at its usage limit (resets 9:08 PM)');
  });

  it("calls a permission prompt a prompt, whatever its command or file says about logins or billing", () => {
    expect(readMenu(BASH_LOGIN)!.class).toBe('prompt');
    expect(readMenu(EDIT_BILLING)!.class).toBe('prompt');
    expect(menuReason(readMenu(EDIT_BILLING)!)).toBe('a menu on screen: "Do you want to make this edit to billing.ts?"');
  });

  it('words each account state plainly', () => {
    const at = (cls: Parameters<typeof menuReason>[0]['class']) => menuReason({ class: cls, title: ['x'], options: [] });
    expect(at('account/credits')).toBe('the account is out of credits');
    expect(at('account/sign-in')).toBe('the account is signed out');
  });

  it('calls a folder-trust question a prompt, with its question as the reason', () => {
    const m = readMenu(TRUST)!;
    expect(m.class).toBe('prompt');
    expect(m.options).toEqual(['❯ 1. Yes, proceed', '2. No, exit']);
    expect(m.title).toEqual(['Do you trust the files in this folder?', '/root/.cubefarm/machines/m1/work/acme__app']);
    expect(m.reset).toBeUndefined();
    expect(menuReason(m)).toBe('a menu on screen: "Do you trust the files in this folder?"');
  });

  it('sorts account states from ordinary prompts', () => {
    expect(menuClass('Rate limit exceeded. 1. Wait 2. Stop')).toBe('account/rate limit');
    expect(menuClass('You are signed out. 1. Log in 2. Exit')).toBe('account/sign-in');
    expect(menuClass('Out of credits 1. Buy more 2. Exit')).toBe('account/credits');
    expect(menuClass('Upgrade to Max for more 1. Upgrade 2. Not now')).toBe('account/upgrade');
    expect(menuClass('Do you want to proceed? 1. Yes 2. No')).toBe('prompt');
  });

  it('needs a numbered list with a selection, so a list of steps is no menu', () => {
    expect(readMenu('Steps:\n 1. Build\n 2. Test')).toBeNull();
    expect(readMenu('❯ 1. Only one')).toBeNull();
  });

  it("keys the same menu for the same agent the same, whatever its reset time says", () => {
    const later = readMenu(CODEX_LIMIT.replace('3:05 PM', '8:40 PM'))!;
    expect(menuKey('Ada', later)).toBe(menuKey('Ada', readMenu(CODEX_LIMIT)!));
    expect(menuKey('Grace', later)).not.toBe(menuKey('Ada', later));
    expect(menuKey('Ada', readMenu(TRUST)!)).not.toBe(menuKey('Ada', later));
  });
});
