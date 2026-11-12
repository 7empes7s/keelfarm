// The project props' pictures (#536), drawn on canvases like the themes' (floorThemes/studioDraw.ts): the board screen
// every floor has, the tenant status screen, the noticeboard, the live wall, the countdown and clips counter, the
// terminal wall, and the posters. Plain words and generic shapes: no logos.

import { roundRect, SANS } from '../draw';
import type { FloorBoard, Gate, TeamStatus } from './screens';

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, opts: { weight?: number; align?: CanvasTextAlign; font?: string } = {}) {
  ctx.font = `${opts.weight ?? 600} ${size}px ${opts.font ?? SANS}`;
  ctx.fillStyle = color;
  ctx.textAlign = opts.align ?? 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}

// ---------- the board screen ----------

export interface BoardPicture {
  name: string;
  board: FloorBoard;
  latest: { number: number; title: string } | null;
  latestAgo: string;
  team: TeamStatus;
  shot: HTMLImageElement | null;
  preview: string; // the preview's status word
}

/** The floor's board: four column tiles, the latest merge, the team, and the preview's thumbnail when it has one. */
export function drawBoard(ctx: CanvasRenderingContext2D, w: number, h: number, p: BoardPicture) {
  ctx.fillStyle = '#14213d';
  ctx.fillRect(0, 0, w, h);
  text(ctx, `${p.name.toUpperCase()} · BOARD`, 28, 40, 30, '#e5e5e5', { weight: 700 });
  const tiles: [string, number, string][] = [
    ['In progress', p.board.progress, '#3a86ff'],
    ['In QA', p.board.qa, '#ffbe0b'],
    ['Ready', p.board.ready, '#06d6a0'],
    ['Merged today', p.board.mergedToday, '#c77dff'],
  ];
  const tw = (w - 28 * 2 - 18 * 3) / 4;
  tiles.forEach(([label, n, color], i) => {
    const x = 28 + i * (tw + 18);
    ctx.fillStyle = '#1f2f56';
    roundRect(ctx, x, 74, tw, 150, 16);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillRect(x, 74, tw, 8);
    text(ctx, String(n), x + tw / 2, 146, 70, '#ffffff', { weight: 700, align: 'center' });
    text(ctx, label, x + tw / 2, 202, 24, '#cfd8e3', { weight: 500, align: 'center' });
  });
  const thumbW = p.shot ? 300 : 0;
  text(ctx, 'LATEST MERGE', 28, 268, 20, '#8d99ae', { weight: 700 });
  text(ctx, p.latest ? clip(`#${p.latest.number} ${p.latest.title}`, p.shot ? 34 : 52) : 'Nothing merged yet', 28, 306, 30, '#ffffff');
  text(ctx, p.latest ? p.latestAgo : '—', 28, 344, 22, '#cfd8e3', { weight: 500 });
  text(ctx, 'TEAM', 28, 396, 20, '#8d99ae', { weight: 700 });
  text(ctx, `${p.team.working} working · ${p.team.free} free${p.team.help ? ` · ${p.team.help} need help` : ''}`, 28, 432, 28, p.team.help ? '#ffadad' : '#ffffff');
  text(ctx, `Preview: ${p.preview}`, 28, 474, 22, '#cfd8e3', { weight: 500 });
  if (p.shot) {
    const tx = w - thumbW - 28;
    const th = Math.min(220, (thumbW * p.shot.height) / Math.max(1, p.shot.width));
    ctx.fillStyle = '#000000';
    ctx.fillRect(tx - 4, 256, thumbW + 8, th + 8);
    ctx.drawImage(p.shot, tx, 260, thumbW, th);
    text(ctx, 'PREVIEW', tx, 260 + th + 26, 18, '#8d99ae', { weight: 700 });
  }
}

// ---------- the backup vault ----------

const CHECK: Record<Gate['checks'], [string, string]> = { passing: ['checks pass', '#06d6a0'], failing: ['checks fail', '#ef476f'], pending: ['checks running', '#ffbe0b'], none: ['no checks', '#8d99ae'] };

