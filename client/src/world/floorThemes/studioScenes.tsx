// The second batch of floor themes' dressing (#371), in the same lazy chunk as scenes.tsx (which draws them): the design,
// media, research and ops props in the free decoration slots with their screens, glass and lights; the design studio's
// pendant lamps; the media studio's ON AIR light; the research racks' LEDs, blinking with the floor's sessions; and
// the four live wall screens (gallery, content calendar, loss curve, the ops room's status wall, beacon and clock).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { RepoView } from '../../../../shared/types';
import { EMPTY_NUMBERS } from '../../ops';
import { loadScreenshot } from '../../screenshot';
import { useStore, type Agent } from '../../store';
import { rugModel } from '../decor/models';
import { vertexToon } from '../decor/parts';
import { BLOOM } from '../gfx/bloomMarks';
import { useCanvasTexture } from '../interact';
import { deskPosition, HALF_D, WALL_H } from '../layout';
import { glow, toon } from '../materials';
import { alertBeacon, contentCalendar, galleryShots, ledBlinkHz, lossCurve, nocFloor, nocSystem, onAir, overallLevel } from './liveScreens';
import type { ThemeProp } from './packs';
import { NOC_BANK, nocPanels, type PlacedProp } from './placement';
import { screenMat, staticTexture, WallPicture, WallScreen, type Pose } from './screenKit';
import * as D from './studioDraw';
import * as S from './studioModels';
import type { SceneProps } from './scenes';

type Office = SceneProps['office'];

/** Where the north wall's big screen goes (the office's "ship it" sign), as in scenes.tsx. */
const NORTH = { x: 10, z: -HALF_D + 0.03 };
const floorName = (repo: RepoView) => repo.fullName.split('/')[1] ?? repo.fullName;

// ---------- the props in the free slots ----------

const MODELS: Partial<Record<ThemeProp, () => THREE.BufferGeometry>> = {
  'drafting-pair': S.draftingPairModel,
  'material-shelf': S.materialShelfModel,
  easel: S.easelModel,
  'arc-lamp': S.arcLampModel,
  'edit-bay': S.editBayModel,
  'green-screen': S.greenScreenModel,
  'ring-light': S.ringLightModel,
  softbox: S.softboxModel,
  'rack-pair': S.rackPairModel,
  'training-room': S.trainingRoomModel,
  'server-rack': S.serverRackModel,
  'mobile-board': S.mobileBoardModel,
  'noc-console': S.nocConsoleModel,
  ups: S.upsModel,
};

const RUGS: Partial<Record<ThemeProp, string>> = { 'studio-rug': '#1d1e25', 'lab-rug': '#3b5b86', 'grid-rug': '#0b0f16' };

const SCREEN_PX: [number, number] = [512, 288];

function WallProp({ at, i }: { at: PlacedProp; i: number }) {
  switch (at.prop) {
    case 'mood-board':
      return <WallPicture at={at} w={at.w} h={1.3} map={staticTexture(`mood:${i % 2}`, 640, 362, (c) => D.drawMoodBoard(c, 640, 362, 3 + (i % 2)))} />;
    case 'swatch-strip':
      return <WallPicture at={at} w={at.w} h={0.6} map={staticTexture('swatches', 768, 210, (c) => D.drawSwatchStrip(c, 768, 210))} />;
    case 'art-print':
      return <WallPicture at={at} w={at.w} h={1.1} map={staticTexture(`print:${i % 3}`, 436, 300, (c) => D.drawArtPrint(c, 436, 300, 9 + (i % 3)))} />;
    case 'film-posters':
      return <WallPicture at={at} w={at.w} h={1.0} map={staticTexture('film-posters', 768, 334, (c) => D.drawFilmPosters(c, 768, 334))} />;
    case 'waveform':
      return <WallScreen at={at} w={at.w} h={0.9} map={staticTexture(`wave:${i % 2}`, 512, 210, (c) => D.drawWaveform(c, 512, 210, 2 + (i % 2)))} />;
    case 'shot-list':
      return <WallPicture at={at} w={at.w} h={1.2} map={staticTexture('shot-list', 512, 308, (c) => D.drawShotList(c, 512, 308))} />;
    case 'equations':
      return <WallPicture at={at} w={at.w} h={1.2} map={staticTexture(`eq:${i % 3}`, 640, 334, (c) => D.drawEquations(c, 640, 334, i % 3))} />;
    case 'net-diagram':
      return <WallScreen at={at} w={at.w} h={1.1} map={staticTexture('net', ...SCREEN_PX, (c) => D.drawNetDiagram(c, ...SCREEN_PX))} />;
    case 'network-map':
      return <WallScreen at={at} w={at.w} h={1.2} map={staticTexture(`netmap:${i % 2}`, ...SCREEN_PX, (c) => D.drawNetworkMap(c, ...SCREEN_PX, 4 + (i % 2)))} />;
    case 'runbook':
      return <WallPicture at={at} w={at.w} h={1.1} map={staticTexture('runbook', 420, 256, (c) => D.drawRunbook(c, 420, 256))} />;
    default:
      return null;
  }
}

