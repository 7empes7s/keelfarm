// The phone terminal key bar's keys (#37), pure: what each key sends (xterm conventions), the sticky Ctrl/Alt/Shift
// state, the keys each coding agent's bar shows, and the names of what arrives (the demo's terminal echoes them).

import type { AgentCli } from './types.ts';

export type Mod = 'ctrl' | 'alt' | 'shift';
const MODS: readonly Mod[] = ['ctrl', 'alt', 'shift'];

export type NamedKey = 'esc' | 'tab' | 'enter' | 'backspace' | 'up' | 'down' | 'left' | 'right' | 'home' | 'end' | 'pgup' | 'pgdn' | 'del' | `f${number}`;

const CSI = '\x1b[';
const ARROWS: Record<string, string> = { up: 'A', down: 'B', right: 'C', left: 'D', home: 'H', end: 'F' };
const TILDE: Record<string, number> = { del: 3, pgup: 5, pgdn: 6, f5: 15, f6: 17, f7: 18, f8: 19, f9: 20, f10: 21, f11: 23, f12: 24 };
const SS3_F: Record<string, string> = { f1: 'P', f2: 'Q', f3: 'R', f4: 'S' };

/** xterm's modifier parameter: 1 + Shift 1 + Alt 2 + Ctrl 4. */
const modParam = (mods: ReadonlySet<Mod>) => 1 + (mods.has('shift') ? 1 : 0) + (mods.has('alt') ? 2 : 0) + (mods.has('ctrl') ? 4 : 0);

/**
 * What a named key sends with these modifiers. `appCursor` is the terminal's application cursor mode (DECCKM), in
 * which unmodified arrows, Home and End are SS3 (ESC O A) instead of CSI.
 */
export function keySequence(key: NamedKey, mods: ReadonlySet<Mod> = new Set(), appCursor = false): string {
  const m = modParam(mods);
  const alt = mods.has('alt') ? '\x1b' : '';
  if (key in ARROWS) return m > 1 ? `${CSI}1;${m}${ARROWS[key]}` : `${appCursor ? '\x1bO' : CSI}${ARROWS[key]}`;
  if (key in SS3_F) return m > 1 ? `${CSI}1;${m}${SS3_F[key]}` : `\x1bO${SS3_F[key]}`;
  if (key in TILDE) return m > 1 ? `${CSI}${TILDE[key]};${m}~` : `${CSI}${TILDE[key]}~`;
  switch (key) {
    case 'esc':
      return `${alt}\x1b`;
    case 'tab':
      return alt + (mods.has('shift') ? `${CSI}Z` : '\t');
    case 'enter':
      return `${alt}\r`;
    case 'backspace':
      return alt + (mods.has('ctrl') ? '\b' : '\x7f');
  }
  return '';
}

/** Ctrl with a character: letters and @[\]^_ become C0 controls, space NUL, ? DEL; anything else is unchanged. */
function ctrlChar(ch: string): string {
  if (ch === ' ') return '\0';
  if (ch === '?') return '\x7f';
  const code = ch.toUpperCase().charCodeAt(0);
  return ch.length === 1 && code >= 64 && code <= 95 ? String.fromCharCode(code - 64) : ch;
}

/**
 * Typed text with armed modifiers: they apply to its first character (Shift upper-cases it, Ctrl makes it a control
 * character, Alt prefixes ESC). Escape sequences (a hardware key, a paste, the terminal's own replies) pass unchanged.
 */
export function textSequence(text: string, mods: ReadonlySet<Mod>): string {
  if (!text || mods.size === 0 || text.startsWith('\x1b')) return text;
  if (text === '\r') return keySequence('enter', mods);
  if (text === '\t') return keySequence('tab', mods);
  if (text === '\x7f') return keySequence('backspace', mods);
  const [first, ...rest] = Array.from(text);
  let ch = mods.has('shift') ? first.toUpperCase() : first;
  if (mods.has('ctrl')) ch = ctrlChar(ch);
  return (mods.has('alt') ? '\x1b' : '') + ch + rest.join('');
}

// ---------- sticky modifiers ----------

/** A modifier is off, armed for the next key, or locked until tapped again. */
type ModLatch = 'off' | 'once' | 'locked';
export type ModState = Record<Mod, ModLatch>;
export const NO_MODS: ModState = { ctrl: 'off', alt: 'off', shift: 'off' };

/** A second tap within this many ms of the first locks the modifier. */
export const DOUBLE_TAP_MS = 350;

