// The lobby's IT office (#535), next to the CEO's: a glass room with an "IT" sign over its door, the server rack whose
// LEDs blink the machine's health (green / amber / red, itRoom.ts), the wall screen with disk, memory, swap and the
// services, the help desk with the IT lead (#524) behind it and the ticket board of IT's open recommendations (#525).
// E (or a tap) on the lead or the desk opens IT's chat. Furniture comes from the CC0 model kits (models/), each with a
// shapes fallback; layout.ts has where everything stands.

import { memo, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import type * as THREE from 'three';
import { useStore, type Agent } from '../store';
import { IT_ID } from '../../../shared/itDept';
import { Character } from './Character';
import { drawSign, roundRect, SANS } from './draw';
import { useCanvasTexture, useInteractable } from './interact';
import { itScreenRows, itTicketRows, ledColour, rackLevel, type RackLevel } from './itRoom';
import { IT_BIN, IT_BOXES, IT_CABINET, IT_DESK, IT_LEAD, IT_PLANT, IT_RACK, IT_ROOM, IT_SCREEN, IT_TICKETS } from './layout';
import { glow } from './materials';
import { Model } from './models/Model';
import { WallSign } from './OfficeFloor';
import { GlassWall, Plant, Rug } from './Props';
import { Box, Cyl } from './Toon';
import { BILLBOARD } from './viewTags';

const IT_ACCENT = '#2a9d8f';
const WALL = '#e9eef2';
const LEVEL_TEXT: Record<RackLevel, string> = { good: '#7CFFB2', warn: '#ffd166', bad: '#ff6b6b', unknown: '#c9cfe0' };

/** The IT lead as a person: never in the office's agent list, so made here. */
function leadAgent(name: string, busy: boolean): Agent {
  return {
    id: IT_ID,
    name,
    repoId: '',
    role: 'agent',
    look: 'feminine',
    task: null,
    desk: 0,
    color: IT_ACCENT,
    hair: '#3d2314',
    skin: '#c68642',
    style: null,
    model: '',
    effort: '',
    cli: '',
    terminal: false,
    status: busy ? 'working' : 'idle',
    issueNumber: null,
    issueTitle: null,
    branch: null,
    prNumber: null,
    prUrl: null,
    currentTool: null,
    startedAt: null,
    endedAt: null,
    costUsd: 0,
    turns: 0,
    browserUrl: null,
    hasScreenshot: false,
    screenshotAt: null,
    lastError: null,
    career: null,
  };
}

function useItReadings() {
  const health = useStore((s) => s.health);
  const watch = useStore((s) => s.itWatch);
  return useMemo(() => {
    const out = { level: rackLevel(health, watch), rows: itScreenRows(health, watch) };
    (window as unknown as { __swarmItOffice?: unknown }).__swarmItOffice = out; // what the screen shows, for QA
    return out;
  }, [health, watch]);
}

// ---------- the server rack ----------

const LED_ROWS = 9;
const LED_COLS = 4;

/** Its LEDs blink in two sets taking turns, in the colour of the machine's health. */
const ServerRack = memo(function ServerRack({ level }: { level: RackLevel }) {
  const r = IT_RACK;
  const sets = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const led = glow(ledColour(level));
  useFrame(({ clock }) => {
    const on = Math.floor(clock.elapsedTime * (level === 'bad' ? 4 : 1.5)) % 2 === 0;
    if (sets[0].current) sets[0].current.visible = on;
    if (sets[1].current) sets[1].current.visible = !on || level === 'good';
  });
  const front = r.d / 2 + 0.006;
  return (
    <group position={[r.x, 0, r.z]}>
      <Box size={[r.w, r.h, r.d]} position={[0, r.h / 2, 0]} color="#2b2d42" outline />
      {Array.from({ length: LED_ROWS }, (_, i) => (
        <Box key={i} size={[r.w - 0.12, 0.16, 0.02]} position={[0, 0.25 + i * 0.19, front - 0.004]} color={i % 3 === 0 ? '#3d405b' : '#343a52'} shadow={false} />
      ))}
      {[0, 1].map((set) => (
        <group key={set} ref={sets[set]}>
          {Array.from({ length: LED_ROWS * LED_COLS }, (_, i) => i)
            .filter((i) => (i + Math.floor(i / LED_COLS)) % 2 === set)
            .map((i) => (
              <mesh key={i} position={[-0.26 + (i % LED_COLS) * 0.045, 0.25 + Math.floor(i / LED_COLS) * 0.19, front + 0.01]} material={led}>
                <boxGeometry args={[0.025, 0.025, 0.01]} />
              </mesh>
            ))}
        </group>
      ))}
      {/* cables: down its side, then along the floor to the help desk */}
      <Box size={[0.06, r.h - 0.2, 0.06]} position={[-r.w / 2 - 0.04, (r.h - 0.2) / 2, r.d / 2 - 0.1]} color="#1d3557" shadow={false} />
      <Box size={[0.05, r.h - 0.4, 0.05]} position={[-r.w / 2 - 0.1, (r.h - 0.4) / 2, r.d / 2 - 0.2]} color="#e63946" shadow={false} />
    </group>
  );
});

/** Cable covers on the floor from the rack to the desk: low enough to walk over. */
function Cables() {
  const from = { x: IT_RACK.x - IT_RACK.w / 2 - 0.07, z: IT_RACK.z + IT_RACK.d / 2 - 0.15 };
  const to = { x: IT_DESK.x + IT_DESK.w / 2 + 0.1, z: IT_DESK.z - IT_DESK.d / 2 + 0.2 };
  return (
    <group>
      <Box size={[0.12, 0.025, to.z - from.z]} position={[from.x, 0.012, (from.z + to.z) / 2]} color="#495057" shadow={false} />
      <Box size={[from.x - to.x, 0.025, 0.12]} position={[(from.x + to.x) / 2, 0.012, to.z]} color="#495057" shadow={false} />
    </group>
  );
}

// ---------- the screens ----------

function WallScreen({ rows, level }: { rows: ReturnType<typeof itScreenRows>; level: RackLevel }) {
  const s = IT_SCREEN;
  const tex = useCanvasTexture(
    1024,
    588,
    (ctx) => {
      roundRect(ctx, 0, 0, 1024, 588, 24);
      ctx.fillStyle = '#14213d';
      ctx.fill();
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 52px ${SANS}`;
      ctx.fillText('🖥️ Machine health', 44, 64);
      ctx.fillStyle = ledColour(level);
      ctx.beginPath();
      ctx.arc(964, 64, 20, 0, Math.PI * 2);
      ctx.fill();
      rows.forEach((r, i) => {
        const y = 160 + i * 106;
        roundRect(ctx, 36, y - 44, 952, 88, 18);
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fill();
        ctx.fillStyle = '#c9cfe0';
        ctx.font = `500 38px ${SANS}`;
        ctx.textAlign = 'left';
        ctx.fillText(r.label, 66, y);
        ctx.fillStyle = LEVEL_TEXT[r.level];
        ctx.font = `700 42px ${SANS}`;
        ctx.textAlign = 'right';
        const v = r.value.length > 30 ? `${r.value.slice(0, 29)}…` : r.value;
        ctx.fillText(v, 958, y);
        ctx.textAlign = 'left';
      });
    },
    [rows, level],
  );
  return (
    <group position={[s.x, s.y, s.z]}>
      <Box size={[s.w + 0.12, s.h + 0.12, 0.06]} color="#212529" outline />
      <mesh position={[0, 0, 0.035]}>
        <planeGeometry args={[s.w, s.h]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  );
}

function TicketBoard() {
  const watch = useStore((s) => s.itWatch);
  const tickets = useMemo(() => itTicketRows(watch, Date.now()), [watch]);
  const t = IT_TICKETS;
  return (
    <WallSign
      position={[t.x, t.y, t.z]}
      rotationY={Math.PI}
      size={[t.w, t.h]}
      px={[760, 440]}
      draw={(ctx) => {
        roundRect(ctx, 0, 0, 760, 440, 26);
        ctx.fillStyle = '#fdf6e3';
        ctx.fill();
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#264653';
        ctx.font = `700 46px ${SANS}`;
        ctx.fillText(`🎫 IT tickets${tickets.length ? ` · ${tickets.length}` : ''}`, 34, 52);
        if (!tickets.length) {
          ctx.fillStyle = '#6c757d';
          ctx.font = `500 32px ${SANS}`;
          ctx.fillText('Nothing open: all quiet.', 34, 150);
          ctx.fillText('IT’s recommendations show here.', 34, 200);
          return;
        }
        tickets.slice(0, 4).forEach((title, i) => {
          const y = 128 + i * 74;
          ctx.fillStyle = i % 2 ? '#ffe8a3' : '#ffd6a5';
          roundRect(ctx, 26, y - 30, 708, 60, 12);
          ctx.fill();
          ctx.fillStyle = '#264653';
          ctx.font = `600 30px ${SANS}`;
          ctx.fillText(title.length > 38 ? `${title.slice(0, 37)}…` : title, 46, y);
        });
        if (tickets.length > 4) {
          ctx.fillStyle = '#6c757d';
          ctx.font = `500 26px ${SANS}`;
          ctx.fillText(`+${tickets.length - 4} more in the IT chat`, 34, 418);
        }
      }}
      deps={[tickets]}
    />
  );
}

// ---------- the help desk and the IT lead ----------

function LeadTag({ name, state }: { name: string; state: string }) {
  const tex = useCanvasTexture(
    512,
    150,
    (ctx) => drawSign(ctx, 512, 150, [{ text: `${name} · IT`, size: 48 }, { text: state, size: 34, weight: 600, color: state === 'free' ? '#d8f3dc' : '#ffe066' }], IT_ACCENT),
    [name, state],
  );
  return (
    <Billboard position={[0, 2.05, 0]} userData={BILLBOARD}>
      <mesh>
        <planeGeometry args={[1.1, 0.32]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} />
      </mesh>
    </Billboard>
  );
}

function HelpDesk() {
  const s = useStore((x) => x.settings.itDept);
  const busy = useStore((x) => x.it?.busy ?? false);
  const lead = useMemo(() => leadAgent(s.name, busy && s.on), [s.name, busy, s.on]);
  const state = !s.on ? 'off' : busy ? 'working…' : 'free';
  const ref = useInteractable<THREE.Group>({ id: 'it-lead', label: s.on ? `Chat with ${s.name}, IT` : 'The IT department is off: open its setup', action: { kind: 'manager', tab: 'it-dept' } }, 3.2);
  const d = IT_DESK;
  const work = 0.76; // the lead's side is a desk; the visitor's a raised ledge
  return (
    <group ref={ref}>
      <group position={[d.x, 0, d.z]}>
        <Box size={[d.w, d.h - 0.06, d.d]} position={[-0.05, (d.h - 0.06) / 2, 0]} color="#ffffff" outline />
        <Box size={[d.w * 0.5, 0.06, d.d + 0.08]} position={[-d.w / 4, d.h - 0.03, 0]} color={IT_ACCENT} outline />
        <Box size={[0.55, 0.05, d.d]} position={[d.w / 2 + 0.2, work, 0]} color="#d4a373" outline />
        <Box size={[0.02, 0.32, d.d - 0.4]} position={[-d.w / 2 - 0.04, 0.62, 0]} color="#e9f5f3" shadow={false} />
        <Model name="monitor" at={[{ x: d.w / 2 + 0.1, z: -0.3, y: work + 0.025, rotY: Math.PI / 2 }]} size={[0.6, 0.45, 0.16]} fallback={(p) => <Box size={[0.08, 0.4, 0.55]} position={[p.x, p.y! + 0.25, p.z]} color="#343a40" outline />} />
        <Model name="keyboard" at={[{ x: d.w / 2 + 0.3, z: -0.3, y: work + 0.025, rotY: Math.PI / 2 }]} size={[0.42, 0.05, 0.16]} fallback={(p) => <Box size={[0.15, 0.025, 0.42]} position={[p.x, p.y! + 0.012, p.z]} color="#f4f4f8" />} />
        <Cyl r={0.045} h={0.1} position={[d.w / 2 + 0.3, work + 0.075, 0.4]} color="#ffd166" outline />
      </group>
      <Model name="deskChair" at={[{ x: IT_LEAD.x + 0.05, z: IT_LEAD.z, rotY: Math.PI / 2 }]} size={[0.62, 1.0, 0.62]} fallback={(p) => <Box size={[0.6, 0.1, 0.6]} position={[p.x, 0.46, p.z]} color="#2b2d42" outline />} />
      <group position={[IT_LEAD.x, 0, IT_LEAD.z]} rotation={[0, Math.PI / 2, 0]}>
        <Character agent={lead} />
        <LeadTag name={s.name} state={state} />
      </group>
    </group>
  );
}

// ---------- the room ----------

export function ItOffice() {
  const r = IT_ROOM;
  const { level, rows } = useItReadings();
  const door = (r.doorMinZ + r.doorMaxZ) / 2;
  return (
    <group>
      <Rug position={[(r.minX + r.maxX) / 2, 0.005, (r.minZ + r.maxZ) / 2]} size={[r.maxX - r.minX, r.maxZ - r.minZ]} color="#d8f3dc" />
      <GlassWall from={[r.minX, r.minZ]} to={[r.minX, r.doorMinZ]} />
      <GlassWall from={[r.minX, r.doorMaxZ]} to={[r.minX, r.maxZ]} />
      <Box size={[0.1, 0.5, r.doorMaxZ - r.doorMinZ]} position={[r.minX, 2.55, door]} color="#8d99ae" />
      <WallSign position={[r.minX - 0.06, 3.1, door]} rotationY={-Math.PI / 2} size={[1.6, 0.5]} px={[384, 120]} draw={(ctx) => drawSign(ctx, 384, 120, [{ text: 'IT', size: 64 }], IT_ACCENT)} deps={[]} />
      {/* a solid south wall for the ticket board, and a panel over the CEO office's glass behind the rack */}
      <Box size={[r.maxX - r.minX, 2.8, 0.12]} position={[(r.minX + r.maxX) / 2, 1.4, r.maxZ]} color={WALL} outline />
      <Box size={[r.maxX - r.minX - 0.1, 2.8, 0.06]} position={[(r.minX + r.maxX) / 2 + 0.05, 1.4, r.minZ + 0.09]} color={WALL} shadow={false} />
      <ServerRack level={level} />
      <Cables />
      <WallScreen rows={rows} level={level} />
      <TicketBoard />
      <HelpDesk />
      <Model name="cabinet" at={[{ x: IT_CABINET.x, z: IT_CABINET.z }]} size={[IT_CABINET.w, IT_CABINET.h, IT_CABINET.d]} fallback={(p) => <Box size={[IT_CABINET.w, IT_CABINET.h, IT_CABINET.d]} position={[p.x, IT_CABINET.h / 2, p.z]} color="#c1121f" outline />} />
      <Model
        name="box"
        at={[{ x: IT_BOXES.x, z: IT_BOXES.z }, { x: IT_BOXES.x + 0.03, z: IT_BOXES.z, y: IT_BOXES.h / 2, rotY: 0.4 }]}
        size={[IT_BOXES.w, IT_BOXES.h / 2, IT_BOXES.d]}
        fallback={(p) => <Box size={[IT_BOXES.w - 0.05, IT_BOXES.h / 2, IT_BOXES.d - 0.05]} position={[p.x, (p.y ?? 0) + IT_BOXES.h / 4, p.z]} rotation={[0, p.rotY ?? 0, 0]} color="#d4a373" outline />}
      />
      <Model name="plant" at={[IT_PLANT]} size={[0.6, 1.2, 0.6]} fallback={(p) => <Plant position={[p.x, 0, p.z]} pot={IT_ACCENT} />} />
      <Model name="bin" at={[IT_BIN]} size={[0.34, 0.5, 0.34]} fallback={(p) => <Cyl r={0.16} h={0.45} position={[p.x, 0.225, p.z]} color="#adb5bd" outline />} />
    </group>
  );
}
