// A themed floor's dressing (#370; #371's themes in studioScenes.tsx), the lazy chunk FloorThemeLayer.tsx loads only while a themed floor is on screen:
// the pack's props in the free decoration slots, the extra monitors on working desks, and its own wall pieces (the
// game studio's Playtest screen and neon, the trading floor's market board, world clocks and hanging ticker).
// Repeated props are one InstancedMesh each; pictures are canvases drawn once (or when their numbers change).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useShallow } from 'zustand/react/shallow';
import { prStage } from '../../../../shared/ops';
import type { RepoView } from '../../../../shared/types';
import { EMPTY_NUMBERS } from '../../ops';
import { loadScreenshot } from '../../screenshot';
import { qaKey, useStore, type Agent } from '../../store';
import { useKeyName } from '../../ui/controls';
import type { InstancedModel } from '../decor/Decorations';
import type { useLatestShot } from '../AppMonitor';
import { ARCADE, arcadeModel, rugModel } from '../decor/models';
import { vertexToon } from '../decor/parts';
import { BLOOM } from '../gfx/bloomMarks';
import { useCanvasTexture, useInteractable } from '../interact';
import { deskPosition, deskRotation, HALF_D, HALF_W, WALL_H } from '../layout';
import { glow } from '../materials';
import { dayTime } from '../sky/useDayTime';
import type { ThemePack, ThemeProp } from './packs';
import { themeProps, type PlacedProp } from './placement';
import { screenMat, staticTexture, WallPicture, WallScreen, type Pose } from './screenKit';
import * as SD from './studioDraw';
import { Calendar, Gallery, LossCurve, NocWall, OnAirSign, Pendants, StudioProps } from './studioScenes';
import * as D from './themeDraw';
import * as M from './themeModels';
import { buildProgress, candles, marketOpen, tickerQuotes, worldClocks, type QuoteValues } from './ticker';

export interface SceneProps {
  pack: ThemePack;
  repo: RepoView;
  agents: Agent[];
  /**
   * Office pieces handed over rather than imported (FloorThemeLayer.tsx), like the holiday themes': importing them here
   * would make the bundler split the 3D office's chunk into more files.
   */
  office: { InstancedModel: typeof InstancedModel; useLatestShot: typeof useLatestShot };
}

type Office = SceneProps['office'];

const SCREEN_PX: [number, number] = [512, 288];

function WallProp({ at, i }: { at: PlacedProp; i: number }) {
  switch (at.prop) {
    case 'neon-pad':
    case 'neon-gg': {
      const kind = at.prop === 'neon-pad' ? 'pad' : 'gg';
      return <WallPicture at={at} w={at.w} h={at.prop === 'neon-pad' ? 0.9 : 0.8} map={staticTexture(`neon:${kind}`, 512, 256, (c) => D.drawNeon(c, 512, 256, kind))} transparent />;
    }
    case 'posters':
      return <WallPicture at={at} w={at.w} h={1.0} map={staticTexture('posters', 768, 334, (c) => D.drawPosters(c, 768, 334))} />;
    case 'level-sketch':
      return <WallScreen at={at} w={at.w} h={1.2} map={staticTexture('level', 512, 280, (c) => D.drawLevelSketch(c, 512, 280))} />;
    case 'chart-screen':
      return <WallScreen at={at} w={at.w} h={1.15} map={staticTexture(`chart:${i}`, ...SCREEN_PX, (c) => D.drawChart(c, ...SCREEN_PX, ['CFRM', 'SHIP', 'QA', 'CI', 'MRG'][i % 5], 40 + i))} />;
    case 'news-screen':
      return <WallScreen at={at} w={at.w} h={1.24} map={staticTexture(`news:${i}`, ...SCREEN_PX, (c) => D.drawNews(c, ...SCREEN_PX, i))} />;
    default:
      return null;
  }
}

// ---------- the props in the free slots ----------

const MODELS: Partial<Record<ThemeProp, () => THREE.BufferGeometry>> = {
  figurines: M.figurinesModel,
  'gaming-chair': M.gamingChairModel,
  bull: () => M.statueModel('bull'),
  bear: () => M.statueModel('bear'),
  'tall-planter': M.planterModel,
  'quote-pod': M.quotePodModel,
  'tv-console': M.tvModel,
};