/** A tap on a modifier: off arms it, a quick second tap locks it, a slow second tap or a tap on a locked one clears it. */
export function tapMod(state: ModState, mod: Mod, sinceLastTap: number): ModState {
  const now = state[mod];
  const next: ModLatch = now === 'off' ? 'once' : now === 'once' && sinceLastTap <= DOUBLE_TAP_MS ? 'locked' : 'off';
  return { ...state, [mod]: next };
}

/** The modifiers a key goes out with. */
export const activeMods = (state: ModState): Set<Mod> => new Set(MODS.filter((m) => state[m] !== 'off'));

/** After a key went out: one-shot modifiers clear, locked ones stay. */
export function consumeMods(state: ModState): ModState {
  return MODS.some((m) => state[m] === 'once') ? { ctrl: state.ctrl === 'locked' ? 'locked' : 'off', alt: state.alt === 'locked' ? 'locked' : 'off', shift: state.shift === 'locked' ? 'locked' : 'off' } : state;
}

// ---------- the bar ----------

export type BarKey =
  | { label: string; title: string; key: NamedKey; mods?: Mod[]; repeat?: boolean }
  | { label: string; title: string; text: string; repeat?: boolean }
  | { label: string; title: string; mod: Mod }
  | { label: string; title: string; paste: true; primary?: boolean };

const k = (label: string, title: string, key: NamedKey, extra: { mods?: Mod[]; repeat?: boolean } = {}): BarKey => ({ label, title, key, ...extra });
const t = (label: string, title: string, text: string, repeat = false): BarKey => ({ label, title, text, repeat });

const ARROW_KEYS: BarKey[] = [k('↑', 'Up', 'up', { repeat: true }), k('↓', 'Down', 'down', { repeat: true }), k('←', 'Left', 'left', { repeat: true }), k('→', 'Right', 'right', { repeat: true })];

/** Default CLI shortcuts (custom bindings can differ):
 * https://code.claude.com/docs/en/interactive-mode
 * https://developers.openai.com/codex/cli/reference
 * https://github.com/openai/codex/blob/main/codex-rs/tui/src/keymap.rs
 * https://opencode.ai/docs/keybinds/
 * https://geminicli.com/docs/reference/keyboard-shortcuts/
 */
const CLI_KEYS: Record<AgentCli, BarKey[]> = {
  claude: [
    k('Mode', 'Shift+Tab: cycle permission modes (plan, accept edits)', 'tab', { mods: ['shift'] }),
    t('Rewind', 'Esc Esc: clear the draft, or rewind', '\x1b\x1b'),
    t('Stop', 'Ctrl+C: interrupt, or clear the input', '\x03'),
    t('History', 'Ctrl+R: search the prompt history', '\x12'),
    t('Transcript', 'Ctrl+O: transcript viewer', '\x0f'),
    t('Tasks', "Ctrl+T: Claude's task checklist", '\x14'),
    t('Background', 'Ctrl+B: send running tasks to the background', '\x02'),
  ],
  codex: [t('Edit last', 'Esc Esc: edit the previous message', '\x1b\x1b'), t('Stop', 'Ctrl+C: interrupt, or quit', '\x03'), t('Transcript', 'Ctrl+T: transcript', '\x14'), t('New line', 'Ctrl+J: new line', '\n')],
  opencode: [t('Stop', 'Ctrl+C: clear input, or exit', '\x03'), t('Leader', 'Ctrl+X: the leader key', '\x18')],
  gemini: [t('Stop', 'Ctrl+C: cancel, or clear the input', '\x03'), k('Mode', 'Shift+Tab: cycle approval modes', 'tab', { mods: ['shift'] })],
};

const PASTE: BarKey = { label: 'Paste', title: 'Paste from the clipboard', paste: true };

/** The first row: always visible. `signIn`: a sign-in terminal, where Paste (the code from the browser) is the key that matters (#278). */
export function barKeys(cli: AgentCli, { signIn = false } = {}): BarKey[] {
  return [
    k('Esc', cli === 'claude' ? 'Esc: interrupt, or close a dialog' : 'Esc: interrupt', 'esc'),
    signIn ? { ...PASTE, label: 'Paste code', title: 'Paste the sign-in code from the clipboard', primary: true } : PASTE,
    k('Tab', 'Tab', 'tab'),
    ...ARROW_KEYS,
    k('Enter', 'Enter', 'enter'),
    { label: 'Ctrl', title: 'Ctrl: tap for the next key, double-tap to lock', mod: 'ctrl' },
    ...CLI_KEYS[cli],
    t('/', 'Commands', '/'),
    t('@', 'Mention a file', '@'),
    t('!', 'Run a shell command', '!'),
  ];
}

