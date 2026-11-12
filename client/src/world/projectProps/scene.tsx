// A floor's project props in 3D (#536), in a lazy chunk of their own (ProjectPropsLayer.tsx): its set's things in their
// spots (CC0 models where there are some, plain shapes while they load or if they fail), their live screens, the
// board screen every floor has, the vault's security cameras, and the tool on every working desk.

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { DeskTool, PropSet } from '../../../../shared/floorProps';
import type { RepoView } from '../../../../shared/types';
import { loadScreenshot } from '../../screenshot';
import { kanbanFor, useStore, type Agent } from '../../store';
import type { useLatestShot } from '../AppMonitor';
import { arcadeModel } from '../decor/models';
import { vertexToon } from '../decor/parts';
import { serverRackModel } from '../floorThemes/studioModels';
import { screenMat, staticTexture } from '../floorThemes/screenKit';
import { useCanvasTexture } from '../interact';
import { deskPosition, deskRotation, DESK_TOP } from '../layout';
import { glow } from '../materials';
import * as D from './draw';
import { useModel, type Fit, type ModelName } from './glb';
import * as M from './models';
import { ago, clipsApproved, floorBoard, gitLog, latestMerge, launchCountdown, notices, teamStatus, tenantStatus } from './screens';
import { CAMERA_CORNERS, hasCameras, PROJECT_SPOTS, projectItems, type PlacedItem } from './spots';

export interface ProjectSceneProps {
  set: PropSet;
  tool: DeskTool;
  repo: RepoView;
  agents: Agent[];
  /** Handed over rather than imported, like the themes' (FloorThemeLayer.tsx), so the 3D office's chunk stays whole. */
  office: { useLatestShot: typeof useLatestShot };
}

type Pose = { x: number; y: number; z: number; rotY: number };

/** A plane facing the way `at` faces, a little out from it, glowing like a screen. */
function Face({ at, w, h, map, out = 0.04, dy = 0, dx = 0 }: { at: Pose; w: number; h: number; map: THREE.Texture; out?: number; dy?: number; dx?: number }) {
  const x = at.x + Math.sin(at.rotY) * out + Math.cos(at.rotY) * dx;
  const z = at.z + Math.cos(at.rotY) * out - Math.sin(at.rotY) * dx;
  return (
    <mesh position={[x, at.y + dy, z]} rotation={[0, at.rotY, 0]} material={screenMat(map)}>
      <planeGeometry args={[w, h]} />
    </mesh>
  );
}

/** A piece of a prop at its pose. */
function Piece({ at, geometry }: { at: Pose; geometry: THREE.BufferGeometry }) {
  return <mesh geometry={geometry} material={vertexToon} position={[at.x, at.y, at.z]} rotation={[0, at.rotY, 0]} castShadow receiveShadow />;
}

/** A CC0 model fitted to its box, or its stand-in until (or unless) it loads. */
function Model({ at, name, fit, standIn }: { at: Pose; name: ModelName; fit: Fit; standIn: () => THREE.BufferGeometry }) {
  const geo = useModel(name, fit);
  return <Piece at={at} geometry={geo ?? standIn()} />;
}

/** The housing behind a wall screen or poster. */
const frameGeo = new Map<string, THREE.BoxGeometry>();
function Frame({ at, w, h, color = '#1b263b' }: { at: Pose; w: number; h: number; color?: string }) {
  const key = `${w}x${h}`;
  let g = frameGeo.get(key);
  if (!g) frameGeo.set(key, (g = new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.05).translate(0, 0, 0.01)));
  const mat = useMemo(() => new THREE.MeshToonMaterial({ color }), [color]);
  return <mesh geometry={g} material={mat} position={[at.x, at.y, at.z]} rotation={[0, at.rotY, 0]} />;
}

// ---------- the floor's screenshot, for the board and the live wall ----------

