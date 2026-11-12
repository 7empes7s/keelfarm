// The themes' signs and set pieces (#570), in the same lazy chunk as scenes.tsx (which draws them): the big sign hung
// over every themed room facing the elevator, a game playing on the game studio's screens, the console lounge, the
// video studio's shooting set, and the newsroom's anchor desk, story boards, newspaper stacks, front pages and wall of
// TVs. Pictures are drawn once (or when the floor's news changes); the game scrolls by sliding its texture.

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { RepoView } from '../../../../shared/types';
import { rugModel } from '../decor/models';
import { vertexToon } from '../decor/parts';
import { BLOOM } from '../gfx/bloomMarks';
import { useCanvasTexture } from '../interact';
import { HALF_D } from '../layout';
import { glow } from '../materials';
import type { ThemePack, ThemeProp } from './packs';
import type { PlacedProp } from './placement';
import { screenMat, staticTexture, WallPicture, type Pose } from './screenKit';
import type { SceneProps } from './scenes';
import * as D from './setDraw';
import * as S from './setModels';
import { headlines } from './ticker';

type Office = SceneProps['office'];

// ---------- the sign ----------

/** Hung over the middle row of desks, high enough to clear the whiteboard as seen from the elevator, and narrow enough to fit a phone's view. */
const SIGN = { z: -1, y: 3.09, w: 6, h: 0.94 };

/** The theme's name on a big board hung from the ceiling, both faces, so it's the first thing seen from the elevator. */
export function ThemeSign({ sign }: { sign: ThemePack['sign'] }) {
  const mat = screenMat(staticTexture(`sign:${sign.text}`, 1024, 160, (c) => D.drawThemeSign(c, 1024, 160, sign)), true);
  return (
    <group position={[0, SIGN.y, SIGN.z]}>
      <mesh position={[0, 0, 0.011]} material={mat}>
        <planeGeometry args={[SIGN.w, SIGN.h]} />
      </mesh>
      <mesh position={[0, 0, -0.011]} rotation={[0, Math.PI, 0]} material={mat}>
        <planeGeometry args={[SIGN.w, SIGN.h]} />
      </mesh>
    </group>
  );
}

// ---------- a game in motion ----------

const heroMat = screenMat(staticTexture('hero', 64, 64, (c) => D.drawHero(c, 64, 64)), true);

/** A platformer playing on a screen: the level scrolls under a hero hopping along. w x h, centred at `at`. */
export function PlayingLevel({ at, w, h }: { at: [number, number, number]; w: number; h: number }) {
  // its own texture, as each screen scrolls it on its own
  const tex = useMemo(() => {
    const t = staticTexture('level-strip', 512, 128, (c) => D.drawLevelStrip(c, 512, 128)).clone();
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.x = (w / h) * (128 / 512);
    t.needsUpdate = true;
    return t;
  }, [w, h]);
  const hero = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    tex.offset.x = (tex.offset.x + dt * 0.12) % 1;
    if (hero.current) hero.current.position.y = -h * 0.2 + Math.abs(Math.sin(performance.now() / 260)) * h * 0.35;
  });
  const s = h * 0.24;
  return (
    <group position={at}>
      <mesh>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={tex} toneMapped={false} userData={BLOOM} />
      </mesh>
      <mesh ref={hero} position={[-w * 0.25, 0, 0.004]} material={heroMat}>
        <planeGeometry args={[s, s]} />
      </mesh>
    </group>
  );
}

// ---------- the set pieces and the newsroom's props ----------

const MODELS: Partial<Record<ThemeProp, () => THREE.BufferGeometry>> = {
  'game-lounge': S.gameLoungeModel,
  'camera-set': S.cameraSetModel,
  'anchor-desk': S.anchorDeskModel,
  'story-board': S.storyBoardModel,
  'paper-stack': S.paperStackModel,
};

/** A plane in a prop's frame at `at`, turned by `rotY` there. */
function OnProp({ p, at, w, h, mat, rotY = 0 }: { p: Pose; at: [number, number, number]; w: number; h: number; mat: THREE.Material; rotY?: number }) {
  return (
    <group position={[p.x, p.y, p.z]} rotation={[0, p.rotY, 0]}>
      <mesh position={at} rotation={[0, rotY, 0]} material={mat}>
        <planeGeometry args={[w, h]} />
      </mesh>
    </group>
  );
}

function AnchorDesk({ p, floor }: { p: PlacedProp; floor: string }) {
  const back = useCanvasTexture(768, 400, (ctx) => D.drawAnchorBackdrop(ctx, 768, 400, floor), [floor]);
  const logo = screenMat(staticTexture('anchor-logo', 512, 136, (c) => D.drawAnchorLogo(c, 512, 136)), true);
  const { w, h, y, z } = S.ANCHOR_SCREEN;
  return (
    <>
      <group position={[p.x, 0, p.z]} rotation={[0, p.rotY, 0]}>
        <mesh position={[0, y, z]}>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial map={back} toneMapped={false} userData={BLOOM} />
        </mesh>
      </group>
      <OnProp p={p} at={[0, S.ANCHOR_LOGO.y, S.ANCHOR_LOGO.z]} w={S.ANCHOR_LOGO.w} h={S.ANCHOR_LOGO.h} mat={logo} />
    </>
  );
}

