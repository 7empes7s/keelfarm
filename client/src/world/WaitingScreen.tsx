import { useEffect, useMemo, useState } from 'react';
import type * as THREE from 'three';
import { useStore } from '../store';
import { useKeyName } from '../ui/controls';
import { roundRect, SANS, wrap } from './draw';
import { useCanvasTexture, useInteractable } from './interact';
import { MANAGER_SCREEN } from './layout';
import { Box } from './Toon';
import { calmLine, waitingTarget, waitingTotal, waitingWall, wallRows, type WaitingWall } from './waitingWall';

// The manager office's "Waiting on you" screen (#326) on the west wall, where the bookshelf stood: what waits on the
// manager, in numbers big enough to read from the door. E/click opens where to act on it (waitingWall.ts).

const { at: AT, w: W, h: H } = MANAGER_SCREEN;
const PX: [number, number] = [1040, 600];

function drawScreen(ctx: CanvasRenderingContext2D, s: WaitingWall, use: string) {
  const [w, h] = PX;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#20224a');
  g.addColorStop(1, '#2b1d3f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  const total = waitingTotal(s);
  ctx.fillStyle = '#ffd6a5';
  ctx.font = `700 60px ${SANS}`;
  ctx.fillText('Waiting on you', 44, 66);
  const rows = wallRows(s);
  if (!rows.length) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#7CFFB2';
    ctx.font = `700 68px ${SANS}`;
    ctx.fillText('Nothing waiting on you', w / 2, 270);
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 46px ${SANS}`;
    ctx.fillText(calmLine(s.mergedToday), w / 2, 370);
    ctx.textAlign = 'left';
  } else {
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ff8fa3';
    ctx.font = `700 84px ${SANS}`;
    ctx.fillText(`${total}`, w - 44, 66);
    ctx.textAlign = 'left';
    let y = 136;
    for (const r of rows) {
      const rowH = 60 + r.details.length * 36;
      roundRect(ctx, 36, y, w - 72, rowH - 8, 16);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 52px ${SANS}`;
      ctx.fillText(`${r.value}`, 60, y + 28);
      ctx.fillStyle = '#e4e4f7';
      ctx.font = `600 40px ${SANS}`;
      ctx.fillText(r.label, 150, y + 28);
      ctx.fillStyle = '#c9c9ee';
      ctx.font = `500 30px ${SANS}`;
      r.details.forEach((l, i) => ctx.fillText(wrap(ctx, l, w - 210, 1)[0] ?? '', 150, y + 68 + i * 36));
      y += rowH;
    }
  }
  ctx.fillStyle = '#7CFFB2';
  ctx.font = `600 30px ${SANS}`;
  ctx.fillText(`Press ${use} or click to see what's waiting on you`, 44, h - 34);
}

/** The minute, so a snoozed decision comes back on the screen when its snooze ends. */
function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function WaitingScreen() {
  const use = useKeyName('interact');
  const decisions = useStore((s) => s.decisions);
  const requests = useStore((s) => s.requests);
  const repos = useStore((s) => s.repos);
  const qa = useStore((s) => s.qa);
  const agents = useStore((s) => s.agents);
  const mergedToday = useStore((s) => s.ops.total.mergedToday);
  const now = useMinuteClock();
  const wall = useMemo(() => waitingWall({ decisions, requests, repos, qa, agents, mergedToday }, now), [decisions, requests, repos, qa, agents, mergedToday, now]);
  const target = waitingTarget(wall);
  // the id carries the target: an interactable re-registers only when its id or label changes
  const ref = useInteractable<THREE.Group>({ id: `waiting-screen:${target.kind}:${'tab' in target ? target.tab : ''}`, label: "See what's waiting on you", action: target }, 4);
  const tex = useCanvasTexture(PX[0], PX[1], (ctx) => drawScreen(ctx, wall, use), [JSON.stringify(wall), use]);
  return (
    <group ref={ref} position={AT} rotation={[0, Math.PI / 2, 0]}>
      <Box size={[W + 0.14, H + 0.14, 0.06]} position={[0, 0, -0.04]} color="#2b2d42" outline shadow={false} />
      <mesh position={[0, 0, 0.002]}>
        <planeGeometry args={[W, H]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  );
}