function useShot(agents: Agent[], office: ProjectSceneProps['office'], when: boolean) {
  const latest = office.useLatestShot(agents);
  const [shot, setShot] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!when || !latest) return setShot(null);
    const [id, at] = latest.split('|');
    return loadScreenshot(id, Number(at), setShot);
  }, [when, latest]);
  return shot;
}

/** Refreshes "x min ago" once a minute. */
function useMinute() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

// ---------- the board screen every floor has ----------

const BOARD_PX: [number, number] = [1024, 585];

function BoardScreen({ repo, agents, office }: Omit<ProjectSceneProps, 'set' | 'tool'>) {
  const at = PROJECT_SPOTS.board;
  const qa = useStore((s) => s.qa);
  const cols = useMemo(() => kanbanFor(repo, agents, qa), [repo, agents, qa]);
  const now = useMinute();
  const board = floorBoard(cols, repo.pulls, new Date(now));
  const latest = latestMerge(repo.pulls);
  const team = teamStatus(agents);
  const shot = useShot(agents, office, repo.preview.status === 'running');
  const name = repo.fullName.split('/')[1] ?? repo.fullName;
  const latestAgo = ago(latest?.at ?? null, now);
  const tex = useCanvasTexture(
    ...BOARD_PX,
    (ctx) => D.drawBoard(ctx, ...BOARD_PX, { name, board, latest, latestAgo, team, shot, preview: repo.preview.status }),
    [name, board.progress, board.qa, board.ready, board.mergedToday, latest?.number, latest?.title, latestAgo, team.working, team.free, team.help, shot, repo.preview.status],
  );
  return (
    <group name="project-board" userData={{ board }}>
      <Frame at={at} w={at.w} h={at.d} />
      <Face at={at} w={at.w} h={at.d} map={tex} />
    </group>
  );
}

// ---------- wall items ----------

const PX = (at: PlacedItem): [number, number] => [512, Math.round((512 * at.h) / at.w)];

function TenantScreen({ at, repo }: { at: PlacedItem; repo: RepoView }) {
  const qa = useStore((s) => s.qa);
  const now = useMinute();
  const t = tenantStatus(repo.id, repo.pulls, qa);
  const last = ago(t.lastMerge, now);
  const key = t.gates.map((g) => `${g.number}${g.checks}${g.qa}`).join();
  const tex = useCanvasTexture(...PX(at), (ctx) => D.drawTenant(ctx, ...PX(at), { lastMerge: last, gates: t.gates, open: t.open }), [last, key, t.open]);
  return <Screen at={at} map={tex} />;
}

function Noticeboard({ at, repo }: { at: PlacedItem; repo: RepoView }) {
  const items = notices(repo.issues);
  const key = items.map((i) => `${i.number}${i.title}`).join('|');
  const tex = useCanvasTexture(...PX(at), (ctx) => D.drawNoticeboard(ctx, ...PX(at), items), [key]);
  return <Screen at={at} map={tex} frame="#7f5539" />;
}

function LiveWall({ at, agents, office }: { at: PlacedItem; agents: Agent[]; office: ProjectSceneProps['office'] }) {
  const working = teamStatus(agents).working;
  const shot = useShot(agents, office, true);
  const tex = useCanvasTexture(...PX(at), (ctx) => D.drawLiveWall(ctx, ...PX(at), { live: working > 0, working, shot }), [working, shot]);
  return <Screen at={at} map={tex} />;
}

function Countdown({ at, repo }: { at: PlacedItem; repo: RepoView }) {
  const now = useMinute();
  const c = launchCountdown([repo.mission, repo.charter?.focus ?? '', ...(repo.charter?.objectives ?? []).map((o) => `${o.outcome} ${o.measure}`)], new Date(now));
  const tex = useCanvasTexture(...PX(at), (ctx) => D.drawCountdown(ctx, ...PX(at), { days: c?.days ?? null, date: c?.date ?? null }), [c?.days, c?.date]);
  return <Screen at={at} map={tex} frame="#3c096c" />;
}

