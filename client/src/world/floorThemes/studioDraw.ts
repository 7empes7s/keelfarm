// The second batch of floor themes' pictures (#371), drawn on canvases like themeDraw.ts: the design studio's mood
// boards, swatches, prints, canvas and gallery; the media studio's posters, waveforms, timelines, ON AIR sign and
// content calendar; the research lab's equations, network diagram, plots and loss curve; the ops room's network map,
// runbook, dashboards, status wall tiles and clock. Plain 2D canvas calls, so the paint worker can record them.

import { roundRect, SANS } from '../draw';
import type { CalendarDay, Level, NocFloor, NocSystem } from './liveScreens';

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const PASTEL = ['#ff8fab', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff'];
const LEVEL_COLOR: Record<Level, string> = { ok: '#22e39b', warn: '#ffc145', alert: '#ff4d4d' };

/** A seeded little random, so every picture is the same each time it's drawn. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ---------- design studio ----------

/** A cork board with pinned swatches, photos and sticky notes. */
export function drawMoodBoard(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  ctx.fillStyle = '#c99a6b';
  ctx.fillRect(0, 0, w, h);
  const r = rng(seed);
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = r() < 0.5 ? 'rgba(90,50,20,0.18)' : 'rgba(255,240,210,0.15)';
    ctx.fillRect(r() * w, r() * h, 2, 2);
  }
  ctx.strokeStyle = '#8a6240';
  ctx.lineWidth = 12;
  ctx.strokeRect(6, 6, w - 12, h - 12);
  for (let i = 0; i < 11; i++) {
    const x = 30 + r() * (w - 150);
    const y = 26 + r() * (h - 140);
    const pw = 70 + r() * 60;
    const ph = 60 + r() * 50;
    ctx.save();
    ctx.translate(x + pw / 2, y + ph / 2);
    ctx.rotate((r() - 0.5) * 0.3);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(-pw / 2 + 4, -ph / 2 + 5, pw, ph);
    ctx.fillStyle = i % 3 === 0 ? '#fffdf7' : PASTEL[i % PASTEL.length];
    ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
    if (i % 3 === 0) {
      // a photo: a little landscape
      ctx.fillStyle = PASTEL[(i + 3) % PASTEL.length];
      ctx.fillRect(-pw / 2 + 6, -ph / 2 + 6, pw - 12, ph - 22);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(pw / 4, -ph / 4, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = ['#e63946', '#3a86ff', '#ffbe0b'][i % 3];
    ctx.beginPath();
    ctx.arc(0, -ph / 2 + 6, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** A strip of paint chips with their names. */
export function drawSwatchStrip(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#fbfaf7';
  ctx.fillRect(0, 0, w, h);
  const names = ['Blush', 'Peach', 'Butter', 'Mint', 'Sky', 'Cornflower', 'Lilac', 'Orchid'];
  const cw = w / PASTEL.length;
  PASTEL.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(i * cw + 6, 8, cw - 12, h * 0.68);
    ctx.fillStyle = '#4a4a4a';
    ctx.font = `600 ${Math.round(h * 0.11)}px ${SANS}`;
    ctx.fillText(names[i], i * cw + 10, h * 0.86);
    ctx.font = `500 ${Math.round(h * 0.08)}px ${MONO}`;
    ctx.fillStyle = '#8a8a8a';
    ctx.fillText(c.toUpperCase(), i * cw + 10, h * 0.96);
  });
}

/** A framed print of soft geometric shapes. */
export function drawArtPrint(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  ctx.fillStyle = '#e3c08d';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fbf6ee';
  ctx.fillRect(18, 18, w - 36, h - 36);
  const r = rng(seed);
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = PASTEL[Math.floor(r() * PASTEL.length)];
    const x = 50 + r() * (w - 140);
    const y = 50 + r() * (h - 140);
    const s = 50 + r() * 90;
    ctx.beginPath();
    if (i % 3 === 0) ctx.arc(x, y, s / 2, 0, Math.PI * 2);
    else if (i % 3 === 1) ctx.rect(x - s / 2, y - s / 3, s, (s * 2) / 3);
    else {
      ctx.moveTo(x, y - s / 2);
      ctx.lineTo(x + s / 2, y + s / 2);
      ctx.lineTo(x - s / 2, y + s / 2);
    }
    ctx.fill();
  }
}

/** An easel's canvas: a pastel sunset half painted. */
export function drawEaselCanvas(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#ffc6ff');
  g.addColorStop(0.55, '#ffd6a5');
  g.addColorStop(0.56, '#a0c4ff');
  g.addColorStop(1, '#bdb2ff');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h * 0.7);
  ctx.fillStyle = '#fbfaf7';
  ctx.fillRect(0, h * 0.7, w, h * 0.3);
  ctx.fillStyle = '#ff8fab';
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.5, w * 0.16, Math.PI, 0);
  ctx.fill();
  ctx.strokeStyle = '#a0c4ff';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(10, h * 0.78);
  ctx.quadraticCurveTo(w / 2, h * 0.7, w * 0.7, h * 0.8);
  ctx.stroke();
}

