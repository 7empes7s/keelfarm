// The canvas pictures of the themes' signs and set pieces (#570): the big sign hung over each themed room, the game
// studio's scrolling level, and the newsroom's TVs, story cards, framed front pages and anchor desk.

import { roundRect, SANS } from '../draw';

/** Text cut to fit `max` px wide, with an ellipsis. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** The theme's sign: its words in big letters on a board of its colour, with a light rim. */
export function drawThemeSign(ctx: CanvasRenderingContext2D, w: number, h: number, s: { text: string; bg: string; fg: string }) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = s.bg;
  roundRect(ctx, 4, 4, w - 8, h - 8, h * 0.2);
  ctx.fill();
  ctx.lineWidth = h * 0.06;
  ctx.strokeStyle = s.fg;
  roundRect(ctx, h * 0.1, h * 0.1, w - h * 0.2, h * 0.8, h * 0.14);
  ctx.stroke();
  ctx.fillStyle = s.fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${h * 0.56}px ${SANS}`;
  ctx.fillText(fit(ctx, s.text.split('').join(String.fromCharCode(8202)), w - h * 0.6), w / 2, h * 0.54);
}

/** A platformer's level, one screen wide and seamless at its ends: sky, hills, platforms, coins and a goal flag. */
export function drawLevelStrip(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#5ff2ff');
  sky.addColorStop(1, '#c9b8ff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#7CFFB2';
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc((i + 0.5) * (w / 4), h * 0.95, h * 0.42, Math.PI, 0);
    ctx.fill();
  }
  const ground = h * 0.82;
  ctx.fillStyle = '#b14cff';
  ctx.fillRect(0, ground, w, h - ground);
  ctx.fillStyle = '#ff3cac';
  for (let x = 0; x < w; x += h * 0.18) ctx.fillRect(x, ground, h * 0.09, h * 0.05);
  const blocks = [0.12, 0.34, 0.58, 0.8];
  blocks.forEach((bx, i) => {
    const y = h * (i % 2 ? 0.42 : 0.56);
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(bx * w, y, w * 0.12, h * 0.08);
    ctx.fillStyle = '#ff9f1c';
    ctx.beginPath();
    ctx.arc(bx * w + w * 0.06, y - h * 0.12, h * 0.05, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = '#1f1d2b';
  ctx.fillRect(w * 0.95, h * 0.3, h * 0.025, ground - h * 0.3);
  ctx.fillStyle = '#ff3cac';
  ctx.fillRect(w * 0.95, h * 0.3, h * 0.14, h * 0.09);
}

/** The game's hero: a little round character, drawn on its own so it can hop over the scrolling level. */
export function drawHero(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#ff3cac';
  roundRect(ctx, w * 0.1, h * 0.1, w * 0.8, h * 0.8, w * 0.3);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(w * 0.52, h * 0.3, w * 0.16, h * 0.2);
  ctx.fillStyle = '#1f1d2b';
  ctx.fillRect(w * 0.58, h * 0.34, w * 0.08, h * 0.12);
}

/** One of the newsroom's TVs: a channel bug, a big headline and the lower third. */
export function drawHeadlineTv(ctx: CanvasRenderingContext2D, w: number, h: number, p: { headline: string; channel: string; live: boolean }) {
  ctx.fillStyle = '#10213a';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1f3b5c';
  for (let i = 0; i < 6; i++) ctx.fillRect(w * (0.08 + i * 0.15), h * (0.18 + (i % 3) * 0.06), w * 0.1, h * (0.42 - (i % 3) * 0.06));
  ctx.fillStyle = p.live ? '#d7263d' : '#f8f9fa';
  ctx.fillRect(w * 0.04, h * 0.06, w * 0.22, h * 0.13);
  ctx.fillStyle = p.live ? '#ffffff' : '#10213a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${h * 0.09}px ${SANS}`;
  ctx.fillText(p.live ? 'LIVE' : p.channel, w * 0.15, h * 0.125);
  ctx.fillStyle = '#f8f9fa';
  ctx.fillRect(0, h * 0.62, w, h * 0.26);
  ctx.fillStyle = '#d7263d';
  ctx.fillRect(0, h * 0.62, w * 0.03, h * 0.26);
  ctx.fillStyle = '#10213a';
  ctx.textAlign = 'left';
  ctx.font = `700 ${h * 0.11}px ${SANS}`;
  ctx.fillText(fit(ctx, p.headline.toUpperCase(), w * 0.9), w * 0.06, h * 0.75);
  ctx.fillStyle = '#d7263d';
  ctx.fillRect(0, h * 0.88, w, h * 0.12);
}