function ClipsCounter({ at, repo }: { at: PlacedItem; repo: RepoView }) {
  const now = useMinute();
  const c = clipsApproved(repo.pulls, new Date(now));
  const tex = useCanvasTexture(...PX(at), (ctx) => D.drawClipsCounter(ctx, ...PX(at), c), [c.today, c.total]);
  return <Screen at={at} map={tex} />;
}

function TerminalWall({ at, repo }: { at: PlacedItem; repo: RepoView }) {
  const lines = gitLog(repo.pulls);
  const tex = useCanvasTexture(...PX(at), (ctx) => D.drawTerminal(ctx, ...PX(at), lines), [lines.join('\n')]);
  return <Screen at={at} map={tex} />;
}

function Screen({ at, map, frame }: { at: PlacedItem; map: THREE.Texture; frame?: string }) {
  return (
    <group name={`project-${at.item}`}>
      <Frame at={at} w={at.w} h={at.h} color={frame} />
      <Face at={at} w={at.w} h={at.h} map={map} />
    </group>
  );
}

function Poster({ at, draw }: { at: PlacedItem; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void }) {
  const [w, h] = PX(at);
  return <Screen at={at} map={staticTexture(`project:${at.item}`, w, h, (c) => draw(c, w, h))} frame="#e9ecef" />;
}

// ---------- floor items ----------

const clipTex = (i: number) => staticTexture(`project:clip:${i}`, 90, 160, (c) => D.drawClip(c, 90, 160, i));
const sketchTex = () => staticTexture('project:sketch', 128, 90, (c) => D.drawSketch(c, 128, 90));
const voteTex = () => staticTexture('project:vote', 256, 80, (c) => {
  c.fillStyle = '#1d3557';
  c.fillRect(0, 0, 256, 80);
  c.font = `700 52px ${'Fredoka, system-ui, sans-serif'}`;
  c.fillStyle = '#ffffff';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('VOTE', 128, 42);
});

/** A point on a prop, `dx` across its front, `dz` toward its front, `dy` up, turned into the room. */
const local = (at: Pose, dx: number, dy: number, dz: number, turn = 0): Pose => ({
  x: at.x + Math.cos(at.rotY) * dx + Math.sin(at.rotY) * dz,
  y: at.y + dy,
  z: at.z - Math.sin(at.rotY) * dx + Math.cos(at.rotY) * dz,
  rotY: at.rotY + turn,
});

const TABLE_TOP = 0.75;
const BENCH_TOP = 0.78;