/** A plane at (x, y, z) in a prop's own frame, turned by `rotY` there and tilted by `rotX`. */
function OnProp({ p, at, w, h, mat, rotY = 0, rotX = 0 }: { p: Pose; at: [number, number, number]; w: number; h: number; mat: THREE.Material; rotY?: number; rotX?: number }) {
  return (
    <group position={[p.x, p.y, p.z]} rotation={[0, p.rotY, 0]}>
      <mesh position={at} rotation={[rotX, rotY, 0]} material={mat}>
        <planeGeometry args={[w, h]} />
      </mesh>
    </group>
  );
}

const glass = new THREE.MeshPhysicalMaterial({ color: '#bfe3ff', transparent: true, opacity: 0.22, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide });
const ringGeo = new THREE.TorusGeometry(S.RING.r, 0.022, 8, 40);

/** The training room's glass, three panes (its back left open to the lounge's wall side for the door). */
function TrainingGlass({ p }: { p: Pose }) {
  const { w, d, h } = S.TRAINING_GLASS;
  return (
    <group position={[p.x, 0, p.z]} rotation={[0, p.rotY, 0]}>
      <mesh position={[0, h / 2, d / 2]} material={glass}>
        <planeGeometry args={[w, h]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[(s * w) / 2, h / 2, 0]} rotation={[0, Math.PI / 2, 0]} material={glass}>
          <planeGeometry args={[d, h]} />
        </mesh>
      ))}
    </group>
  );
}

/** Every new prop on the floor: instanced models, their screens and lights, the training room's glass and the rugs. */
export function StudioProps({ list, office, agents }: { list: PlacedProp[]; office: Office; agents: Agent[] }) {
  const models = useMemo(() => {
    const by = new Map<ThemeProp, Pose[]>();
    for (const p of list) if (MODELS[p.prop]) by.set(p.prop, [...(by.get(p.prop) ?? []), p]);
    return [...by];
  }, [list]);
  const of = (prop: ThemeProp) => list.filter((p) => p.prop === prop);
  const timeline = screenMat(staticTexture('timeline', 384, 230, (c) => D.drawTimeline(c, 384, 230)));
  const dash = screenMat(staticTexture('dashboards', 384, 230, (c) => D.drawDashboards(c, 384, 230)));
  const easel = screenMat(staticTexture('easel', 256, 300, (c) => D.drawEaselCanvas(c, 256, 300)));
  const board = screenMat(staticTexture('mobile-board', 320, 320, (c) => D.drawEquations(c, 320, 320, 5)));
  const racks = useMemo(() => rackPoses(list), [list]);
  return (
    <>
      {models.map(([prop, at]) => (
        <office.InstancedModel key={prop} geometry={MODELS[prop]!()} at={at} />
      ))}
      {of('easel').map((p) => (
        <OnProp key={p.slot} p={p} at={[0, S.EASEL_CANVAS.y, S.EASEL_CANVAS.z]} rotX={-0.14} w={S.EASEL_CANVAS.w} h={S.EASEL_CANVAS.h} mat={easel} />
      ))}
      {of('arc-lamp').map((p) => (
        <group key={p.slot} position={[p.x, 0, p.z]} rotation={[0, p.rotY, 0]}>
          <mesh position={[0, S.ARC_BULB.y, S.ARC_BULB.z]} material={glow('#fff1d6')}>
            <sphereGeometry args={[0.07, 12, 8]} />
          </mesh>
        </group>
      ))}
      {of('edit-bay').flatMap((p) => S.BAY_SCREENS.x.map((x, i) => <OnProp key={`${p.slot}${i}`} p={p} at={[x, S.BAY_SCREENS.y, S.BAY_SCREENS.z]} rotY={S.BAY_SCREENS.rotY[i]} w={S.BAY_SCREENS.w} h={S.BAY_SCREENS.h} mat={timeline} />))}
      {of('noc-console').flatMap((p) => S.CONSOLE_SCREENS.x.map((x, i) => <OnProp key={`${p.slot}${i}`} p={p} at={[x, S.CONSOLE_SCREENS.y, S.CONSOLE_SCREENS.z[i]]} rotY={S.CONSOLE_SCREENS.rotY[i]} w={S.CONSOLE_SCREENS.w} h={S.CONSOLE_SCREENS.h} mat={dash} />))}
      {of('mobile-board').map((p) => (
        <OnProp key={p.slot} p={p} at={[0, S.BOARD_FACE.y, S.BOARD_FACE.z]} w={S.BOARD_FACE.w} h={S.BOARD_FACE.h} mat={board} />
      ))}
      {of('ring-light').map((p) => (
        <group key={p.slot} position={[p.x, 0, p.z]} rotation={[0, p.rotY, 0]}>
          <mesh geometry={ringGeo} position={[0, S.RING.y, S.RING.z]} material={glow('#fff7ec')} />
        </group>
      ))}
      {of('softbox').map((p) => (
        <OnProp key={p.slot} p={p} at={[0, S.SOFTBOX.y, S.SOFTBOX.z]} rotX={-0.15} w={S.SOFTBOX.w} h={S.SOFTBOX.h} mat={glow('#fffaf0')} />
      ))}
      {of('training-room').map((p) => (
        <TrainingGlass key={p.slot} p={p} />
      ))}
      {racks.length > 0 && <RackLeds racks={racks} agents={agents} />}
      {list
        .filter((p) => p.prop === 'swatch-rug')
        .map((p) => (
          <mesh key={p.slot} geometry={S.swatchRugModel(p.w, p.d)} material={vertexToon} position={[p.x, 0.003, p.z]} rotation={[0, p.rotY, 0]} receiveShadow />
        ))}
      {list
        .filter((p) => RUGS[p.prop])
        .map((p) => (
          <mesh key={p.slot} geometry={rugModel(p.w, p.d, RUGS[p.prop]!)} material={vertexToon} position={[p.x, 0.003, p.z]} rotation={[0, p.rotY, 0]} receiveShadow />
        ))}
      {list.map((p, i) => (
        <WallProp key={p.slot} at={p} i={i} />
      ))}
    </>
  );
}