/** Every set piece and newsroom prop on the floor: instanced models, their screens and lights, the rugs and pictures. */
export function SetProps({ list, office, floor }: { list: PlacedProp[]; office: Office; floor: string }) {
  const models = useMemo(() => {
    const by = new Map<ThemeProp, Pose[]>();
    for (const p of list) if (MODELS[p.prop]) by.set(p.prop, [...(by.get(p.prop) ?? []), p]);
    return [...by];
  }, [list]);
  const of = (prop: ThemeProp) => list.filter((p) => p.prop === prop);
  const soft = glow('#fffaf0');
  const tally = glow('#ff2a2a');
  return (
    <>
      {models.map(([prop, at]) => (
        <office.InstancedModel key={prop} geometry={MODELS[prop]!()} at={at} />
      ))}
      {of('game-lounge').map((p) => (
        <group key={p.slot} position={[p.x, 0, p.z]} rotation={[0, p.rotY, 0]}>
          <PlayingLevel at={[0, S.LOUNGE_TV.y, S.LOUNGE_TV.z]} w={S.LOUNGE_TV.w} h={S.LOUNGE_TV.h} />
        </group>
      ))}
      {of('camera-set').map((p) => (
        <group key={p.slot} position={[p.x, 0, p.z]} rotation={[0, p.rotY, 0]}>
          {S.SET_SOFTBOX.x.map((x, i) => (
            <mesh key={x} position={[x, S.SET_SOFTBOX.y, S.SET_SOFTBOX.z]} rotation={[0, S.SET_SOFTBOX.rotY[i] + Math.PI, 0]} material={soft}>
              <planeGeometry args={[S.SET_SOFTBOX.w, S.SET_SOFTBOX.h]} />
            </mesh>
          ))}
          {S.SET_TALLY.map((t) => (
            <mesh key={t.x} position={[t.x, t.y + 0.12, t.z]} material={tally}>
              <sphereGeometry args={[0.03, 8, 6]} />
            </mesh>
          ))}
        </group>
      ))}
      {of('anchor-desk').map((p) => (
        <AnchorDesk key={p.slot} p={p} floor={floor} />
      ))}
      {of('story-board').flatMap((p, i) => {
        const mat = screenMat(staticTexture(`stories:${i % 3}`, 512, 272, (c) => D.drawStoryCards(c, 512, 272, i)));
        const { w, h, y, z } = S.STORY_FACE;
        return [<OnProp key={`${p.slot}f`} p={p} at={[0, y, z]} w={w} h={h} mat={mat} />, <OnProp key={`${p.slot}b`} p={p} at={[0, y, -z]} rotY={Math.PI} w={w} h={h} mat={mat} />];
      })}
      {of('news-rug').map((p) => (
        <mesh key={p.slot} geometry={rugModel(p.w, p.d, '#d7263d')} material={vertexToon} position={[p.x, 0.003, p.z]} rotation={[0, p.rotY, 0]} receiveShadow />
      ))}
      {of('front-pages').map((p) => (
        <WallPicture key={p.slot} at={p} w={p.w} h={1.1} map={staticTexture('front-pages', 768, 384, (c) => D.drawFrontPages(c, 768, 384))} />
      ))}
    </>
  );
}

// ---------- the newsroom's wall of TVs ----------

const TV = { cols: 3, rows: 2, w: 0.98, h: 0.56, gap: 0.05, y: 2.3 };
/** The headline ticker under the TVs (scenes.tsx's Ticker, with one face on the wall). */
export const NEWS_TICKER = { x: 10, y: TV.y - TV.h - TV.gap * 2 - 0.16, z: -HALF_D + 0.12, w: TV.cols * (TV.w + TV.gap) + 0.1, h: 0.28 };

function NewsTv({ x, y, headline, channel, live }: { x: number; y: number; headline: string; channel: string; live: boolean }) {
  const tex = useCanvasTexture(384, 220, (ctx) => D.drawHeadlineTv(ctx, 384, 220, { headline, channel, live }), [headline, channel, live]);
  return (
    <group position={[x, y, -HALF_D + 0.03]}>
      <mesh position={[0, 0, 0.03]}>
        <boxGeometry args={[TV.w + 0.04, TV.h + 0.04, 0.05]} />
        <meshToonMaterial color="#14161c" />
      </mesh>
      <mesh position={[0, 0, 0.057]}>
        <planeGeometry args={[TV.w, TV.h]} />
        <meshBasicMaterial map={tex} toneMapped={false} userData={BLOOM} />
      </mesh>
    </group>
  );
}

/** Six TVs on the north wall, each with one of the floor's headlines; the top left one is live. */
export function TvWall({ repo }: { repo: RepoView }) {
  const heads = useMemo(() => headlines(repo.pulls, repo.issues, TV.cols * TV.rows), [repo.pulls, repo.issues]);
  const channels = ['NEWS 24', 'FLOOR ' + repo.floor, 'WORLD', 'TECH', 'MARKETS', 'SPORT'];
  const tvs = [];
  for (let r = 0; r < TV.rows; r++)
    for (let c = 0; c < TV.cols; c++) {
      const i = r * TV.cols + c;
      tvs.push(<NewsTv key={i} x={NEWS_TICKER.x + (c - 1) * (TV.w + TV.gap)} y={TV.y - r * (TV.h + TV.gap) + TV.h / 2} headline={heads[i % heads.length]} channel={channels[i]} live={i === 0} />);
    }
  return <>{tvs}</>;
}