/** A desk's second monitor in the design studio: a design tool's canvas with frames, layers and a palette. */
export function drawCanvasTool(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#f2f2f5';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w * 0.2, h);
  ctx.fillRect(w * 0.8, 0, w * 0.2, h);
  ctx.fillStyle = '#d0d0d8';
  for (let i = 0; i < 7; i++) ctx.fillRect(8, 16 + i * 26, w * 0.2 - 16, 10);
  const fx = w * 0.27;
  for (let i = 0; i < 3; i++) {
    const x = fx + i * w * 0.18;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, h * 0.18, w * 0.15, h * 0.62);
    ctx.fillStyle = PASTEL[i * 2];
    ctx.fillRect(x + 6, h * 0.22, w * 0.15 - 12, h * 0.2);
    ctx.fillStyle = '#d0d0d8';
    ctx.fillRect(x + 6, h * 0.48, w * 0.1, 8);
    ctx.fillRect(x + 6, h * 0.55, w * 0.12, 8);
    ctx.fillStyle = '#7b61ff';
    roundRect(ctx, x + 6, h * 0.68, w * 0.08, 16, 6);
    ctx.fill();
  }
  ctx.strokeStyle = '#7b61ff';
  ctx.lineWidth = 2;
  ctx.strokeRect(fx + w * 0.18 - 2, h * 0.18 - 2, w * 0.15 + 4, h * 0.62 + 4);
  PASTEL.slice(0, 6).forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(w * 0.82 + (i % 2) * 30, 20 + Math.floor(i / 2) * 30, 24, 24);
  });
}

export interface GalleryPicture {
  name: string;
  shot: CanvasImageSource | null;
  caption: string;
  index: number;
  total: number;
}

