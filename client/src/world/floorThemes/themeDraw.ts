// The floor themes' pictures (#370), drawn on canvases for their screens, posters and signs: the game studio's arcade
// and engine screens, posters, level sketch, neon and Playtest screen; the trading floor's charts, news, ticker strip,
// market board and world clocks. Plain 2D canvas calls, so the paint worker (world/paint/) can record them.

import { roundRect, SANS } from '../draw';
import type { Candle, Quote } from './ticker';

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const NEON = ['#b14cff', '#2de2e6', '#ff3cac', '#ffd166'];

/** A seeded little random, so every picture is the same each time it's drawn. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// ---------- game studio ----------

/** An arcade cabinet's screen: a starfield shooter frozen mid-game. */
export function drawArcadeScreen(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#0b0820';
  ctx.fillRect(0, 0, w, h);
  const r = rng(7);
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = i % 5 ? 'rgba(255,255,255,0.6)' : '#2de2e6';
    ctx.fillRect(r() * w, r() * h, 2, 2);
  }
  const px = (x: number, y: number, c: string, s = 8) => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, s, s);
  };
  for (let row = 0; row < 3; row++) for (let i = 0; i < 6; i++) px(30 + i * 34, 30 + row * 26, NEON[row], 14);
  px(w / 2 - 12, h - 40, '#7CFFB2', 24);
  ctx.fillStyle = '#ffd166';
  ctx.font = `700 16px ${MONO}`;
  ctx.fillText('1UP 004200', 8, 18);
}

/** A desk's second monitor: a 3D engine's viewport (a grid, a gizmo, a low-poly hero) with its panels. */
export function drawEngineViewport(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#1d1d26';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#2a2a36';
  ctx.fillRect(0, 0, w, 18);
  ctx.fillRect(w * 0.78, 18, w * 0.22, h - 18);
  const vx = 0;
  const vw = w * 0.78;
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  const hy = h * 0.55;
  for (let i = -10; i <= 10; i++) {
    ctx.beginPath();
    ctx.moveTo(vx + vw / 2 + i * 14, hy);
    ctx.lineTo(vx + vw / 2 + i * 50, h);
    ctx.stroke();
  }
  for (let j = 0; j < 7; j++) {
    const y = hy + (h - hy) * ((j / 6) ** 1.6);
    ctx.beginPath();
    ctx.moveTo(vx, y);
    ctx.lineTo(vw, y);
    ctx.stroke();
  }
  // the hero: a low-poly character's silhouette in orange, selected
  const cx = vw / 2;
  ctx.fillStyle = '#f4a261';
  ctx.beginPath();
  ctx.moveTo(cx - 22, h * 0.78);
  ctx.lineTo(cx - 16, h * 0.42);
  ctx.lineTo(cx + 16, h * 0.42);
  ctx.lineTo(cx + 22, h * 0.78);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, h * 0.34, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffb703';
  ctx.lineWidth = 2;
  ctx.strokeRect(cx - 30, h * 0.2, 60, h * 0.62);
  // the move gizmo
  const g = [cx + 40, h * 0.5];
  for (const [dx, dy, c] of [
    [30, 0, '#ff4d6d'],
    [0, -30, '#7CFFB2'],
    [-18, 18, '#4cc9f0'],
  ] as const) {
    ctx.strokeStyle = c;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(g[0], g[1]);
    ctx.lineTo(g[0] + dx, g[1] + dy);
    ctx.stroke();
  }
  // the outliner
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = `500 10px ${SANS}`;
  ['Scene', '  Camera', '  Light', '  Hero', '  Level_01'].forEach((t, i) => {
    if (i === 3) {
      ctx.fillStyle = '#3a86ff';
      ctx.fillRect(w * 0.78 + 2, 22 + i * 14, w * 0.22 - 4, 13);
      ctx.fillStyle = '#ffffff';
    } else ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(t, w * 0.78 + 6, 32 + i * 14);
  });
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText('▶  ⏸  File  Edit  Assets  Build', 6, 13);
}

