// A menu on a coding agent's screen, read for the people who can't see it (#640): its title lines, every option, the
// agent's last step above it, and its class. An account menu (usage or rate limit, signed out, upgrade, a model switch
// for credits) is the account's state, never answered by the office; anything else (folder trust, a hook's approval) is
// an ordinary prompt. Pure: the watchdog (server/liveState.ts) reads it, the notice and the IT ticket carry it.

export type MenuClass = 'account/usage limit' | 'account/rate limit' | 'account/credits' | 'account/sign-in' | 'account/upgrade' | 'prompt';

export interface MenuRead {
  class: MenuClass;
  /** The lines above the options: the question and what it says about it. */
  title: string[];
  /** Every option, in order, the selected one with its marker. */
  options: string[];
  /** The agent's last step: their last tool call, else the last output line above the menu. */
  lastStep?: string;
  /** When a limit says it resets ("try again at 3:05 PM"). */
  reset?: string;
}

// Checked in this order: the Codex limit screen also offers an upgrade and a model switch, but it's the usage limit.
const ACCOUNT: [RegExp, MenuClass][] = [
  [/usage limit|hit your (?:\w+ )?limit|limit reached/i, 'account/usage limit'],
  [/rate limit|too many requests|\b429\b/i, 'account/rate limit'],
  [/credit|quota|billing/i, 'account/credits'],
  [/signed out|not logged in|log ?in|sign ?in|re-?authenticate|session expired/i, 'account/sign-in'],
  [/upgrade (?:to|your)/i, 'account/upgrade'],
];

const OPTION = /^\s*([❯›>]\s*)?(\d+)\.\s+\S/;
const BORDER = /^[\s│┃|╭╮╰╯─━┌┐└┘═]*$/;
const RESET = /(?:try again|resets?|available again|retry)\s+(?:at|in|on)\s+([^.,;\n)]+)/i;
const TITLE_MAX = 4;
const LINE_MAX = 200;

/** A screen row without the TUI's box borders, trimmed and clipped. */
const row = (l: string) => l.replace(/^[\s│┃|]+|[\s│┃|]+$/g, '').replace(/\s+/g, ' ').slice(0, LINE_MAX);

/** The class of a menu by its words. */
export function menuClass(text: string): MenuClass {
  return ACCOUNT.find(([re]) => re.test(text))?.[1] ?? 'prompt';
}

export const isAccountMenu = (m: Pick<MenuRead, 'class'> | null | undefined) => !!m && m.class !== 'prompt';

/**
 * The last numbered menu on screen (options 1, 2… one of them marked), or null. Its title is up to two paragraphs
 * right above option 1; the last step is the line above that.
 */
export function readMenu(screen: string): MenuRead | null {
  const lines = screen.split(/\r?\n/);
  let first = -1;
  for (let i = lines.length - 1; i >= 0 && first < 0; i--) if (OPTION.exec(lines[i])?.[2] === '1') first = i;
  if (first < 0) return null;
  const options: string[] = [];
  let marked = false;
  for (let i = first, next = 1; i < lines.length; i++) {
    const m = OPTION.exec(lines[i]);
    if (!m || Number(m[2]) !== next) continue;
    options.push(row(lines[i]));
    marked ||= !!m[1];
    next++;
  }
  if (options.length < 2 || !marked) return null;
  const title: string[] = [];
  let i = first - 1, paragraphs = 0, blank = true;
  for (; i >= 0 && title.length < TITLE_MAX; i--) {
    if (BORDER.test(lines[i])) {
      if (!blank && ++paragraphs >= 2) break;
      blank = true;
      continue;
    }
    blank = false;
    title.unshift(row(lines[i]));
  }
  let lastStep: string | undefined;
  for (; i >= 0 && !lastStep; i--) if (!BORDER.test(lines[i])) lastStep = row(lines[i]);
  const words = [...title, ...options].join('\n');
  const cls = menuClass(words);
  const reset = cls === 'prompt' ? undefined : RESET.exec(words)?.[1]?.trim();
  return { class: cls, title, options, ...(lastStep && { lastStep }), ...(reset && { reset }) };
}

/** Its question: the last title line asking one, else its last title line. */
const question = (m: MenuRead) => m.title.findLast((l) => l.endsWith('?')) ?? m.title[m.title.length - 1] ?? m.options[0];

/** The words for a blocked state on this menu: an account's state, or the prompt's own question. */
export function menuReason(m: MenuRead): string {
  const ask = question(m);
  if (m.class === 'prompt') return `a menu on screen: "${ask.slice(0, 80)}"`;
  const what = { 'account/usage limit': 'its usage limit', 'account/rate limit': 'a rate limit', 'account/credits': 'out of credits', 'account/sign-in': 'signed out', 'account/upgrade': 'its plan (an upgrade menu)' }[m.class];
  return `the account is at ${what}${m.reset ? ` (resets ${m.reset})` : ''}`;
}

/** The same menu for the same agent files into one ticket: an account menu by its class, a prompt by its question. */
export function menuKey(agent: string, m: MenuRead): string {
  const ask = m.class === 'prompt' ? `:${question(m).toLowerCase().replace(/[^a-z]+/g, ' ').trim()}` : '';
  return `menu:${agent}:${m.class}${ask}`;
}

/** The menu as text for a card or a ticket: class, title, every option and the last step. */
export function menuDetails(m: MenuRead): string {
  return [`Class: ${m.class}`, ...m.title, ...m.options.map((o) => `  ${o}`), ...(m.lastStep ? [`Last step: ${m.lastStep}`] : [])].join('\n');
}