// ---------- the research racks' LEDs ----------

/** Every rack's front on the floor: the single racks, both of a pair, and the one in the training room. */
function rackPoses(list: PlacedProp[]): Pose[] {
  const at = (p: Pose, dx: number): Pose => ({ ...p, x: p.x + Math.cos(p.rotY) * dx, z: p.z - Math.sin(p.rotY) * dx });
  return list.flatMap((p) => (p.prop === 'server-rack' ? [p] : p.prop === 'rack-pair' ? S.RACK_PAIR_X.map((dx) => at(p, dx)) : p.prop === 'training-room' ? [at(p, -0.5)] : []));
}

const LED_COLORS = ['#22e39b', '#3d8bff', '#ffc145'];
const ledGeo = new THREE.PlaneGeometry(0.03, 0.03);
const ledMats = LED_COLORS.map((c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false, userData: BLOOM }));

/** The racks' LEDs in three groups out of step, each an instanced mesh switched on and off at the floor's blink rate. */
function RackLeds({ racks, agents }: { racks: Pose[]; agents: Agent[] }) {
  const hz = ledBlinkHz(agents);
  const groups = useRef<(THREE.InstancedMesh | null)[]>([]);
  const mats = useMemo(() => {
    const out: THREE.Matrix4[][] = [[], [], []];
    const rack = new THREE.Object3D();
    const led = new THREE.Object3D();
    rack.add(led);
    const L = S.RACK_LEDS;
    for (const p of racks) {
      rack.position.set(p.x, 0, p.z);
      rack.rotation.set(0, p.rotY, 0);
      for (let r = 0; r < L.rows; r++)
        for (let c = 0; c < L.cols; c++) {
          led.position.set(L.x0 + c * L.dx + (r % 3 === 1 ? 0.3 : 0), L.y0 + r * L.dy, L.z);
          rack.updateMatrixWorld(true);
          out[(r * 2 + c) % 3].push(led.matrixWorld.clone());
        }
    }
    return out;
  }, [racks]);
  useEffect(() => {
    groups.current.forEach((m, g) => {
      if (!m) return;
      mats[g].forEach((x, i) => m.setMatrixAt(i, x));
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    });
  }, [mats]);
  useFrame(() => {
    const t = performance.now() / 1000;
    groups.current.forEach((m, g) => {
      if (m) m.visible = (t * hz + g / 3) % 1 < 0.55;
    });
  });
  return (
    <>
      {mats.map((list, g) => (
        <instancedMesh
          key={`${g}:${list.length}`}
          ref={(m) => {
            groups.current[g] = m;
          }}
          args={[ledGeo, ledMats[g], list.length]}
        />
      ))}
    </>
  );
}

