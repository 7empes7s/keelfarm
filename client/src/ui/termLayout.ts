// The agent window on phones (#86): when it goes terminal first, the terminal's font there, and how many rows and
// columns a box of a given size fits. Pure; TerminalView.tsx and LiveTerminal.tsx use it.

/** Phones and touch tablets get the terminal-first window; a computer (≥1280 px or a mouse) keeps the desktop one. */
export const PHONE_WINDOW_QUERY = '(max-width: 760px), (pointer: coarse) and (max-width: 1279px)';

export function phoneWindow(width: number, coarse: boolean): boolean {
  return width <= 760 || (coarse && width < 1280);
}

/** A cell of the terminal's monospace font (JetBrains Mono, Menlo on iOS), in ems. */
const CELL = { width: 0.6, height: 1.32 };
/** The xterm padding inside the terminal box (styles.css .live-term-screen .xterm), and the scrollbar's room. */
const PAD = { x: 14 + 8, y: 12 };

export const TERM_FONT = { desktop: 13, phoneMax: 11, phoneMin: 10, min: 8, max: 20 };
/** The columns a phone's terminal shows at least, when its font can get small enough. */
const PHONE_COLS = 50;

/** The rows and columns a terminal box of `width` × `height` CSS px fits at `fontSize`. */
export function termGrid(width: number, height: number, fontSize: number): { cols: number; rows: number } {
  return {
    cols: Math.max(1, Math.floor((width - PAD.x) / (fontSize * CELL.width))),
    rows: Math.max(1, Math.floor((height - PAD.y) / Math.ceil(fontSize * CELL.height))),
  };
}

/**
 * The terminal's font size: the one this device chose with A−/A+, else 13 on a computer, and on a phone the largest
 * of 11…10 px that still fits 50 columns across a window `width` px wide.
 */
export function termFontSize(phone: boolean, width: number, saved: number | null): number {
  if (saved !== null && Number.isFinite(saved)) return clampFont(saved);
  if (!phone) return TERM_FONT.desktop;
  for (let size = TERM_FONT.phoneMax; size > TERM_FONT.phoneMin; size--) if (termGrid(width, 1000, size).cols >= PHONE_COLS) return size;
  return TERM_FONT.phoneMin;
}

/**
 * The size to give xterm for `px` on screen: the window is zoomed by the UI scale (`uiScale` %, 115 by default on a
 * phone), which would make 12 px text 13.8 px and cost the phone its columns.
 */
export function unzoomedFont(px: number, uiScale: number): number {
  return uiScale > 0 ? px / (uiScale / 100) : px;
}

/** A− / A+: one px smaller or bigger, within limits. */
export function stepFont(size: number, by: 1 | -1): number {
  return clampFont(Math.round(size) + by);
}

function clampFont(size: number) {
  return Math.min(TERM_FONT.max, Math.max(TERM_FONT.min, Math.round(size)));
}