function FloorItem({ at }: { at: PlacedItem }) {
  const { w, h, d } = at;
  switch (at.item) {
    case 'vault-door':
      return <Piece at={at} geometry={M.vaultDoorModel()} />;
    case 'backup-shelf':
      return (
        <>
          <Model at={at} name="shelf" fit={{ w, h, d }} standIn={() => M.shelfBase(w, h, d)} />
          <Piece at={at} geometry={M.backupTapesModel(w, h, d)} />
        </>
      );
    case 'ballot-box':
      return (
        <>
          <Piece at={at} geometry={M.ballotBoxModel()} />
          <Face at={local(at, -0.1, M.BALLOT_LABEL.y, M.BALLOT_LABEL.z)} w={M.BALLOT_LABEL.w} h={M.BALLOT_LABEL.h} map={voteTex()} out={0.002} />
        </>
      );
    case 'voting-booth':
      return <Piece at={at} geometry={M.votingBoothModel()} />;
    case 'blueprint-table':
      return (
        <>
          <Model at={at} name="table" fit={{ w, h: TABLE_TOP, d }} standIn={() => M.tableBase(w, TABLE_TOP, d)} />
          <Piece at={at} geometry={M.miniBuildingModel(TABLE_TOP)} />
        </>
      );
    case 'robot-bench':
      return (
        <>
          <Model at={at} name="desk" fit={{ w, h: BENCH_TOP, d }} standIn={() => M.tableBase(w, BENCH_TOP, d, '#6c757d')} />
          <Piece at={at} geometry={M.robotModel(BENCH_TOP)} />
        </>
      );
    case 'camera-rig':
      return (
        <>
          <Piece at={at} geometry={M.cameraRigModel()} />
          <mesh position={[local(at, M.RIG_RING.x, M.RIG_RING.y, 0.02).x, M.RIG_RING.y, local(at, M.RIG_RING.x, M.RIG_RING.y, 0.02).z]} rotation={[0, at.rotY, 0]} material={glow('#fff4e0')}>
            <torusGeometry args={[M.RIG_RING.r, 0.022, 6, 24]} />
          </mesh>
        </>
      );
    case 'phone-bay':
      return (
        <>
          <Model at={at} name="desk" fit={{ w, h: BENCH_TOP, d }} standIn={() => M.tableBase(w, BENCH_TOP, d, '#343a40')} />
          <Piece at={at} geometry={M.phoneStandsModel(BENCH_TOP)} />
          {M.PHONES.x.map((x, i) => (
            <Face key={x} at={local(at, x, BENCH_TOP + 0.08 + M.PHONES.h / 2, -0.1, M.PHONES.rotY[i])} w={M.PHONES.w} h={M.PHONES.h} map={clipTex(i)} out={0.014} />
          ))}
        </>
      );
    case 'device-table':
      return (
        <>
          <Model at={at} name="table" fit={{ w, h: TABLE_TOP, d }} standIn={() => M.tableBase(w, TABLE_TOP, d)} />
          <Piece at={at} geometry={M.devicesModel(TABLE_TOP)} />
          {M.DEVICES.map((v) => {
            const p = local(at, v.x, TABLE_TOP + 0.014, v.z, v.rotY);
            return (
              <mesh key={v.x} position={[p.x, p.y, p.z]} rotation={[-Math.PI / 2, 0, p.rotY]} material={screenMat(v.w > 0.2 ? sketchTex() : clipTex(Math.round(v.x * 10) & 3))}>
                <planeGeometry args={[v.w, v.d]} />
              </mesh>
            );
          })}
        </>
      );
    case 'server-rack':
      return <Piece at={at} geometry={serverRackModel()} />;
    case 'patch-panel':
      return <Piece at={at} geometry={M.patchPanelModel()} />;
    case 'arcade':
      return <Piece at={at} geometry={arcadeModel('#ffbe0b')} />;
    case 'controller-stand':
      return <Piece at={at} geometry={M.controllerStandModel()} />;
    default:
      return null;
  }
}

function Item({ at, repo, agents, office }: { at: PlacedItem } & Omit<ProjectSceneProps, 'set' | 'tool'>) {
  switch (at.item) {
    case 'tenant-screen':
      return <TenantScreen at={at} repo={repo} />;
    case 'noticeboard':
      return <Noticeboard at={at} repo={repo} />;
    case 'live-wall':
      return <LiveWall at={at} agents={agents} office={office} />;
    case 'countdown':
      return <Countdown at={at} repo={repo} />;
    case 'clips-counter':
      return <ClipsCounter at={at} repo={repo} />;
    case 'terminal-wall':
      return <TerminalWall at={at} repo={repo} />;
    case 'map-poster':
      return <Poster at={at} draw={D.drawMapPoster} />;
    case 'blueprint-poster':
      return <Poster at={at} draw={(c, w, h) => D.drawBlueprint(c, w, h, 'FLOOR PLAN · REV 3')} />;
    case 'wireframes':
      return <Poster at={at} draw={D.drawWireframes} />;
    case 'level-map':
      return <Poster at={at} draw={D.drawLevelMap} />;
    default:
      return (
        <group name={`project-${at.item}`}>
          <FloorItem at={at} />
        </group>
      );
  }
}

// ---------- desk tools ----------