// ---------- fixed pieces ----------

/** The design studio's pendant lamps, one over each working desk. */
export function Pendants({ slots, office }: { slots: number[]; office: Office }) {
  const at = useMemo(() => slots.map((s) => ({ ...deskPosition(s), y: WALL_H - 0.9, rotY: 0 })), [slots]);
  if (!at.length) return null;
  return (
    <>
      <office.InstancedModel geometry={S.pendantModel()} at={at} shadow={false} />
      {at.map((p, i) => (
        <mesh key={i} position={[p.x, p.y - 0.17, p.z]} rotation={[-Math.PI / 2, 0, 0]} material={glow('#fff1d6')}>
          <circleGeometry args={[0.12, 16]} />
        </mesh>
      ))}
    </>
  );
}

/** The media studio's ON AIR light over the big screen: lit while anyone on the floor works. */
export function OnAirSign({ agents }: { agents: Agent[] }) {
  const lit = onAir(agents);
  const tex = useCanvasTexture(512, 128, (ctx) => D.drawOnAir(ctx, 512, 128, lit), [lit]);
  return (
    <mesh position={[NORTH.x, 3.2, NORTH.z + 0.06]}>
      <planeGeometry args={[1.3, 0.32]} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} userData={lit ? BLOOM : undefined} />
    </mesh>
  );
}

/** A big screen's frame and picture on the north wall. */
function BigScreen({ y, w, h, map, frame }: { y: number; w: number; h: number; map: THREE.Texture; frame: string }) {
  return (
    <group position={[NORTH.x, y, NORTH.z]}>
      <mesh position={[0, 0, 0.04]}>
        <boxGeometry args={[w + 0.12, h + 0.12, 0.06]} />
        <meshToonMaterial color={frame} />
      </mesh>
      <mesh position={[0, 0, 0.072]}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={map} toneMapped={false} userData={BLOOM} />
      </mesh>
    </group>
  );
}