/** The tenant status screen: when the floor last shipped and its open PRs' restore gates. */
export function drawTenant(ctx: CanvasRenderingContext2D, w: number, h: number, p: { lastMerge: string; gates: Gate[]; open: number }) {
  ctx.fillStyle = '#0b132b';
  ctx.fillRect(0, 0, w, h);
  text(ctx, 'TENANT STATUS', 24, 34, 28, '#5bc0be', { weight: 700 });
  text(ctx, `Last change shipped: ${p.lastMerge}`, 24, 78, 24, '#ffffff', { weight: 500 });
  text(ctx, `Restore gates · ${p.open} open PR${p.open === 1 ? '' : 's'}`, 24, 120, 20, '#8d99ae', { weight: 700 });
  if (!p.gates.length) text(ctx, 'No PRs waiting', 24, 160, 22, '#cfd8e3', { weight: 500 });
  p.gates.forEach((g, i) => {
    const y = 160 + i * 40;
    const [word, color] = CHECK[g.checks];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(34, y, 8, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, clip(`#${g.number} ${g.title}`, 26), 52, y, 20, '#ffffff', { weight: 500 });
    text(ctx, g.qa ? `${word} · QA ${g.qa}` : word, w - 24, y, 18, color, { weight: 600, align: 'right' });
  });
}

// ---------- the town hall ----------

/** A cork noticeboard with the floor's newest open issues pinned up as notices. */
export function drawNoticeboard(ctx: CanvasRenderingContext2D, w: number, h: number, items: { number: number; title: string }[]) {
  ctx.fillStyle = '#c99a6b';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#7f5539';
  ctx.lineWidth = 14;
  ctx.strokeRect(7, 7, w - 14, h - 14);
  text(ctx, 'TOWN HALL NOTICES', w / 2, 40, 28, '#3d2b1f', { weight: 700, align: 'center' });
  if (!items.length) text(ctx, 'Nothing on the agenda', w / 2, h / 2 + 10, 24, '#3d2b1f', { weight: 500, align: 'center' });
  const cw = (w - 60) / 2;
  items.forEach((it, i) => {
    const x = 24 + (i % 2) * (cw + 12);
    const y = 70 + Math.floor(i / 2) * 84;
    ctx.fillStyle = ['#fefae0', '#e9f5db', '#fde2e4', '#dbe7f5'][i % 4];
    ctx.fillRect(x, y, cw, 72);
    ctx.fillStyle = '#e63946';
    ctx.beginPath();
    ctx.arc(x + cw / 2, y + 8, 6, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, `#${it.number}`, x + 12, y + 28, 18, '#6c584c', { weight: 700 });
    text(ctx, clip(it.title, 24), x + 12, y + 52, 18, '#3d2b1f', { weight: 500 });
  });
}