/** Three game posters side by side. */
export function drawPosters(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const titles: [string, string, string][] = [
    ['NEON DRIFT', '#ff3cac', '🏎️'],
    ['DUNGEON.EXE', '#2de2e6', '🗡️'],
    ['SPACE CATS', '#b14cff', '🐱'],
  ];
  const pw = w / 3;
  titles.forEach(([title, color, icon], i) => {
    const x = i * pw + pw * 0.06;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#120a2a');
    g.addColorStop(1, color);
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, pw * 0.88, h);
    ctx.textAlign = 'center';
    ctx.font = `${pw * 0.4}px ${SANS}`;
    ctx.fillText(icon, x + pw * 0.44, h * 0.48);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${pw * 0.11}px ${SANS}`;
    ctx.fillText(title, x + pw * 0.44, h * 0.8);
    ctx.font = `500 ${pw * 0.055}px ${SANS}`;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText('COMING SOON', x + pw * 0.44, h * 0.9);
  });
}

/** A whiteboard of level sketches: platforms, a jump arc, a spawn and a goal flag. */
export function drawLevelSketch(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#f8f9fa';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#adb5bd';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, w - 6, h - 6);
  ctx.strokeStyle = '#1d3557';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  const plat = [
    [0.06, 0.8, 0.22],
    [0.34, 0.62, 0.16],
    [0.56, 0.45, 0.14],
    [0.78, 0.7, 0.16],
  ];
  for (const [x, y, len] of plat) {
    ctx.beginPath();
    ctx.moveTo(x * w, y * h);
    ctx.lineTo((x + len) * w, y * h);
    ctx.stroke();
  }
  ctx.setLineDash([10, 10]);
  ctx.strokeStyle = '#e63946';
  ctx.beginPath();
  ctx.moveTo(0.26 * w, 0.78 * h);
  ctx.quadraticCurveTo(0.33 * w, 0.4 * h, 0.4 * w, 0.6 * h);
  ctx.moveTo(0.48 * w, 0.6 * h);
  ctx.quadraticCurveTo(0.55 * w, 0.25 * h, 0.62 * w, 0.43 * h);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#2a9d8f';
  ctx.fillRect(0.88 * w, 0.48 * h, 4, 0.22 * h);
  ctx.beginPath();
  ctx.moveTo(0.88 * w + 4, 0.48 * h);
  ctx.lineTo(0.94 * w, 0.52 * h);
  ctx.lineTo(0.88 * w + 4, 0.56 * h);
  ctx.fill();
  ctx.fillStyle = '#1d3557';
  ctx.font = `600 ${h * 0.08}px ${SANS}`;
  ctx.textAlign = 'left';
  ctx.fillText('LEVEL 1-1  "first jump"', 0.05 * w, 0.14 * h);
  ctx.font = `500 ${h * 0.06}px ${SANS}`;
  ctx.fillText('spawn →', 0.06 * w, 0.74 * h);
  ctx.fillText('coins here?', 0.55 * w, 0.36 * h);
}

/** A neon sign on a dark backing: a game pad, or "GG". Transparent round it, so only the tubes show. */
export function drawNeon(ctx: CanvasRenderingContext2D, w: number, h: number, kind: 'pad' | 'gg') {
  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const tube = (color: string, draw: () => void) => {
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 24;
    ctx.lineWidth = 12;
    draw();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    draw();
  };
  if (kind === 'gg') {
    ctx.font = `700 ${h * 0.7}px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    tube('#2de2e6', () => ctx.strokeText('GG', w / 2, h / 2));
    return;
  }
  tube('#b14cff', () => {
    ctx.beginPath();
    roundRect(ctx, w * 0.12, h * 0.22, w * 0.76, h * 0.56, h * 0.28);
    ctx.stroke();
  });
  tube('#2de2e6', () => {
    ctx.beginPath();
    ctx.moveTo(w * 0.27, h * 0.5);
    ctx.lineTo(w * 0.37, h * 0.5);
    ctx.moveTo(w * 0.32, h * 0.4);
    ctx.lineTo(w * 0.32, h * 0.6);
    ctx.stroke();
  });
  tube('#ff3cac', () => {
    for (const [x, y] of [
      [0.66, 0.42],
      [0.72, 0.52],
      [0.6, 0.52],
      [0.66, 0.6],
    ]) {
      ctx.beginPath();
      ctx.arc(w * x, h * y, h * 0.035, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

export interface PlaytestPicture {
  name: string;
  live: boolean;
  status: string;
  shot: CanvasImageSource | null;
  progress: { done: number; caption: string };
  use: string;
}

/** The game studio's Playtest screen: the running preview (its latest screenshot) or a title card, and the build bar. */
export function drawPlaytest(ctx: CanvasRenderingContext2D, w: number, h: number, p: PlaytestPicture) {
  ctx.fillStyle = '#0b0820';
  ctx.fillRect(0, 0, w, h);
  const bar = h * 0.17;
  const top = h * 0.12;
  // the header
  ctx.fillStyle = '#1a1035';
  ctx.fillRect(0, 0, w, top);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${top * 0.5}px ${SANS}`;
  ctx.fillText('🎮 PLAYTEST', w * 0.03, top / 2);
  ctx.textAlign = 'right';
  ctx.fillStyle = p.live ? '#7CFFB2' : '#ffd166';
  ctx.font = `600 ${top * 0.4}px ${SANS}`;
  ctx.fillText(p.live ? `● LIVE · press ${p.use} to play` : `○ ${p.status}`, w * 0.97, top / 2);
  // the game
  const gy = top;
  const gh = h - top - bar;
  if (p.live && p.shot) {
    ctx.drawImage(p.shot, 0, gy, w, gh);
  } else {
    const g = ctx.createLinearGradient(0, gy, 0, gy + gh);
    g.addColorStop(0, '#2b1055');
    g.addColorStop(1, '#7597de');
    ctx.fillStyle = g;
    ctx.fillRect(0, gy, w, gh);
    // a pixel skyline and the title
    const r = rng(3);
    ctx.fillStyle = '#120a2a';
    for (let x = 0; x < w; x += w / 24) {
      const bh = gh * (0.12 + r() * 0.3);
      ctx.fillRect(x, gy + gh - bh, w / 24 - 4, bh);
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff3cac';
    ctx.font = `700 ${gh * 0.2}px ${SANS}`;
    ctx.fillText(p.name.toUpperCase(), w / 2 + 4, gy + gh * 0.4 + 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(p.name.toUpperCase(), w / 2, gy + gh * 0.4);
    ctx.font = `500 ${gh * 0.07}px ${SANS}`;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(p.live ? 'running · no screenshot yet' : 'no build running · the preview starts from the app viewer', w / 2, gy + gh * 0.56);
  }
  // the build bar
  const by = h - bar;
  ctx.fillStyle = '#1a1035';
  ctx.fillRect(0, by, w, bar);
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `600 ${bar * 0.28}px ${SANS}`;
  ctx.fillText(`BUILD · ${p.progress.caption}`, w * 0.03, by + bar * 0.3);
  const x0 = w * 0.03;
  const bw = w * 0.94;
  ctx.fillStyle = '#2a2140';
  roundRect(ctx, x0, by + bar * 0.55, bw, bar * 0.28, bar * 0.14);
  ctx.fill();
  const fill = ctx.createLinearGradient(x0, 0, x0 + bw, 0);
  fill.addColorStop(0, '#b14cff');
  fill.addColorStop(1, '#2de2e6');
  ctx.fillStyle = fill;
  roundRect(ctx, x0, by + bar * 0.55, Math.max(bar * 0.28, bw * p.progress.done), bar * 0.28, bar * 0.14);
  ctx.fill();
}

// ---------- trading floor ----------

/** Candlesticks in a box: green up, red down, with a light grid. */
function plotCandles(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, cs: readonly Candle[]) {
  if (!cs.length) return;
  const lo = Math.min(...cs.map((c) => c.low));
  const hi = Math.max(...cs.map((c) => c.high));
  const span = Math.max(1, hi - lo);
  const Y = (v: number) => y + h - ((v - lo) / span) * h;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath();
    ctx.moveTo(x, y + (h * i) / 4);
    ctx.lineTo(x + w, y + (h * i) / 4);
    ctx.stroke();
  }
  const step = w / cs.length;
  cs.forEach((c, i) => {
    const up = c.close >= c.open;
    const cx = x + step * (i + 0.5);
    ctx.strokeStyle = ctx.fillStyle = up ? '#19c37d' : '#ff5c5c';
    ctx.lineWidth = Math.max(1, step * 0.08);
    ctx.beginPath();
    ctx.moveTo(cx, Y(c.high));
    ctx.lineTo(cx, Y(c.low));
    ctx.stroke();
    const top = Y(Math.max(c.open, c.close));
    ctx.fillRect(cx - step * 0.3, top, step * 0.6, Math.max(2, Y(Math.min(c.open, c.close)) - top));
  });
}

/** A made-up price series for decorative charts, seeded so each screen keeps its own. */
function fakeCandles(seed: number, n = 32): Candle[] {
  const r = rng(seed);
  let p = 100;
  return Array.from({ length: n }, () => {
    const open = p;
    const close = open + (r() - 0.45) * 6;
    p = close;
    return { open, close, high: Math.max(open, close) + r() * 2, low: Math.min(open, close) - r() * 2 };
  });
}

/** A wall or desk screen with a symbol's candles. */
export function drawChart(ctx: CanvasRenderingContext2D, w: number, h: number, symbol: string, seed: number) {
  ctx.fillStyle = '#0d1b2a';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#e0e6ef';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `700 ${h * 0.09}px ${MONO}`;
  ctx.fillText(symbol, w * 0.04, h * 0.09);
  const cs = fakeCandles(seed);
  const last = cs[cs.length - 1];
  const up = last.close >= cs[0].open;
  ctx.textAlign = 'right';
  ctx.fillStyle = up ? '#19c37d' : '#ff5c5c';
  ctx.fillText(`${last.close.toFixed(2)} ${up ? '▲' : '▼'}`, w * 0.96, h * 0.09);
  plotCandles(ctx, w * 0.04, h * 0.2, w * 0.92, h * 0.74, cs);
}

/** A news screen: a market headline in the office's own words. */
export function drawNews(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  const heads = ['MERGES RALLY AS QA CLEARS BACKLOG', 'ANALYSTS: SMALL PRS OUTPERFORM', 'CI GREEN FOR 7TH STRAIGHT SESSION', 'AGENTS BULLISH ON REFACTOR'];
  ctx.fillStyle = '#10213a';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#c1121f';
  ctx.fillRect(0, h * 0.72, w * 0.22, h * 0.14);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.font = `700 ${h * 0.08}px ${SANS}`;
  ctx.fillText('LIVE', w * 0.11, h * 0.79);
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(w * 0.22, h * 0.72, w * 0.78, h * 0.14);
  ctx.fillStyle = '#0d1b2a';
  ctx.textAlign = 'left';
  ctx.font = `700 ${h * 0.075}px ${SANS}`;
  ctx.fillText(heads[seed % heads.length], w * 0.25, h * 0.79);
  plotCandles(ctx, w * 0.06, h * 0.1, w * 0.88, h * 0.55, fakeCandles(seed + 11, 24));
  ctx.fillStyle = '#7aa6d8';
  ctx.fillRect(0, h * 0.86, w, h * 0.14);
  ctx.fillStyle = '#0d1b2a';
  ctx.font = `600 ${h * 0.07}px ${MONO}`;
  ctx.fillText('CFRM +2.1%   QA +0.8%   CI −0.2%   SHIP +4.0%', w * 0.03, h * 0.93);
}

/** The ticker's strip: every quote, then again, so it scrolls round seamlessly. */
export function drawTickerStrip(ctx: CanvasRenderingContext2D, w: number, h: number, quotes: readonly Quote[], label: string) {
  ctx.fillStyle = '#05070d';
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `700 ${h * 0.56}px ${MONO}`;
  let x = h * 0.4;
  const half = w / 2;
  for (let pass = 0; pass < 2; pass++) {
    x = pass * half + h * 0.4;
    ctx.fillStyle = '#ffd166';
    ctx.fillText(label, x, h / 2);
    x += ctx.measureText(label).width + h;
    for (const q of quotes) {
      ctx.fillStyle = '#e0e6ef';
      ctx.fillText(q.symbol, x, h / 2);
      x += ctx.measureText(q.symbol).width + h * 0.3;
      const arrow = q.dir === 'up' ? '▲' : q.dir === 'down' ? '▼' : '■';
      ctx.fillStyle = q.dir === 'flat' ? '#9aa5b1' : q.good ? '#19c37d' : '#ff5c5c';
      const t = `${q.text} ${arrow}`;
      ctx.fillText(t, x, h / 2);
      x += ctx.measureText(t).width + h * 0.9;
      if (x > (pass + 1) * half - h * 2) break;
    }
  }
}

/** The market board: the floor's merges per hour over 24 hours as candles, and whether the market is open. */
export function drawMarket(ctx: CanvasRenderingContext2D, w: number, h: number, p: { floor: number; name: string; candles: readonly Candle[]; open: boolean; merged: number }) {
  ctx.fillStyle = '#0d1b2a';
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e0e6ef';
  ctx.font = `700 ${h * 0.075}px ${SANS}`;
  ctx.fillText(`FLOOR ${p.floor} · ${p.name.toUpperCase()}`, w * 0.03, h * 0.08);
  ctx.textAlign = 'right';
  ctx.fillStyle = p.open ? '#19c37d' : '#ff5c5c';
  ctx.fillText(p.open ? '● MARKET OPEN' : '● MARKET CLOSED', w * 0.97, h * 0.08);
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(224,230,239,0.7)';
  ctx.font = `500 ${h * 0.05}px ${SANS}`;
  ctx.fillText(`merges per hour, last 24h · ${p.merged} today`, w * 0.03, h * 0.17);
  plotCandles(ctx, w * 0.03, h * 0.24, w * 0.94, h * 0.7, p.candles);
}

/** The world clocks' row: an analog face per city with its name under it. */
export function drawClocks(ctx: CanvasRenderingContext2D, w: number, h: number, clocks: readonly { city: string; h: number; m: number }[]) {
  ctx.clearRect(0, 0, w, h);
  const cw = w / clocks.length;
  const r = Math.min(cw * 0.32, h * 0.34);
  clocks.forEach((c, i) => {
    const cx = cw * (i + 0.5);
    const cy = r + 6;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1f3b5c';
    ctx.lineWidth = r * 0.12;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const hand = (turns: number, len: number, width: number) => {
      const a = turns * Math.PI * 2 - Math.PI / 2;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      ctx.stroke();
    };
    hand(((c.h % 12) + c.m / 60) / 12, r * 0.5, r * 0.11);
    hand(c.m / 60, r * 0.78, r * 0.07);
    ctx.fillStyle = '#1f3b5c';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${h * 0.14}px ${SANS}`;
    ctx.fillText(c.city, cx, h - h * 0.12);
  });
}

/** The title card's blinking "PRESS START". */
export function drawPressStart(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#ffd166';
  ctx.font = `700 44px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('PRESS START', 256, 32);
}
