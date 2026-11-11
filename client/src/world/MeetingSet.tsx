// The meeting room's furniture (#369), drawn the same in the lobby (MeetingRoom.tsx) and in the call window's live view
// of the room (MeetingTile.tsx): the table, its chairs, the solid east wall and its screen showing the call's captions,
// and the warm lamps over the table. Nothing here can be aimed at: the lobby adds that.
import { useCallCaptions } from '../ui/callCaptions';
import { useCall } from '../ui/voiceCallStore';
import { inCall } from '../ui/voiceCall';
import { roundRect, SANS, wrap } from './draw';
import { useCanvasTexture } from './interact';
import { MEETING_CHAIRS, MEETING_ROOM, MEETING_SCREEN, MEETING_TABLE, WALL_H } from './layout';
import { glow } from './materials';
import { Box, Cyl } from './Toon';

const WOOD = '#9c6644';
const SEAT = '#3d405b';
const WALL = '#f1e3d3';
const PX = { w: 896, h: 416 };

/** The wall screen's picture: who the call is with and how it's going, then the line being said, big. */
function drawCallScreen(ctx: CanvasRenderingContext2D, on: boolean, ceo: string, status: string, line: string) {
  const { w, h } = PX;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#1d2340');
  g.addColorStop(1, '#30214a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  if (!on) {
    ctx.fillStyle = '#ffd6a5';
    ctx.font = `700 64px ${SANS}`;
    ctx.fillText('Meeting room', 48, 120);
    ctx.fillStyle = '#c9c9ee';
    ctx.font = `500 36px ${SANS}`;
    for (const [i, l] of wrap(ctx, `Calls with ${ceo} happen here. Take a seat to start one.`, w - 96, 3).entries()) ctx.fillText(l, 48, 210 + i * 50);
    return;
  }
  roundRect(ctx, 40, 34, 112, 46, 23);
  ctx.fillStyle = '#e63946';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(62, 57, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `700 26px ${SANS}`;
  ctx.fillText('LIVE', 76, 58);
  ctx.font = `700 40px ${SANS}`;
  ctx.fillText(`Call with ${ceo}`, 176, 58);
  ctx.fillStyle = '#a9adc6';
  ctx.font = `500 30px ${SANS}`;
  ctx.fillText(status, 40, 122);
  // the captions in the screen's top half: the CEO stands in front of its bottom edge
  ctx.fillStyle = '#ffffff';
  ctx.font = `600 40px ${SANS}`;
  for (const [i, l] of wrap(ctx, line || ' ', w - 80, 3).entries()) ctx.fillText(l, 40, 190 + i * 52);
}

function MeetingScreen() {
  const on = useCall((s) => inCall(s.call));
  const { ceo, status, line } = useCallCaptions();
  const tex = useCanvasTexture(PX.w, PX.h, (ctx) => drawCallScreen(ctx, on, ceo, status, line), [on, ceo, status, line]);
  const s = MEETING_SCREEN;
  return (
    <group position={[s.x, s.y, s.z]} rotation={[0, -Math.PI / 2, 0]}>
      <Box size={[s.w + 0.12, s.h + 0.12, 0.06]} position={[0, 0, -0.03]} color="#2b2d42" shadow={false} />
      <mesh position={[0, 0, 0.005]}>
        <planeGeometry args={[s.w, s.h]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** One meeting chair, facing `yaw` (0 north). */
function Chair({ x, z, yaw }: { x: number; z: number; yaw: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]}>
      <Box size={[0.52, 0.1, 0.5]} position={[0, 0.47, 0]} color={SEAT} outline />
      <Box size={[0.5, 0.56, 0.08]} position={[0, 0.8, 0.24]} color={SEAT} outline />
      <Cyl r={0.035} h={0.42} position={[0, 0.22, 0]} color="#adb5bd" />
      <Cyl r={0.24} h={0.04} position={[0, 0.02, 0]} color="#6c757d" />
    </group>
  );
}

export function MeetingSet() {
  const t = MEETING_TABLE;
  const m = MEETING_ROOM;
  return (
    <group>
      {/* the solid east wall, the screen on its room side */}
      <Box size={[0.24, WALL_H - 0.8, m.maxZ - m.minZ]} position={[m.maxX - 0.04, (WALL_H - 0.8) / 2, (m.minZ + m.maxZ) / 2]} color={WALL} outline />
      <MeetingScreen />
      <Box size={[t.w, 0.07, t.d]} position={[t.x, 0.74, t.z]} color={WOOD} outline />
      <Box size={[t.w - 0.5, 0.68, 0.08]} position={[t.x, 0.36, t.z]} color="#7f5539" />
      {[-1, 1].map((s) => (
        <Box key={s} size={[0.1, 0.7, t.d - 0.2]} position={[t.x + s * (t.w / 2 - 0.3), 0.35, t.z]} color="#7f5539" />
      ))}
      {MEETING_CHAIRS.map((c, i) => (
        <Chair key={i} x={c.x} z={c.z} yaw={c.yaw} />
      ))}
      {/* warm pendant lamps over the table */}
      {[-0.9, 0.9].map((dx) => (
        <group key={dx} position={[t.x + dx, 0, t.z]}>
          <Cyl r={0.01} h={0.7} position={[0, WALL_H - 0.35, 0]} color="#495057" />
          <Cyl r={0.08} rTop={0.3} h={0.22} position={[0, WALL_H - 0.8, 0]} color="#2b2d42" outline />
          <mesh position={[0, WALL_H - 0.92, 0]} material={glow('#ffd6a5')}>
            <sphereGeometry args={[0.1, 12, 8]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
