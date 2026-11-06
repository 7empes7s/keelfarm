import type * as THREE from 'three';
import { useStore } from '../store';
import { TEST_LAB_SECTION } from '../ui/consoleNav';
import { useKeyName } from '../ui/controls';
import { roundRect, SANS, wrap } from './draw';
import { useCanvasTexture, useInteractable } from './interact';
import { HALF_D } from './layout';
import { Box } from './Toon';
import type { TestLabView } from '../../../shared/testLab';

// The test lab's desk in the lobby (#56), on the south wall between the time-lapse screen and the elevator: the job it
// runs, the queue and the latest results. E opens the manager's console on Mission control, with the Test lab card.

const AT: [number, number, number] = [-3.4, 1.75, HALF_D - 0.03];
const W = 1.9;
const H = 1.08;
const PX: [number, number] = [704, 400];

const line = (ctx: CanvasRenderingContext2D, text: string, max: number) => wrap(ctx, text, max, 1)[0] ?? '';

function drawScreen(ctx: CanvasRenderingContext2D, lab: TestLabView | null, use: string) {
  const [w, h] = PX;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#0f2a2e');
  g.addColorStop(1, '#16323f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#7CFFB2';
  ctx.font = `700 56px ${SANS}`;
  ctx.fillText('🧪 Test Lab', 36, 64);
  ctx.font = `600 28px ${SANS}`;
  ctx.fillStyle = '#ffffff';
  if (!lab?.enabled) {
    ctx.fillText('Off: agents use their own browsers', 36, 150);
  } else {
    const run = lab.running[0];
    ctx.fillText(line(ctx, run ? `▶ ${run.title} · ${run.agent}` : '○ idle, waiting for requests', w - 72), 36, 136);
    ctx.fillStyle = '#b8e0d2';
    ctx.font = `500 26px ${SANS}`;
    ctx.fillText(`${lab.queue.length} waiting · browser ${lab.browser === 'up' ? 'on' : 'off'}${lab.held ? ' · waiting for memory' : ''}`, 36, 180);
    lab.recent.slice(0, 3).forEach((r, i) => {
      const y = 232 + i * 40;
      ctx.fillStyle = r.ok ? 'rgba(124,255,178,0.16)' : 'rgba(255,143,163,0.2)';
      roundRect(ctx, 30, y - 17, w - 60, 34, 8);
      ctx.fill();
      ctx.fillStyle = r.ok ? '#7CFFB2' : '#ff8fa3';
      ctx.fillText(line(ctx, `${r.ok ? '✓' : '✗'} F${r.floor} ${r.agent}: ${r.title}`, w - 90), 44, y);
    });
  }
  ctx.fillStyle = '#ffd6a5';
  ctx.font = `700 26px ${SANS}`;
  ctx.fillText(`Press ${use} for the lab`, 36, h - 30);
}

export function TestLabScreen() {
  const lab = useStore((s) => s.testLab);
  const use = useKeyName('interact');
  const ref = useInteractable<THREE.Group>({ id: 'testlab', label: 'Test lab: the shared browser and test runs', action: { kind: 'manager', tab: TEST_LAB_SECTION } }, 4);
  const tex = useCanvasTexture(PX[0], PX[1], (ctx) => drawScreen(ctx, lab, use), [lab, use]);
  return (
    <group ref={ref} position={AT} rotation={[0, Math.PI, 0]}>
      <Box size={[W + 0.14, H + 0.14, 0.06]} position={[0, 0, -0.04]} color="#2b2d42" outline shadow={false} />
      <mesh position={[0, 0, 0.002]}>
        <planeGeometry args={[W, H]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  );
}