/** The time, updated every `ms`: for screens that turn pages or tell the time (pages turn together on every screen). */
function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** The design studio's gallery: the floor's latest screenshots, a new one every 8 seconds. */
export function Gallery({ repo, agents }: { repo: RepoView; agents: Agent[] }) {
  const screens = useStore((s) => s.screens);
  const shots = useMemo(() => galleryShots(agents, screens), [agents, screens]);
  const now = useNow(8000);
  const index = shots.length ? Math.floor(now / 8000) % shots.length : 0;
  const cur = shots[index];
  const [curId, curAt] = [cur?.id, cur?.at];
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!curId) return setImg(null);
    return loadScreenshot(curId, curAt, setImg);
  }, [curId, curAt]);
  const caption = cur ? `from ${cur.name}'s browser · ${new Date(cur.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Screens agents check in their browsers show up here';
  const name = floorName(repo);
  const tex = useCanvasTexture(1024, 600, (ctx) => D.drawGallery(ctx, 1024, 600, { name, shot: cur ? img : null, caption, index, total: shots.length }), [name, img, caption, index, shots.length, !!cur]);
  return <BigScreen y={2.05} w={3.0} h={1.76} map={tex} frame="#e3c08d" />;
}

/** The media studio's content calendar from the floor's open issues. */
export function Calendar({ repo, agents }: { repo: RepoView; agents: Agent[] }) {
  const now = useNow(60_000);
  const buildingKey = agents
    .filter((a) => a.task === 'issue' && (a.status === 'working' || a.status === 'preparing') && a.issueNumber !== null)
    .map((a) => a.issueNumber)
    .join();
  const cal = useMemo(() => contentCalendar(repo.issues, new Set(buildingKey ? buildingKey.split(',').map(Number) : []), new Date(now)), [repo.issues, buildingKey, now]);
  const name = floorName(repo);
  const key = JSON.stringify(cal);
  const tex = useCanvasTexture(1280, 600, (ctx) => D.drawCalendar(ctx, 1280, 600, { name, ...cal }), [name, key]);
  return <BigScreen y={2.0} w={3.4} h={1.6} map={tex} frame="#111216" />;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The research lab's loss curve: the floor's QA pass rate over 7 days. */
export function LossCurve({ repo }: { repo: RepoView }) {
  const trend = useStore((s) => (s.ops.floors.find((f) => f.repoId === repo.id) ?? EMPTY_NUMBERS).qaPassTrend);
  const curve = useMemo(() => lossCurve(trend ?? []), [trend]);
  const today = new Date().getDay();
  const days = Array.from({ length: 7 }, (_, i) => WEEKDAYS[(today - 6 + i + 7) % 7]);
  const name = floorName(repo);
  const key = JSON.stringify(curve);
  const tex = useCanvasTexture(1024, 560, (ctx) => D.drawLoss(ctx, 1024, 560, { name, ...curve, days }), [name, key, today]);
  return <BigScreen y={2.0} w={3.0} h={1.64} map={tex} frame="#16243d" />;
}

// ---------- the ops control room ----------

const TILE_PX: [number, number] = [384, 330];

function NocTile({ pose, draw, deps }: { pose: Pose; draw: (ctx: CanvasRenderingContext2D) => void; deps: unknown[] }) {
  const tex = useCanvasTexture(...TILE_PX, draw, deps);
  return (
    <group position={[pose.x, pose.y, pose.z]} rotation={[0, pose.rotY, 0]}>
      <mesh position={[0, 0, -0.02]}>
        <boxGeometry args={[NOC_BANK.w + 0.05, NOC_BANK.h + 0.05, 0.05]} />
        <meshToonMaterial color="#05080d" />
      </mesh>
      <mesh position={[0, 0, 0.007]}>
        <planeGeometry args={[NOC_BANK.w, NOC_BANK.h]} />
        <meshBasicMaterial map={tex} toneMapped={false} userData={BLOOM} />
      </mesh>
    </group>
  );
}

/** The red beacon: a dome that glows and a beam that sweeps round while it's on. */
function Beacon({ on }: { on: boolean }) {
  const beam = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (beam.current) beam.current.rotation.y += dt * 5;
  });
  return (
    <group position={[NORTH.x + 2.25, 3.08, NORTH.z + 0.18]}>
      <mesh geometry={S.beaconBaseModel()} material={vertexToon} />
      <mesh position={[0, 0.08, 0]} geometry={domeGeo} material={on ? glow('#ff2a2a') : toon('#5a1a1a')} />
      <group ref={beam} position={[0, 0.16, 0]} visible={on}>
        <mesh position={[0.5, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <coneGeometry args={[0.18, 1, 16, 1, true]} />
          <meshBasicMaterial color="#ff2a2a" transparent opacity={0.28} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
}

const domeGeo = new THREE.SphereGeometry(0.12, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
const PAGE_MS = 10_000;

/** The ops room's curved status wall: a tile per floor and one for the office's host, a big clock and the beacon. */
export function NocWall() {
  const repos = useStore((s) => s.repos);
  const qa = useStore((s) => s.qa);
  const health = useStore((s) => s.health);
  const at = useNow(15_000);
  const page = Math.floor(at / PAGE_MS);
  const panels = useMemo(() => nocPanels(), []);
  const floors = useMemo(() => [...repos].sort((a, b) => a.floor - b.floor).map((r) => nocFloor(r, qa)), [repos, qa]);
  const system = useMemo(() => nocSystem(health), [health]);
  const slots = panels.length - 1; // the last tile is the host's
  const pages = Math.max(1, Math.ceil(floors.length / slots));
  const shown = floors.slice((page % pages) * slots, (page % pages) * slots + slots);
  const beacon = alertBeacon(repos, qa);
  const level = overallLevel([...floors.map((f) => f.level), system.level]);
  const now = new Date(at);
  const clock = useCanvasTexture(640, 160, (ctx) => D.drawStatusClock(ctx, 640, 160, { h: now.getHours(), m: now.getMinutes(), level, caption: level === 'ok' ? 'ALL GOOD' : level === 'warn' ? 'WATCH' : 'ALERT' }), [now.getHours(), now.getMinutes(), level]);
  return (
    <group>
      {panels.slice(0, slots).map((p, i) => {
        const f = shown[i] ?? null;
        return <NocTile key={i} pose={p} draw={(ctx) => D.drawNocFloor(ctx, ...TILE_PX, f)} deps={[JSON.stringify(f)]} />;
      })}
      <NocTile pose={panels[slots]} draw={(ctx) => D.drawNocSystem(ctx, ...TILE_PX, system)} deps={[JSON.stringify(system)]} />
      <mesh position={[NORTH.x, 3.22, NORTH.z + 0.05]}>
        <planeGeometry args={[1.6, 0.4]} />
        <meshBasicMaterial map={clock} transparent toneMapped={false} userData={BLOOM} />
      </mesh>
      <Beacon on={beacon} />
    </group>
  );
}