const ARCADE_ACCENT = '#2de2e6';
const arcadeTexture = () => staticTexture('arcade', 256, 192, (c) => D.drawArcadeScreen(c, 256, 192));
// The arcade's screen as a plane already in the cabinet's frame, so the screens share the cabinets' poses.
const arcadeScreenGeo = (() => {
  const s = ARCADE.screen;
  return new THREE.PlaneGeometry(s.w, s.h).rotateX(-0.12).translate(0, s.y, -0.235);
})();

/** Every arcade cabinet on the floor (a pair stands side by side): one instanced mesh for the bodies, one for the screens. */
function Arcades({ at, office }: { at: Pose[]; office: Office }) {
  const screens = useRef<THREE.InstancedMesh>(null);
  const mat = screenMat(arcadeTexture());
  useEffect(() => {
    const m = screens.current;
    if (!m) return;
    const o = new THREE.Object3D();
    at.forEach((p, i) => {
      o.position.set(p.x, p.y, p.z);
      o.rotation.set(0, p.rotY, 0);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.count = at.length;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [at]);
  if (!at.length) return null;
  return (
    <>
      <office.InstancedModel geometry={arcadeModel(ARCADE_ACCENT)} at={at} />
      <instancedMesh key={at.length} ref={screens} args={[arcadeScreenGeo, mat, at.length]} />
    </>
  );
}

/** A local offset (x across the prop's front) turned into the room. */
const offset = (p: Pose, dx: number): Pose => ({ ...p, x: p.x + Math.cos(p.rotY) * dx, z: p.z - Math.sin(p.rotY) * dx });

function ThemeProps({ list, office }: { list: PlacedProp[]; office: Office }) {
  const { arcades, models } = useMemo(() => {
    const arcades: Pose[] = [];
    const models = new Map<ThemeProp, Pose[]>();
    for (const p of list) {
      if (p.prop === 'arcade') arcades.push(p);
      else if (p.prop === 'arcade-pair') arcades.push(offset(p, -0.45), offset(p, 0.45));
      else if (MODELS[p.prop]) models.set(p.prop, [...(models.get(p.prop) ?? []), p]);
    }
    return { arcades, models: [...models] };
  }, [list]);
  const tv = list.find((p) => p.prop === 'tv-console');
  const pods = list.filter((p) => p.prop === 'quote-pod');
  return (
    <>
      <Arcades at={arcades} office={office} />
      {models.map(([prop, at]) => (
        <office.InstancedModel key={prop} geometry={MODELS[prop]!()} at={at} />
      ))}
      {tv && (
        <group position={[tv.x, 0, tv.z]} rotation={[0, tv.rotY, 0]}>
          <mesh position={[0, M.TV_SCREEN.y, M.TV_SCREEN.z]} material={screenMat(arcadeTexture())}>
            <planeGeometry args={[M.TV_SCREEN.w, M.TV_SCREEN.h]} />
          </mesh>
        </group>
      )}
      {pods.map((p, i) => (
        <group key={p.slot} position={[p.x, 0, p.z]} rotation={[0, p.rotY, 0]}>
          {M.POD_SCREENS.y.flatMap((y, r) =>
            M.POD_SCREENS.x.map((x, c) => (
              <mesh key={`${r}${c}`} position={[x, y, M.POD_SCREENS.z]} material={screenMat(staticTexture(`pod:${i}:${r}${c}`, 256, 150, (ctx) => D.drawChart(ctx, 256, 150, ['NYSE', 'LSE', 'TSE', 'CFRM'][r * 2 + c], 7 + r * 2 + c)))}>
                <planeGeometry args={[M.POD_SCREENS.w, M.POD_SCREENS.h]} />
              </mesh>
            )),
          )}
        </group>
      ))}
      {list
        .filter((p) => p.prop === 'neon-rug' || p.prop === 'navy-rug')
        .map((p) => (
          <mesh key={p.slot} geometry={rugModel(p.w, p.d, p.prop === 'neon-rug' ? '#2a2140' : '#2b3f5c')} material={vertexToon} position={[p.x, 0.003, p.z]} rotation={[0, p.rotY, 0]} receiveShadow />
        ))}
      {list.map((p, i) => (
        <WallProp key={p.slot} at={p} i={i} />
      ))}
    </>
  );
}

// ---------- the desks' extra monitors ----------

const deskScreenGeo = new THREE.PlaneGeometry(M.DESK_SCREEN.w, M.DESK_SCREEN.h).translate(0, 0, 0.021);
// Where a desk's extra monitors stand, in the desk's frame: one to the right of the main one, and for the trading
// floor's multi-monitor desks one to the left too, set back behind the desk plant. Angled in toward the chair.
const SIDE = [
  { x: 0.8, z: -0.3, rotY: -0.38 },
  { x: -0.82, z: -0.42, rotY: 0.38 },
];

const DESK_PICTURES: Record<ThemePack['deskScreens'], (ctx: CanvasRenderingContext2D, w: number, h: number) => void> = {
  engine: D.drawEngineViewport,
  charts: (c, w, h) => D.drawChart(c, w, h, 'CFRM', 3),
  canvas: SD.drawCanvasTool,
  timeline: SD.drawTimeline,
  plots: SD.drawPlots,
  dashboards: SD.drawDashboards,
};
/** The desks with a monitor on each side: the trading floor's, the media studio's editing desks and the ops room's. */
const TWO_SCREENS: readonly ThemePack['deskScreens'][] = ['charts', 'timeline', 'dashboards'];

function DeskScreens({ kind, slots }: { kind: ThemePack['deskScreens']; slots: number[] }) {
  const bodies = useRef<THREE.InstancedMesh>(null);
  const faces = useRef<THREE.InstancedMesh>(null);
  const mat = screenMat(staticTexture(kind === 'engine' ? 'engine' : `desk-${kind}`, 384, 230, (c) => DESK_PICTURES[kind](c, 384, 230)));
  const poses = useMemo(() => {
    const desk = new THREE.Object3D();
    const mon = new THREE.Object3D();
    desk.add(mon);
    const out: THREE.Matrix4[] = [];
    for (const slot of slots) {
      const p = deskPosition(slot);
      desk.position.set(p.x, 0, p.z);
      desk.rotation.set(0, deskRotation(slot), 0);
      for (const s of SIDE.slice(0, TWO_SCREENS.includes(kind) ? 2 : 1)) {
        mon.position.set(s.x, 1.2, s.z);
        mon.rotation.set(-0.06, s.rotY, 0);
        desk.updateMatrixWorld(true);
        out.push(mon.matrixWorld.clone());
      }
    }
    return out;
  }, [slots, kind]);
  useEffect(() => {
    for (const m of [bodies.current, faces.current]) {
      if (!m) continue;
      poses.forEach((p, i) => m.setMatrixAt(i, p));
      m.count = poses.length;
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }, [poses]);
  if (!poses.length) return null;
  return (
    <>
      <instancedMesh key={`b${poses.length}`} ref={bodies} args={[M.deskMonitorModel(), vertexToon, poses.length]} castShadow />
      <instancedMesh key={`f${poses.length}`} ref={faces} args={[deskScreenGeo, mat, poses.length]} />
    </>
  );
}

// ---------- the north wall's big screen ----------

/** Where the office's "ship it" sign hangs: the themed floors put their big screen there. */
const NORTH = { x: 10, z: -HALF_D + 0.03 };

function Playtest({ repo, agents, office }: { repo: RepoView; agents: Agent[]; office: Office }) {
  const live = repo.preview.status === 'running';
  const latest = office.useLatestShot(agents);
  const [shot, setShot] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!live || !latest) return setShot(null);
    const [id, at] = latest.split('|');
    return loadScreenshot(id, Number(at), setShot);
  }, [live, latest]);
  const stages = useStore(useShallow((s) => repo.pulls.filter((p) => p.state === 'OPEN' && !p.untrusted).map((p) => prStage(s.qa[qaKey(repo.id, p.number)]))));
  const progress = buildProgress(stages);
  const use = useKeyName('interact');
  const name = repo.fullName.split('/')[1] ?? repo.fullName;
  const tex = useCanvasTexture(
    1024,
    600,
    (ctx) => D.drawPlaytest(ctx, 1024, 600, { name, live, status: repo.preview.status, shot, progress, use }),
    [name, live, repo.preview.status, shot, progress.done, progress.caption, use],
  );
  const ref = useInteractable<THREE.Group>({ id: `playtest-${repo.id}`, label: 'Play the build', action: { kind: 'app', repoId: repo.id, pr: null } }, 6);
  // "PRESS START" blinks on the title card
  const blink = useRef<THREE.Mesh>(null);
  const start = screenMat(staticTexture('press-start', 512, 64, D.drawPressStart), true);
  useFrame(() => {
    if (blink.current) blink.current.visible = !live && Math.floor(performance.now() / 600) % 2 === 0;
  });
  const W = 3.0;
  const H = 1.76;
  return (
    <group ref={ref} position={[NORTH.x, 2.05, NORTH.z]}>
      <mesh position={[0, 0, 0.02]} material={glow('#b14cff')}>
        <planeGeometry args={[W + 0.16, H + 0.16]} />
      </mesh>
      <mesh position={[0, 0, 0.05]}>
        <boxGeometry args={[W + 0.08, H + 0.08, 0.06]} />
        <meshToonMaterial color="#14102a" />
      </mesh>
      <mesh position={[0, 0, 0.081]}>
        <planeGeometry args={[W, H]} />
        <meshBasicMaterial map={tex} toneMapped={false} userData={BLOOM} />
      </mesh>
      <mesh ref={blink} position={[0, -0.32, 0.085]} material={start}>
        <planeGeometry args={[1.2, 0.15]} />
      </mesh>
    </group>
  );
}

function MarketWall({ repo }: { repo: RepoView }) {
  const n = useStore((s) => s.ops.floors.find((f) => f.repoId === repo.id) ?? EMPTY_NUMBERS);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);
  // the office's clock (sky/time.ts) for the hour, the real weekday, like the rituals
  const open = marketOpen(dayTime.t * 24, new Date(now).getDay());
  const name = repo.fullName.split('/')[1] ?? repo.fullName;
  const cs = useMemo(() => candles(n.spark), [n.spark]);
  const board = useCanvasTexture(1024, 512, (ctx) => D.drawMarket(ctx, 1024, 512, { floor: repo.floor, name, candles: cs, open, merged: n.mergedToday }), [repo.floor, name, cs, open, n.mergedToday]);
  const clocks = worldClocks(new Date(now));
  const clockKey = clocks.map((c) => `${c.h}:${c.m}`).join();
  const face = useCanvasTexture(1024, 256, (ctx) => D.drawClocks(ctx, 1024, 256, clocks), [clockKey]);
  const W = 3.0;
  const H = 1.5;
  return (
    <group position={[NORTH.x, 1.95, NORTH.z]}>
      <mesh position={[0, 0, 0.04]}>
        <boxGeometry args={[W + 0.1, H + 0.1, 0.06]} />
        <meshToonMaterial color="#1b263b" />
      </mesh>
      <mesh position={[0, 0, 0.072]}>
        <planeGeometry args={[W, H]} />
        <meshBasicMaterial map={board} toneMapped={false} userData={BLOOM} />
      </mesh>
      {/* the market light over the board, green while it's open */}
      <mesh position={[W / 2 - 0.1, H / 2 + 0.16, 0.08]} material={glow(open ? '#19c37d' : '#ff5c5c')}>
        <sphereGeometry args={[0.07, 16, 10]} />
      </mesh>
      <mesh position={[0, H / 2 + 0.62, 0.03]}>
        <planeGeometry args={[W, W / 4]} />
        <meshBasicMaterial map={face} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

// ---------- the trading floor's hanging ticker ----------

const TICKER = { x: 0, y: 3.02, z: 5.6, w: 10, h: 0.42 };
const TICKER_PX_H = 64;

let measurer: CanvasRenderingContext2D | null = null;
/** A context for measuring the ticker's text before its texture is made. */
const measureCtx = () => (measurer ??= document.createElement('canvas').getContext('2d')!);

function Ticker({ repo }: { repo: RepoView }) {
  const n = useStore((s) => s.ops.floors.find((f) => f.repoId === repo.id) ?? EMPTY_NUMBERS);
  const open = repo.pulls.filter((p) => p.state === 'OPEN').length;
  const prev = useRef<QuoteValues>({});
  const quotes = useMemo(() => {
    const q = tickerQuotes(n, open, prev.current);
    prev.current = q.values;
    return q.quotes;
  }, [n, open]);
  const label = `FLOOR ${repo.floor} · ${(repo.fullName.split('/')[1] ?? repo.fullName).toUpperCase()}`;
  const key = quotes.map((q) => `${q.symbol}${q.text}${q.dir}${q.good}`).join('|');
  // as wide as one pass of every quote (measured), shown at the housing's proportions and repeated as it scrolls
  // (rounded up, so a number ticking over doesn't remake the texture)
  const W = useMemo(() => Math.ceil(D.tickerStripWidth(measureCtx(), quotes, label, TICKER_PX_H) / 256) * 256, [quotes, label]);
  const tex = useCanvasTexture(W, TICKER_PX_H, (ctx) => D.drawTickerStrip(ctx, W, TICKER_PX_H, quotes, label), [key, label, W]);
  useEffect(() => {
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.x = ((TICKER.w / TICKER.h) * TICKER_PX_H) / W;
    tex.needsUpdate = true;
  }, [tex, W]);
  useFrame((_, dt) => {
    tex.offset.x = (tex.offset.x + (dt * 0.6 * TICKER_PX_H) / W) % 1; // the same speed however long the strip is
  });
  return (
    <group position={[TICKER.x, TICKER.y, TICKER.z]}>
      <mesh geometry={M.tickerModel(TICKER.w)} material={vertexToon} />
      {[0, Math.PI].map((r) => (
        <mesh key={r} rotation={[0, r, 0]} position={[0, 0, r ? -0.101 : 0.101]}>
          <planeGeometry args={[TICKER.w, TICKER.h]} />
          <meshBasicMaterial map={tex} toneMapped={false} userData={BLOOM} />
        </mesh>
      ))}
    </group>
  );
}

// ---------- the game studio's neon ----------

/** Neon tubes along the tops of the walls: purple on the north and south, cyan down the west. */
function NeonStrips() {
  const y = WALL_H - 0.08;
  return (
    <>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, y, s * (HALF_D - 0.04)]} material={glow('#b14cff')}>
          <boxGeometry args={[HALF_W * 2 - 0.2, 0.05, 0.03]} />
        </mesh>
      ))}
      <mesh position={[-HALF_W + 0.04, y, 0]} material={glow('#2de2e6')}>
        <boxGeometry args={[0.03, 0.05, HALF_D * 2 - 0.2]} />
      </mesh>
    </>
  );
}