/** A generic district map: streets, a river, a park and pins on polling places. */
export function drawMapPoster(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#f1faee';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#a8dadc';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.7);
  ctx.bezierCurveTo(w * 0.3, h * 0.5, w * 0.6, h * 0.95, w, h * 0.6);
  ctx.lineTo(w, h * 0.75);
  ctx.bezierCurveTo(w * 0.6, h * 1.05, w * 0.3, h * 0.65, 0, h * 0.85);
  ctx.fill();
  ctx.fillStyle = '#b7e4c7';
  ctx.fillRect(w * 0.12, h * 0.18, w * 0.2, h * 0.25);
  ctx.strokeStyle = '#ced4da';
  ctx.lineWidth = 6;
  for (let i = 1; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo((i * w) / 6, 0);
    ctx.lineTo((i * w) / 6 + 20, h);
    ctx.stroke();
  }
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(0, (i * h) / 4);
    ctx.lineTo(w, (i * h) / 4 - 10);
    ctx.stroke();
  }
  for (const [x, y] of [[0.42, 0.3], [0.7, 0.22], [0.58, 0.55], [0.25, 0.6]]) {
    ctx.fillStyle = '#e63946';
    ctx.beginPath();
    ctx.arc(x * w, y * h, 10, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(29,53,87,0.9)';
  ctx.fillRect(0, 0, w, 44);
  text(ctx, 'DISTRICT MAP', 16, 23, 24, '#ffffff', { weight: 700 });
}

// ---------- the workshop, the device lab and the playtest corner ----------

/** A blueprint of a building: grid, a plan view and dimension lines. */
export function drawBlueprint(ctx: CanvasRenderingContext2D, w: number, h: number, title: string) {
  ctx.fillStyle = '#1d4e89';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 20) ctx.strokeRect(x, 0, 0.5, h);
  for (let y = 0; y < h; y += 20) ctx.strokeRect(0, y, w, 0.5);
  ctx.strokeStyle = '#e0fbfc';
  ctx.lineWidth = 3;
  ctx.strokeRect(w * 0.12, h * 0.2, w * 0.5, h * 0.6);
  ctx.strokeRect(w * 0.12, h * 0.2, w * 0.2, h * 0.3);
  ctx.strokeRect(w * 0.62, h * 0.35, w * 0.24, h * 0.45);
  ctx.beginPath();
  ctx.moveTo(w * 0.12, h * 0.88);
  ctx.lineTo(w * 0.62, h * 0.88);
  ctx.stroke();
  text(ctx, title, w - 16, 26, 22, '#e0fbfc', { weight: 700, align: 'right' });
}

/** Wireframes of three screens, phone-sized, on a whiteboard. */
export function drawWireframes(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#fbfbfb';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#495057';
  ctx.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    const x = 30 + i * ((w - 60) / 3);
    const fw = (w - 60) / 3 - 30;
    roundRect(ctx, x, 40, fw, h - 70, 14);
    ctx.stroke();
    ctx.fillStyle = '#ced4da';
    ctx.fillRect(x + 12, 60, fw - 24, 22);
    for (let r = 0; r < 4; r++) ctx.fillRect(x + 12, 100 + r * 34, fw - 24 - (r % 2) * 30, 14);
    ctx.fillStyle = '#3a86ff';
    roundRect(ctx, x + 12, h - 80, fw - 24, 26, 8);
    ctx.fill();
  }
  text(ctx, 'WIREFRAMES', 30, 22, 22, '#495057', { weight: 700 });
}

/** A level map: tiles, a path, a start and a goal. */
export function drawLevelMap(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#240046';
  ctx.fillRect(0, 0, w, h);
  const s = 32;
  for (let y = 0; y < h; y += s)
    for (let x = 0; x < w; x += s) {
      const n = (x * 7 + y * 13) % 5;
      ctx.fillStyle = n === 0 ? '#3c096c' : n === 1 ? '#5a189a' : '#10002b';
      ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
    }
  ctx.strokeStyle = '#ffbe0b';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(40, h - 40);
  ctx.lineTo(w * 0.35, h - 60);
  ctx.lineTo(w * 0.45, h * 0.35);
  ctx.lineTo(w - 50, 50);
  ctx.stroke();
  text(ctx, 'START', 30, h - 18, 18, '#06d6a0', { weight: 700 });
  text(ctx, 'GOAL', w - 30, 26, 18, '#ef476f', { weight: 700, align: 'right' });
}

// ---------- the video studio ----------

