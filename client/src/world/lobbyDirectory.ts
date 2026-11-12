// The lobby's building directory by the elevator (#371), pure: a row per floor (top floor first, the lobby last) with
// its floor theme's glyph, name and colour, laid out on the board's canvas so every floor fits however many there
// are, and which row a tap on the board lands on (Lobby.tsx's Directory takes you to that floor).

import { FLOOR_THEME_INFO, floorThemeOf } from '../../../shared/floorThemes';

export const DIRECTORY_PX = { w: 768, h: 560, top: 92, bottom: 540, maxRow: 58 };

export interface DirectoryRow {
  floor: number; // 0: the lobby
  name: string;
  color: string; // the floor's own colour, behind its number
  glyph: string; // its theme's
  theme: string; // its theme's name
  accent: string; // its theme's colour
  stats: string;
  /** Its band on the canvas, in pixels from the top. */
  y: number;
  h: number;
}

export interface DirectoryFloor {
  floor: number;
  name: string;
  color: string;
  theme: unknown;
  team: number;
  working: number;
  prs: number;
}

const LOBBY = { glyph: '🛎️', accent: '#ff8a5b' };

/** The board's rows: every floor, top first, then the lobby, each as tall as fits (at most maxRow pixels). */
export function directoryRows(floors: readonly DirectoryFloor[]): DirectoryRow[] {
  const P = DIRECTORY_PX;
  const sorted = [...floors].sort((a, b) => b.floor - a.floor);
  const h = Math.min(P.maxRow, (P.bottom - P.top) / (sorted.length + 1));
  const rows: DirectoryRow[] = sorted.map((f, i) => {
    const info = FLOOR_THEME_INFO[floorThemeOf(f.theme)];
    return { floor: f.floor, name: f.name, color: f.color, glyph: info.glyph, theme: info.name, accent: info.swatch[2], stats: `${f.working}/${f.team} busy · ${f.prs} PR`, y: P.top + i * h, h };
  });
  rows.push({ floor: 0, name: "Lobby & manager's office", color: LOBBY.accent, glyph: LOBBY.glyph, theme: 'Lobby', accent: LOBBY.accent, stats: '', y: P.top + sorted.length * h, h });
  return rows;
}

/** The row under a point on the board, given as 0-1 down its height; null between or outside the rows. */
export function directoryRowAt(rows: readonly DirectoryRow[], v: number): DirectoryRow | null {
  const y = v * DIRECTORY_PX.h;
  return rows.find((r) => y >= r.y && y < r.y + r.h) ?? null;
}