/** The design studio's wall: the floor's latest screenshots, one at a time in a gallery frame. */
export function drawGallery(ctx: CanvasRenderingContext2D, w: number, h: number, p: GalleryPicture) {
  ctx.fillStyle = '#fbf6ee';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#3a3a3a';
  ctx.font = `700 34px ${SANS}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(`🎨 ${clip(p.name, 28)} · Gallery`, 32, 40);
  const fx = 32;
  const fy = 80;
  const fw = w - 64;
  const fh = h - 150;
  ctx.fillStyle = '#e3c08d';
  ctx.fillRect(fx - 10, fy - 10, fw + 20, fh + 20);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(fx, fy, fw, fh);
  if (p.shot) {
    const iw = (p.shot as HTMLImageElement).width || fw;
    const ih = (p.shot as HTMLImageElement).height || fh;
    const s = Math.min(fw / iw, fh / ih);
    ctx.drawImage(p.shot, fx + (fw - iw * s) / 2, fy + (fh - ih * s) / 2, iw * s, ih * s);
  } else {
    PASTEL.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(fx + (i * fw) / PASTEL.length, fy, fw / PASTEL.length, fh);
    });
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    roundRect(ctx, fx + fw / 2 - 300, fy + fh / 2 - 44, 600, 88, 20);
    ctx.fill();
    ctx.fillStyle = '#3a3a3a';
    ctx.font = `600 30px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText('No screenshots yet', fx + fw / 2, fy + fh / 2);
    ctx.textAlign = 'left';
  }
  ctx.fillStyle = '#5a5a5a';
  ctx.font = `500 26px ${SANS}`;
  ctx.fillText(clip(p.caption, 54), 32, h - 34);
  for (let i = 0; i < p.total; i++) {
    ctx.fillStyle = i === p.index ? '#ff8fab' : '#d8cfc4';
    ctx.beginPath();
    ctx.arc(w - 40 - (p.total - 1 - i) * 26, h - 34, 8, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------- media studio ----------

/** Three film posters in a row. */
export function drawFilmPosters(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const titles = ['MERGE DAY', 'THE BUILD', 'GREEN CHECK'];
  const bg = ['#ff4d6d', '#3a0ca3', '#ffb703'];
  const pw = w / 3;
  titles.forEach((t, i) => {
    const x = i * pw + 10;
    ctx.fillStyle = bg[i];
    ctx.fillRect(x, 8, pw - 20, h - 16);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.arc(x + (pw - 20) / 2, h * 0.42, pw * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${Math.round(pw * 0.11)}px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText(t, x + (pw - 20) / 2, h * 0.8);
    ctx.font = `500 ${Math.round(pw * 0.05)}px ${SANS}`;
    ctx.fillText('NOW STREAMING', x + (pw - 20) / 2, h * 0.9);
    ctx.textAlign = 'left';
  });
}

/** An audio waveform on a dark screen, with a playhead. */
export function drawWaveform(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  ctx.fillStyle = '#121318';
  ctx.fillRect(0, 0, w, h);
  const r = rng(seed);
  for (let ch = 0; ch < 2; ch++) {
    const mid = h * (0.3 + ch * 0.4);
    ctx.fillStyle = ch ? '#4cc9f0' : '#ff4d6d';
    for (let x = 0; x < w; x += 3) {
      const a = (0.2 + 0.8 * Math.abs(Math.sin(x * 0.02 + seed))) * r() * h * 0.16;
      ctx.fillRect(x, mid - a, 2, a * 2);
    }
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(w * 0.62, 0, 2, h);
}

/** A cork board of shot cards: scene, take and a little storyboard frame. */
export function drawShotList(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#26272e';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 6; i++) {
    const x = 16 + (i % 3) * ((w - 32) / 3);
    const y = 16 + Math.floor(i / 3) * ((h - 32) / 2);
    const cw = (w - 32) / 3 - 14;
    const ch = (h - 32) / 2 - 14;
    ctx.fillStyle = '#fbfaf7';
    ctx.fillRect(x, y, cw, ch);
    ctx.strokeStyle = '#26272e';
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 10, y + 34, cw - 20, ch - 48);
    ctx.beginPath();
    ctx.moveTo(x + 10 + (cw - 20) * 0.2, y + ch - 14);
    ctx.lineTo(x + 10 + (cw - 20) * 0.5, y + 34 + (ch - 48) * 0.3);
    ctx.lineTo(x + 10 + (cw - 20) * 0.8, y + ch - 14);
    ctx.stroke();
    ctx.fillStyle = '#26272e';
    ctx.font = `700 ${Math.round(ch * 0.13)}px ${MONO}`;
    ctx.fillText(`SC ${i + 1} · TK ${(i % 3) + 1}`, x + 10, y + 22);
  }
}

/** A desk's monitor in the media studio: an editor's timeline with video and audio tracks. */
export function drawTimeline(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#1c1d23';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#0d0e12';
  ctx.fillRect(w * 0.25, 8, w * 0.5, h * 0.42);
  ctx.fillStyle = '#ff8fab';
  ctx.fillRect(w * 0.25, 8 + h * 0.28, w * 0.5, h * 0.14);
  ctx.fillStyle = '#ffd166';
  ctx.beginPath();
  ctx.arc(w * 0.6, 8 + h * 0.14, h * 0.07, 0, Math.PI * 2);
  ctx.fill();
  const r = rng(11);
  const tracks = ['#7b61ff', '#4cc9f0', '#22c55e', '#22c55e'];
  tracks.forEach((c, t) => {
    const y = h * 0.55 + t * h * 0.1;
    let x = 4;
    while (x < w - 10) {
      const cw = 30 + r() * 90;
      ctx.fillStyle = c;
      roundRect(ctx, x, y, Math.min(cw, w - 6 - x), h * 0.08, 3);
      ctx.fill();
      x += cw + 4 + r() * 20;
    }
  });
  ctx.fillStyle = '#ff4d6d';
  ctx.fillRect(w * 0.42, h * 0.52, 2, h * 0.46);
}

/** The ON AIR sign: red and lit while anyone on the floor works, dark otherwise. */
export function drawOnAir(ctx: CanvasRenderingContext2D, w: number, h: number, lit: boolean) {
  ctx.clearRect(0, 0, w, h);
  roundRect(ctx, 4, 4, w - 8, h - 8, h * 0.2);
  ctx.fillStyle = lit ? '#e5132e' : '#3a1b20';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = lit ? '#ff9aa8' : '#5a2a32';
  ctx.stroke();
  ctx.fillStyle = lit ? '#ffffff' : '#7a4a52';
  ctx.font = `900 ${Math.round(h * 0.55)}px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ON AIR', w / 2, h / 2 + 2);
  ctx.textAlign = 'left';
}

/** The media studio's wall screen: the floor's open issues as a week's content calendar. */
export function drawCalendar(ctx: CanvasRenderingContext2D, w: number, h: number, p: { name: string; days: readonly CalendarDay[]; later: number }) {
  ctx.fillStyle = '#17181e';
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 34px ${SANS}`;
  ctx.fillText(`🎬 ${clip(p.name, 24)} · Content calendar`, 26, 38);
  if (p.later) {
    ctx.fillStyle = '#a0a3b1';
    ctx.font = `500 24px ${SANS}`;
    ctx.textAlign = 'right';
    ctx.fillText(`+${p.later} later`, w - 26, 38);
    ctx.textAlign = 'left';
  }
  const top = 76;
  const cw = (w - 52) / p.days.length;
  const tags = ['#ff4d6d', '#7b61ff', '#4cc9f0', '#ffb703', '#22c55e'];
  p.days.forEach((d, i) => {
    const x = 26 + i * cw;
    ctx.fillStyle = d.today ? '#2a1d24' : '#1f2028';
    roundRect(ctx, x + 4, top, cw - 8, h - top - 18, 14);
    ctx.fill();
    ctx.fillStyle = d.today ? '#ff4d6d' : '#a0a3b1';
    ctx.font = `700 22px ${SANS}`;
    ctx.fillText(d.today ? `TODAY · ${d.label}` : d.label, x + 16, top + 24);
    if (!d.items.length && i === 0) {
      ctx.fillStyle = '#6b6e7c';
      ctx.font = `500 20px ${SANS}`;
      ctx.fillText('Nothing on the slate', x + 16, top + 70);
    }
    d.items.slice(0, 4).forEach((it, j) => {
      const y = top + 48 + j * 104;
      ctx.fillStyle = '#2b2d38';
      roundRect(ctx, x + 12, y, cw - 24, 92, 10);
      ctx.fill();
      ctx.fillStyle = it.live ? '#ff4d6d' : tags[it.number % tags.length];
      ctx.fillRect(x + 12, y, 6, 92);
      ctx.fillStyle = it.live ? '#ff4d6d' : '#a0a3b1';
      ctx.font = `700 18px ${SANS}`;
      ctx.fillText(it.live ? `● LIVE  #${it.number}` : `#${it.number}`, x + 26, y + 20);
      ctx.fillStyle = '#ffffff';
      ctx.font = `600 19px ${SANS}`;
      const words = it.title.split(' ');
      const lines: string[] = [''];
      for (const word of words) {
        const next = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${word}` : word;
        if (ctx.measureText(next).width > cw - 44 && lines[lines.length - 1]) {
          if (lines.length === 2) break;
          lines.push(word);
        } else lines[lines.length - 1] = next;
      }
      lines.forEach((l, k) => ctx.fillText(clip(l, 22), x + 26, y + 46 + k * 24));
    });
  });
}

// ---------- research lab ----------

const EQUATIONS = ['∇L(θ) = 1/N Σ ∂ℓ/∂θ', 'θ ← θ − η ∇L', 'softmax(z)ᵢ = eᶻⁱ / Σ eᶻʲ', 'Attn = softmax(QKᵀ/√d)V', 'p(y|x) ∝ p(x|y)p(y)', 'H(p,q) = −Σ p log q', 'σ(x) = 1/(1+e⁻ˣ)', 'E[X] = Σ x p(x)'];

/** A whiteboard of equations in marker, with a doodled plot. */
export function drawEquations(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  ctx.fillStyle = '#f7f9fc';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#c3ccd8';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, w - 10, h - 10);
  const r = rng(seed);
  const inks = ['#1d4ed8', '#111827', '#dc2626', '#15803d'];
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = inks[i % inks.length];
    ctx.font = `600 ${Math.round(h * 0.075)}px "Comic Sans MS", "Segoe Print", ${SANS}`;
    ctx.fillText(EQUATIONS[(seed + i * 3) % EQUATIONS.length], 24 + r() * 30, 50 + i * h * 0.17);
  }
  ctx.strokeStyle = '#dc2626';
  ctx.lineWidth = 4;
  ctx.beginPath();
  const ox = w * 0.66;
  const oy = h * 0.85;
  ctx.moveTo(ox, h * 0.25);
  ctx.lineTo(ox, oy);
  ctx.lineTo(w - 24, oy);
  ctx.stroke();
  ctx.strokeStyle = '#1d4ed8';
  ctx.beginPath();
  for (let x = 0; x <= 1; x += 0.05) ctx.lineTo(ox + x * (w - 30 - ox), oy - (h * 0.55) / (1 + x * 6));
  ctx.stroke();
}

/** A poster of a neural network: layers of nodes and their links. */
export function drawNetDiagram(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#0f1b33';
  ctx.fillRect(0, 0, w, h);
  const layers = [4, 6, 6, 3];
  const pos = layers.map((n, l) => Array.from({ length: n }, (_, i) => [60 + (l * (w - 120)) / (layers.length - 1), h * 0.15 + ((i + 0.5) * h * 0.7) / n] as const));
  ctx.strokeStyle = 'rgba(125,180,255,0.35)';
  ctx.lineWidth = 1.5;
  for (let l = 0; l < pos.length - 1; l++)
    for (const a of pos[l])
      for (const b of pos[l + 1]) {
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
  pos.flat().forEach(([x, y], i) => {
    ctx.fillStyle = ['#3d8bff', '#7affc8', '#ffd166'][i % 3];
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = '#d8e6ff';
  ctx.font = `700 ${Math.round(h * 0.07)}px ${MONO}`;
  ctx.fillText('model v7 · 4-6-6-3', 20, h - 20);
}

/** A desk's monitor in the lab: a terminal of training steps and a small curve. */
export function drawPlots(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, w, h);
  ctx.font = `500 13px ${MONO}`;
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = i === 8 ? '#7affc8' : '#7ea2d6';
    ctx.fillText(`step ${(i + 1) * 500}  loss ${(1.8 / (1 + i * 0.6)).toFixed(3)}`, 10, 20 + i * 16);
  }
  const x0 = w * 0.58;
  ctx.strokeStyle = '#3d8bff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let x = 0; x <= 1; x += 0.04) ctx.lineTo(x0 + x * (w - x0 - 12), 20 + (h - 50) / (1 + x * 5));
  ctx.stroke();
}

/** The research lab's wall screen: the floor's QA pass rate over a week, drawn as a training run's falling loss. */
export function drawLoss(ctx: CanvasRenderingContext2D, w: number, h: number, p: { name: string; points: readonly { day: number; loss: number }[]; pass: number | null; days: readonly string[] }) {
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#d8e6ff';
  ctx.font = `700 32px ${SANS}`;
  ctx.fillText(`🔬 ${clip(p.name, 24)} · QA loss`, 28, 38);
  ctx.textAlign = 'right';
  ctx.fillStyle = p.pass === null ? '#7ea2d6' : '#7affc8';
  ctx.font = `700 30px ${MONO}`;
  ctx.fillText(p.pass === null ? 'no QA rounds yet' : `pass ${Math.round(p.pass * 100)}%`, w - 28, 38);
  ctx.textAlign = 'left';
  const L = 90;
  const R = w - 40;
  const T = 84;
  const B = h - 70;
  ctx.strokeStyle = 'rgba(125,162,214,0.25)';
  ctx.lineWidth = 1;
  ctx.font = `500 20px ${MONO}`;
  ctx.fillStyle = '#7ea2d6';
  for (let i = 0; i <= 4; i++) {
    const y = T + ((B - T) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(L, y);
    ctx.lineTo(R, y);
    ctx.stroke();
    ctx.fillText((1 - i / 4).toFixed(2), 20, y);
  }
  p.days.forEach((d, i) => {
    ctx.fillText(d, L + ((R - L) * i) / 6 - 18, B + 30);
  });
  ctx.fillStyle = '#7ea2d6';
  ctx.font = `500 18px ${SANS}`;
  ctx.fillText('loss = 1 − QA pass rate, per day', L, h - 18);
  if (!p.points.length) return;
  const at = (q: { day: number; loss: number }) => [L + ((R - L) * q.day) / 6, B - (B - T) * q.loss] as const;
  const g = ctx.createLinearGradient(0, T, 0, B);
  g.addColorStop(0, 'rgba(61,139,255,0.35)');
  g.addColorStop(1, 'rgba(61,139,255,0)');
  ctx.beginPath();
  p.points.forEach((q, i) => (i ? ctx.lineTo(...at(q)) : ctx.moveTo(...at(q))));
  ctx.lineTo(at(p.points[p.points.length - 1])[0], B);
  ctx.lineTo(at(p.points[0])[0], B);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = '#3d8bff';
  ctx.lineWidth = 5;
  ctx.beginPath();
  p.points.forEach((q, i) => (i ? ctx.lineTo(...at(q)) : ctx.moveTo(...at(q))));
  ctx.stroke();
  for (const q of p.points) {
    ctx.fillStyle = '#7affc8';
    ctx.beginPath();
    ctx.arc(...at(q), 7, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------- ops control room ----------

/** A map of the network: sites, links and their status lights. */
export function drawNetworkMap(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  ctx.fillStyle = '#0b1018';
  ctx.fillRect(0, 0, w, h);
  const r = rng(seed);
  const sites = Array.from({ length: 9 }, () => [30 + r() * (w - 60), 30 + r() * (h - 60)] as const);
  ctx.strokeStyle = 'rgba(34,227,155,0.45)';
  ctx.lineWidth = 2;
  sites.forEach((a, i) => {
    const b = sites[(i + 1) % sites.length];
    const c = sites[(i + 4) % sites.length];
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.stroke();
  });
  sites.forEach(([x, y], i) => {
    ctx.fillStyle = i === 4 ? '#ffc145' : '#22e39b';
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** A printed runbook poster: steps for an incident. */
export function drawRunbook(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#f4f1e8';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#c1121f';
  ctx.fillRect(0, 0, w, h * 0.2);
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 ${Math.round(h * 0.11)}px ${SANS}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('INCIDENT RUNBOOK', 20, h * 0.1);
  const steps = ['1. Breathe', '2. Check the status wall', '3. Read the logs', '4. Roll back first', '5. Write it up'];
  ctx.fillStyle = '#1f2937';
  ctx.font = `600 ${Math.round(h * 0.085)}px ${SANS}`;
  steps.forEach((s, i) => ctx.fillText(s, 24, h * (0.32 + i * 0.14)));
}

/** A desk's monitor in the ops room: little graphs and a log tail. */
export function drawDashboards(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#0b1018';
  ctx.fillRect(0, 0, w, h);
  const r = rng(5);
  for (let p = 0; p < 4; p++) {
    const x = 8 + (p % 2) * (w / 2);
    const y = 8 + Math.floor(p / 2) * (h / 2);
    ctx.strokeStyle = '#1f2a38';
    ctx.strokeRect(x, y, w / 2 - 16, h / 2 - 16);
    ctx.strokeStyle = ['#22e39b', '#3d8bff', '#ffc145', '#22e39b'][p];
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 20; i++) ctx.lineTo(x + 4 + (i * (w / 2 - 24)) / 20, y + h / 2 - 24 - r() * (h / 2 - 40));
    ctx.stroke();
  }
}

/** One floor's tile on the status wall: its preview, its PRs' checks and needs-human count, edged in its level. */
export function drawNocFloor(ctx: CanvasRenderingContext2D, w: number, h: number, f: NocFloor | null) {
  ctx.fillStyle = '#0b1018';
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  if (!f) {
    ctx.fillStyle = '#3d4a5c';
    ctx.font = `600 ${Math.round(h * 0.09)}px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText('— no floor —', w / 2, h / 2);
    ctx.textAlign = 'left';
    return;
  }
  const c = LEVEL_COLOR[f.level];
  ctx.strokeStyle = c;
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, w - 8, h - 8);
  ctx.fillStyle = c;
  ctx.font = `800 ${Math.round(h * 0.13)}px ${SANS}`;
  ctx.fillText(`F${f.floor} ${clip(f.name, 14).toUpperCase()}`, 20, h * 0.15);
  const rows: [string, string, string][] = [
    ['PREVIEW', f.preview.toUpperCase(), f.preview === 'error' ? LEVEL_COLOR.alert : f.preview === 'running' ? LEVEL_COLOR.ok : '#a8b3c4'],
    ['CHECKS', `✓${f.checks.passing}  ✗${f.checks.failing}  …${f.checks.pending}`, f.checks.failing ? LEVEL_COLOR.warn : '#a8b3c4'],
    ['NEEDS HUMAN', String(f.needsHuman), f.needsHuman ? LEVEL_COLOR.alert : '#a8b3c4'],
  ];
  rows.forEach(([k, v, col], i) => {
    const y = h * (0.38 + i * 0.2);
    ctx.fillStyle = '#5d6b80';
    ctx.font = `600 ${Math.round(h * 0.075)}px ${MONO}`;
    ctx.fillText(k, 20, y);
    ctx.fillStyle = col;
    ctx.font = `700 ${Math.round(h * 0.1)}px ${MONO}`;
    ctx.textAlign = 'right';
    ctx.fillText(v, w - 20, y);
    ctx.textAlign = 'left';
  });
}

/** The office's machine on the status wall: memory in use, the tightest disk's free space and sessions running. */
export function drawNocSystem(ctx: CanvasRenderingContext2D, w: number, h: number, s: NocSystem) {
  ctx.fillStyle = '#0b1018';
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  const c = LEVEL_COLOR[s.level];
  ctx.strokeStyle = c;
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, w - 8, h - 8);
  ctx.fillStyle = c;
  ctx.font = `800 ${Math.round(h * 0.13)}px ${SANS}`;
  ctx.fillText('OFFICE HOST', 20, h * 0.15);
  const bar = (y: number, label: string, pct: number | null, text: string) => {
    ctx.fillStyle = '#5d6b80';
    ctx.font = `600 ${Math.round(h * 0.075)}px ${MONO}`;
    ctx.fillText(label, 20, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#e6edf7';
    ctx.font = `700 ${Math.round(h * 0.09)}px ${MONO}`;
    ctx.fillText(text, w - 20, y);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#1f2a38';
    ctx.fillRect(20, y + h * 0.07, w - 40, h * 0.04);
    if (pct !== null) {
      ctx.fillStyle = pct >= 92 ? LEVEL_COLOR.alert : pct >= 80 ? LEVEL_COLOR.warn : LEVEL_COLOR.ok;
      ctx.fillRect(20, y + h * 0.07, ((w - 40) * Math.min(100, pct)) / 100, h * 0.04);
    }
  };
  bar(h * 0.36, 'MEMORY', s.memoryPct, s.memoryPct === null ? '—' : `${s.memoryPct}%`);
  ctx.fillStyle = '#5d6b80';
  ctx.font = `600 ${Math.round(h * 0.075)}px ${MONO}`;
  ctx.fillText('DISK FREE', 20, h * 0.62);
  ctx.fillText('SESSIONS', 20, h * 0.8);
  ctx.textAlign = 'right';
  ctx.fillStyle = s.diskLevel === 'hold' ? LEVEL_COLOR.alert : s.diskLevel === 'warn' ? LEVEL_COLOR.warn : '#e6edf7';
  ctx.font = `700 ${Math.round(h * 0.09)}px ${MONO}`;
  ctx.fillText(s.diskFreeGb === null ? '—' : `${s.diskFreeGb.toFixed(1)} GB`, w - 20, h * 0.62);
  ctx.fillStyle = '#e6edf7';
  ctx.fillText(String(s.running), w - 20, h * 0.8);
  ctx.textAlign = 'left';
}

/** The big status clock: the time in seven-segment style, in the office's overall level's colour, and a caption. */
export function drawStatusClock(ctx: CanvasRenderingContext2D, w: number, h: number, p: { h: number; m: number; level: Level; caption: string }) {
  ctx.fillStyle = '#05080d';
  roundRect(ctx, 0, 0, w, h, 18);
  ctx.fill();
  const c = LEVEL_COLOR[p.level];
  ctx.fillStyle = c;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(h * 0.6)}px ${MONO}`;
  ctx.fillText(`${String(p.h).padStart(2, '0')}:${String(p.m).padStart(2, '0')}`, w * 0.36, h * 0.48);
  ctx.font = `800 ${Math.round(h * 0.2)}px ${SANS}`;
  ctx.fillText(p.caption, w * 0.8, h * 0.48);
  ctx.textAlign = 'left';
}