/** The live wall: LIVE NOW, the latest screen from the floor and who's working. */
export function drawLiveWall(ctx: CanvasRenderingContext2D, w: number, h: number, p: { live: boolean; working: number; shot: HTMLImageElement | null }) {
  ctx.fillStyle = '#111111';
  ctx.fillRect(0, 0, w, h);
  if (p.shot) ctx.drawImage(p.shot, 0, 0, w, h);
  else {
    ctx.fillStyle = '#1b1b1f';
    for (let i = 0; i < 4; i++) ctx.fillRect(16 + i * ((w - 32) / 4), 60, (w - 32) / 4 - 12, h - 110);
  }
  ctx.fillStyle = p.live ? '#e63946' : '#495057';
  roundRect(ctx, 16, 14, 150, 38, 8);
  ctx.fill();
  if (p.live) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(34, 33, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  text(ctx, p.live ? 'LIVE NOW' : 'OFF AIR', p.live ? 100 : 91, 33, 20, '#ffffff', { weight: 700, align: 'center' });
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, h - 40, w, 40);
  text(ctx, `${p.working} editing now`, 16, h - 20, 20, '#ffffff', { weight: 600 });
}

/** The launch countdown poster. */
export function drawCountdown(ctx: CanvasRenderingContext2D, w: number, h: number, p: { days: number | null; date: string | null }) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#7209b7');
  g.addColorStop(1, '#f72585');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  text(ctx, 'LAUNCH', w / 2, 34, 26, '#ffffff', { weight: 700, align: 'center' });
  text(ctx, p.days === null ? '—' : String(p.days), w / 2, h / 2 + 4, 84, '#ffffff', { weight: 700, align: 'center' });
  text(ctx, p.days === null ? 'No date in the mission' : `${p.days === 1 ? 'day' : 'days'} to ${p.date}`, w / 2, h - 30, 20, '#ffe5ec', { weight: 600, align: 'center' });
}

/** The clips-approved counter: today's in big digits, the recent total under it. */
export function drawClipsCounter(ctx: CanvasRenderingContext2D, w: number, h: number, p: { today: number; total: number }) {
  ctx.fillStyle = '#0d1b2a';
  ctx.fillRect(0, 0, w, h);
  text(ctx, 'CLIPS APPROVED', w / 2, 32, 24, '#90e0ef', { weight: 700, align: 'center' });
  text(ctx, String(p.today).padStart(3, '0'), w / 2, h / 2 + 6, 80, '#caffbf', { weight: 700, align: 'center', font: MONO });
  text(ctx, `today · ${p.total} recently`, w / 2, h - 28, 20, '#cfd8e3', { weight: 500, align: 'center' });
}

/** A vertical clip on an editing phone. */
export function drawClip(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, ['#ff006e', '#3a86ff', '#06d6a0'][seed % 3]);
  g.addColorStop(1, ['#8338ec', '#ffbe0b', '#118ab2'][seed % 3]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.42, w * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, h - 40, w, 40);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(10, h - 22, (w - 20) * (0.3 + (seed % 3) * 0.25), 6);
}

// ---------- the server room ----------

/** A green terminal wall: the floor's latest merges as a git log. */
export function drawTerminal(ctx: CanvasRenderingContext2D, w: number, h: number, lines: string[]) {
  ctx.fillStyle = '#0b0f0c';
  ctx.fillRect(0, 0, w, h);
  text(ctx, '$ git log --oneline', 18, 28, 22, '#7CFF8A', { weight: 500, font: MONO });
  if (!lines.length) text(ctx, '(nothing merged yet)', 18, 64, 20, '#3f8f4a', { weight: 500, font: MONO });
  lines.forEach((l, i) => text(ctx, clip(l, 40), 18, 64 + i * 32, 20, '#7CFF8A', { weight: 500, font: MONO }));
}

/** A small terminal-green desk screen. */
export function drawDeskTerminal(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#0b0f0c';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = '#7CFF8A';
    ctx.fillRect(8, 10 + i * 16, 20 + ((i * 37) % (w - 40)), 6);
  }
}

/** A drawing tablet's or phone's glowing screen: a sketch, or an app. */
export function drawSketch(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#f8f9fa';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#ff006e';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(w * 0.15, h * 0.7);
  ctx.bezierCurveTo(w * 0.3, h * 0.1, w * 0.6, h * 0.9, w * 0.85, h * 0.3);
  ctx.stroke();
}