/** Where the tool stands in a desk's frame: back left, between the plant and the monitor. */
const TOOL_AT = { x: -0.48, z: -0.28, rotY: 0.35 };
const TOOL_SCREENS: Partial<Record<DeskTool, { w: number; h: number; y: number; z: number; tilt: number; map: () => THREE.Texture }>> = {
  terminal: { ...M.TOOL_SCREEN.terminal, map: () => staticTexture('project:desk-terminal', 128, 90, (c) => D.drawDeskTerminal(c, 128, 90)) },
  tablet: { w: M.TOOL_SCREEN.tablet.w, h: M.TOOL_SCREEN.tablet.h, y: 0.0135, z: 0, tilt: -Math.PI / 2, map: sketchTex },
  phone: { w: M.TOOL_SCREEN.phone.w, h: M.TOOL_SCREEN.phone.h, y: 0.1, z: 0.006, tilt: -0.25, map: () => clipTex(1) },
};

function DeskTools({ tool, slots }: { tool: DeskTool; slots: number[] }) {
  const bodies = useRef<THREE.InstancedMesh>(null);
  const faces = useRef<THREE.InstancedMesh>(null);
  const screen = TOOL_SCREENS[tool];
  const [bodyMats, faceMats] = useMemo(() => {
    const desk = new THREE.Object3D();
    const it = new THREE.Object3D();
    const face = new THREE.Object3D();
    desk.add(it);
    it.add(face);
    const b: THREE.Matrix4[] = [];
    const f: THREE.Matrix4[] = [];
    for (const slot of slots) {
      const p = deskPosition(slot);
      desk.position.set(p.x, 0, p.z);
      desk.rotation.set(0, deskRotation(slot), 0);
      it.position.set(TOOL_AT.x, DESK_TOP, TOOL_AT.z);
      it.rotation.set(0, TOOL_AT.rotY, 0);
      if (screen) {
        face.position.set(0, screen.y, screen.z);
        face.rotation.set(screen.tilt, 0, 0);
      }
      desk.updateMatrixWorld(true);
      b.push(it.matrixWorld.clone());
      f.push(face.matrixWorld.clone());
    }
    return [b, f];
  }, [slots, screen]);
  useEffect(() => {
    for (const [m, list] of [[bodies.current, bodyMats], [faces.current, faceMats]] as const) {
      if (!m) continue;
      list.forEach((x, i) => m.setMatrixAt(i, x));
      m.count = list.length;
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }, [bodyMats, faceMats]);
  const faceGeo = useMemo(() => (screen ? new THREE.PlaneGeometry(screen.w, screen.h).translate(0, 0, 0.001) : null), [screen]);
  if (!bodyMats.length) return null;
  return (
    <group name={`desk-tools-${tool}`}>
      <instancedMesh key={`t${tool}${bodyMats.length}`} ref={bodies} args={[M.toolModel(tool), vertexToon, bodyMats.length]} castShadow />
      {screen && faceGeo && <instancedMesh key={`s${tool}${faceMats.length}`} ref={faces} args={[faceGeo, screenMat(screen.map()), faceMats.length]} />}
    </group>
  );
}

// ---------- the scene ----------

export function ProjectScene({ set, tool, repo, agents, office }: ProjectSceneProps) {
  const items = useMemo(() => projectItems(set), [set]);
  const deskKey = agents
    .filter((a) => a.role !== 'ceo')
    .map((a) => a.desk)
    .sort((a, b) => a - b)
    .join();
  const slots = useMemo(() => (deskKey ? deskKey.split(',').map(Number) : []), [deskKey]);
  return (
    <group name={`project-props-${set}`}>
      {items.map((at) => (
        <Item key={at.spot} at={at} repo={repo} agents={agents} office={office} />
      ))}
      <BoardScreen repo={repo} agents={agents} office={office} />
      {hasCameras(set) && CAMERA_CORNERS.map((c) => <Piece key={c.x} at={c} geometry={M.securityCameraModel()} />)}
      <DeskTools tool={tool} slots={slots} />
    </group>
  );
}