const COLUMNS = ['PITCH', 'WRITING', 'EDIT', 'PUBLISHED'];
const CARD_COLORS = ['#ffd166', '#a0e7e5', '#ffaeb6', '#b4f8c8'];

/** The story board: four columns of story cards, as a newsroom plans its stories. */
export function drawStoryCards(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  ctx.fillStyle = '#fbfbf8';
  ctx.fillRect(0, 0, w, h);
  const col = w / COLUMNS.length;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  COLUMNS.forEach((name, c) => {
    ctx.fillStyle = '#10213a';
    ctx.font = `700 ${h * 0.08}px ${SANS}`;
    ctx.fillText(name, col * (c + 0.5), h * 0.08);
    const n = 2 + ((seed + c * 3) % 3);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = CARD_COLORS[(c + i + seed) % CARD_COLORS.length];
      const x = col * c + col * 0.1;
      const y = h * (0.18 + i * 0.26);
      ctx.fillRect(x, y, col * 0.8, h * 0.2);
      ctx.fillStyle = 'rgba(16, 33, 58, 0.55)';
      ctx.fillRect(x + col * 0.08, y + h * 0.05, col * 0.6, h * 0.03);
      ctx.fillRect(x + col * 0.08, y + h * 0.11, col * 0.42, h * 0.03);
    }
  });
}

/** Three framed front pages: a masthead, a headline and columns of text. */
export function drawFrontPages(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#3b2f2f';
  ctx.fillRect(0, 0, w, h);
  const heads = ['MERGED!', 'QA PASSES', 'CI GREEN'];
  const pw = w / 3;
  heads.forEach((head, i) => {
    const x = i * pw + pw * 0.08;
    ctx.fillStyle = '#f4efe3';
    ctx.fillRect(x, h * 0.07, pw * 0.84, h * 0.86);
    ctx.fillStyle = '#10213a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${h * 0.09}px Georgia, "Times New Roman", serif`;
    ctx.fillText('THE DAILY MERGE', x + pw * 0.42, h * 0.16);
    ctx.fillRect(x + pw * 0.06, h * 0.22, pw * 0.72, h * 0.01);
    ctx.font = `800 ${h * 0.13}px ${SANS}`;
    ctx.fillText(head, x + pw * 0.42, h * 0.33);
    ctx.fillStyle = '#9aa5b1';
    ctx.fillRect(x + pw * 0.06, h * 0.43, pw * 0.34, h * 0.24);
    ctx.fillStyle = '#c3bba8';
    for (let r = 0; r < 9; r++) ctx.fillRect(x + pw * (r < 4 ? 0.44 : 0.06), h * (0.45 + (r < 4 ? r : r - 4) * 0.055 + (r < 4 ? 0 : 0.26)), pw * (r < 4 ? 0.34 : 0.72), h * 0.025);
  });
}

/** The anchor desk's backdrop: the city at night, the channel's name and a LIVE bug. */
export function drawAnchorBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number, floor: string) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#1f3b5c');
  g.addColorStop(1, '#10213a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#2b4f7a';
  for (let i = 0; i < 14; i++) {
    const bw = w * 0.06;
    const bh = h * (0.25 + ((i * 37) % 10) * 0.04);
    ctx.fillRect(i * w * 0.072, h - bh, bw, bh);
  }
  ctx.fillStyle = '#ffd166';
  for (let i = 0; i < 40; i++) ctx.fillRect(((i * 53) % 100) * w * 0.01, h * (0.6 + ((i * 29) % 30) * 0.012), w * 0.008, h * 0.02);
  ctx.fillStyle = '#d7263d';
  ctx.fillRect(w * 0.05, h * 0.1, w * 0.14, h * 0.14);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${h * 0.09}px ${SANS}`;
  ctx.fillText('LIVE', w * 0.12, h * 0.17);
  ctx.font = `800 ${h * 0.2}px ${SANS}`;
  ctx.fillText(fit(ctx, `${floor.toUpperCase()} NEWS`, w * 0.8), w / 2, h * 0.38);
}

/** The logo on the anchor desk's front. */
export function drawAnchorLogo(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${h * 0.62}px ${SANS}`;
  ctx.fillText('NEWS 24', w / 2, h * 0.54);
}