// ---------- the scene ----------

export function ThemeScene({ pack, repo, agents, office }: SceneProps) {
  const placed = useStore((s) => s.progress.floors[repo.id]?.placed);
  const list = useMemo(() => themeProps(pack, placed), [pack, placed]);
  const deskKey = agents
    .filter((a) => a.role !== 'ceo')
    .map((a) => a.desk)
    .sort((a, b) => a - b)
    .join();
  const slots = useMemo(() => (deskKey ? deskKey.split(',').map(Number) : []), [deskKey]);
  return (
    <group>
      <ThemeProps list={list} office={office} />
      <DeskScreens kind={pack.deskScreens} slots={slots} />
      <StudioProps list={list} office={office} agents={agents} />
      {pack.wallScreen === 'playtest' && <Playtest repo={repo} agents={agents} office={office} />}
      {pack.wallScreen === 'market' && <MarketWall repo={repo} />}
      {pack.wallScreen === 'gallery' && <Gallery repo={repo} agents={agents} />}
      {pack.wallScreen === 'calendar' && <Calendar repo={repo} agents={agents} />}
      {pack.wallScreen === 'loss' && <LossCurve repo={repo} />}
      {pack.wallScreen === 'noc' && <NocWall />}
      {pack.id === 'trading' && <Ticker repo={repo} />}
      {pack.id === 'game-studio' && <NeonStrips />}
      {pack.id === 'design-studio' && <Pendants slots={slots} office={office} />}
      {pack.id === 'media-studio' && <OnAirSign agents={agents} />}
    </group>
  );
}