/** The More panel: the rest of a keyboard. */
export const MORE_KEYS: BarKey[] = [
  { label: 'Alt', title: 'Alt: tap for the next key, double-tap to lock', mod: 'alt' },
  { label: 'Shift', title: 'Shift: tap for the next key, double-tap to lock', mod: 'shift' },
  k('Home', 'Home', 'home'),
  k('End', 'End', 'end'),
  k('PgUp', 'Page up', 'pgup', { repeat: true }),
  k('PgDn', 'Page down', 'pgdn', { repeat: true }),
  k('⌫', 'Backspace', 'backspace', { repeat: true }),
  k('Del', 'Delete', 'del', { repeat: true }),
  ...'AEUKWLDZ'.split('').map((c) => t(`^${c}`, `Ctrl+${c}`, String.fromCharCode(c.charCodeAt(0) - 64))),
  ...Array.from({ length: 12 }, (_, i) => k(`F${i + 1}`, `F${i + 1}`, `f${i + 1}`)),
  t('|', 'Pipe', '|'),
  t('~', 'Tilde', '~'),
  t('`', 'Backtick', '`'),
  t('-', 'Dash', '-'),
  PASTE,
];

/** Pointer keys already send on pointerdown. Touch clicks can have detail 0 too (e.g. inside a sheet). */
export const keyClickSends = (paste: boolean, event: { detail: number; pointerType?: string }) => paste || (event.detail === 0 && !event.pointerType);

// ---------- paste (#278) ----------

/** What goes in: the text without the whitespace and line breaks around it (a copied code often ends in a newline). */
export const pasteText = (raw: string | null | undefined) => (raw ?? '').trim();

/**
 * Paste from the clipboard, or the paste sheet when it can't: no clipboard API (plain http), the browser refused the
 * read (no user activation, a phone's permission prompt said no) or nothing usable on it.
 */
export async function clipboardPaste(clipboard: Pick<Clipboard, 'readText'> | undefined): Promise<{ text: string } | { sheet: true }> {
  if (!clipboard?.readText) return { sheet: true };
  try {
    const text = pasteText(await clipboard.readText());
    return text ? { text } : { sheet: true };
  } catch {
    return { sheet: true };
  }
}

// ---------- names ----------

const NAMES: Record<string, string> = { '\x1b': 'Esc', '\x1b\x1b': 'Esc Esc', '\x1b[Z': 'Shift+Tab', '\t': 'Tab' };
const FINAL_NAMES: Record<string, string> = { A: '↑', B: '↓', C: '→', D: '←', H: 'Home', F: 'End', P: 'F1', Q: 'F2', R: 'F3', S: 'F4' };
const TILDE_NAMES: Record<string, string> = Object.fromEntries(Object.entries(TILDE).map(([name, n]) => [n, name === 'del' ? 'Del' : name === 'pgup' ? 'PgUp' : name === 'pgdn' ? 'PgDn' : name.toUpperCase()]));

function modNames(param: number): string {
  const bits = param - 1;
  return `${bits & 4 ? 'Ctrl+' : ''}${bits & 2 ? 'Alt+' : ''}${bits & 1 ? 'Shift+' : ''}`;
}

/** A key's name for what one input carries ("Esc", "Ctrl+←", "Ctrl+C"), or null for plain text, Enter and unknowns. */
export function keyName(data: string): string | null {
  if (NAMES[data]) return NAMES[data];
  const seq = data.startsWith('\x1b') ? data.slice(1) : '';
  let m = /^[[O](?:1;(\d+))?([ABCDHFPQRS])$/.exec(seq);
  if (m) return modNames(Number(m[1] ?? 1)) + FINAL_NAMES[m[2]];
  m = /^\[(\d+)(?:;(\d+))?~$/.exec(seq);
  if (m && TILDE_NAMES[m[1]]) return modNames(Number(m[2] ?? 1)) + TILDE_NAMES[m[1]];
  if (data.length === 1 && data !== '\r' && data !== '\n' && data !== '\b' && data.charCodeAt(0) >= 1 && data.charCodeAt(0) <= 26) return `Ctrl+${String.fromCharCode(data.charCodeAt(0) + 64)}`;
  if (data.length === 2 && data[0] === '\x1b' && data[1] >= ' ' && data[1] <= '~') return `Alt+${data[1]}`;
  return null;
}

/** Whether a phone's keyboard covers the page, and by how much (CSS px), from the layout and visual viewports. */
export function keyboardInset(innerHeight: number, viewport: { height: number; offsetTop: number } | null): number {
  if (!viewport) return 0;
  const inset = Math.round(innerHeight - viewport.height - viewport.offsetTop);
  return inset > 80 ? inset : 0; // smaller differences are browser bars and pinch zoom, not a keyboard
}
